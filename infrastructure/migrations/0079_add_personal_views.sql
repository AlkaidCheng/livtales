-- Each person's own view of an event, and of the Events, Tasks, and People
-- pages, kept on the account instead of in the browser.
--
-- `user_event_views` holds one row per person and event once the person
-- first saves their view of it: where they left it (`place`, a view or a
-- page), how the tab strip lists its views and pages (`tabs`, the shape of
-- `users.event_tabs` entries from 0053), their page order (`pages`), and each
-- page component's layout (`layouts`, component id to a view or null for
-- the kind's default). The first save copies the event's page order and
-- component layouts, so later changes to the event's defaults do not reach
-- the person; pages and components added since join the copy when the next
-- save stores it. `opened_at` is set when the row is made and whenever the
-- place is saved; each account keeps the 200 most recently opened events.
--
-- `user_component_choices` holds what one tab (by view key) or page
-- component (by id) was left with: its sort, filters, what it shows. A row
-- exists only while it differs from the defaults, and goes with its view.
-- Each account keeps the 1,000 most recently changed.
--
-- `user_page_choices` holds the same for the Events, Tasks, and People
-- pages, merged by name.
--
-- The TypeScript repository and the chronelle_user_event_view_* and
-- chronelle_user_page_choices_* functions below write the same rows; the
-- normalization against the event's current layout happens in the API on
-- both paths. The functions write each field on its own, so two saves that
-- race keep what each changed.
--
-- The keys to `users` and `objects` hold writes to both until the migration
-- commits, so a busy lock fails fast.
SET LOCAL lock_timeout = '5s';

CREATE TABLE user_event_views (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  place jsonb,
  tabs jsonb NOT NULL DEFAULT '{}'::jsonb,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  layouts jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_event_views_pkey PRIMARY KEY (user_id, event_id),
  CONSTRAINT user_event_views_place_is_view_or_page CHECK (
    place IS NULL OR CASE WHEN jsonb_typeof(place) = 'object' THEN
      place - 'view' - 'page' = '{}'::jsonb
      AND (place ? 'view') <> (place ? 'page')
      AND jsonb_typeof(COALESCE(place -> 'view', place -> 'page')) = 'string'
    ELSE false END
  ),
  CONSTRAINT user_event_views_tabs_are_lists CHECK (
    jsonb_typeof(tabs) = 'object'
    AND (NOT tabs ? 'order' OR jsonb_typeof(tabs -> 'order') = 'array')
    AND (NOT tabs ? 'hidden' OR jsonb_typeof(tabs -> 'hidden') = 'array')
    AND (NOT tabs ? 'removed' OR jsonb_typeof(tabs -> 'removed') = 'array')
    AND NOT jsonb_path_exists(tabs, '$.order[*] ? (@.type() != "string")')
    AND NOT jsonb_path_exists(tabs, '$.hidden[*] ? (@.type() != "string")')
    AND NOT jsonb_path_exists(tabs, '$.removed[*] ? (@.type() != "string")')
    AND NOT jsonb_path_exists(tabs, '$.order[40]')
    AND NOT jsonb_path_exists(tabs, '$.hidden[40]')
    AND NOT jsonb_path_exists(tabs, '$.removed[40]')
  ),
  CONSTRAINT user_event_views_pages_are_ids CHECK (
    CASE WHEN jsonb_typeof(pages) = 'array' THEN
      jsonb_array_length(pages) <= 20
      AND NOT jsonb_path_exists(pages, '$[*] ? (@.type() != "string")')
      AND NOT jsonb_path_exists(pages, '$[*] ? (!(@ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" flag "i"))')
    ELSE false END
  ),
  CONSTRAINT user_event_views_layouts_by_component CHECK (
    jsonb_typeof(layouts) = 'object'
    AND NOT jsonb_path_exists(layouts, '$.keyvalue() ? (!(@.key like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" flag "i"))')
    AND NOT jsonb_path_exists(layouts, '$.* ? (@.type() != "string" && @.type() != "null")')
  )
);
-- The 200 most recently opened events of an account are kept.
CREATE INDEX user_event_views_opened_idx ON user_event_views (user_id, opened_at DESC, event_id DESC);
-- An object that is removed takes its views with it.
CREATE INDEX user_event_views_event_idx ON user_event_views (event_id);

CREATE TABLE user_component_choices (
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  component text NOT NULL,
  choices jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_component_choices_pkey PRIMARY KEY (user_id, event_id, component),
  CONSTRAINT user_component_choices_view_fk FOREIGN KEY (user_id, event_id)
    REFERENCES user_event_views (user_id, event_id) ON DELETE CASCADE,
  CONSTRAINT user_component_choices_component_length CHECK (length(component) BETWEEN 1 AND 40),
  CONSTRAINT user_component_choices_differ CHECK (
    jsonb_typeof(choices) = 'object' AND choices <> '{}'::jsonb
  )
);
-- The 1,000 most recently changed component choices of an account are kept.
CREATE INDEX user_component_choices_updated_idx
  ON user_component_choices (user_id, updated_at DESC, event_id DESC, component DESC);

CREATE TABLE user_page_choices (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page text NOT NULL,
  choices jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_page_choices_pkey PRIMARY KEY (user_id, page),
  CONSTRAINT user_page_choices_page CHECK (page IN ('events', 'tasks', 'people')),
  CONSTRAINT user_page_choices_are_named CHECK (jsonb_typeof(choices) = 'object')
);

-- The tabs each account kept for a live event become that account's view
-- of it, with the event's current page order and component layouts copied
-- as its first save would copy them. `users.event_tabs` stays until the API
-- that no longer writes it is released.
INSERT INTO user_event_views (user_id, event_id, place, tabs, pages, layouts)
SELECT u.id, o.id, NULL,
  jsonb_strip_nulls(jsonb_build_object(
    'order', entry.value -> 'order',
    'hidden', entry.value -> 'hidden',
    'removed', entry.value -> 'removed'
  )),
  COALESCE((
    SELECT jsonb_agg(listed.page -> 'id' ORDER BY listed.position)
    FROM jsonb_array_elements(latest.pages) WITH ORDINALITY AS listed(page, position)
  ), '[]'::jsonb),
  COALESCE((
    SELECT jsonb_object_agg(placed.component ->> 'id', COALESCE(placed.component -> 'view', 'null'::jsonb))
    FROM jsonb_array_elements(latest.pages) AS listed(page),
      jsonb_array_elements(listed.page -> 'components') AS placed(component)
  ), '{}'::jsonb)
FROM users u
CROSS JOIN LATERAL jsonb_each(u.event_tabs) AS entry(key, value)
JOIN objects o ON o.id = entry.key::uuid AND o.object_type = 'event' AND o.deleted_at IS NULL
LEFT JOIN LATERAL (
  SELECT r.pages FROM event_page_revisions r
  WHERE r.event_id = o.id
  ORDER BY r.version DESC
  LIMIT 1
) latest ON true;

-- A stored view as the API reads it: its fields and its components'
-- choices by key. NULL before the account's first save.
CREATE FUNCTION chronelle_user_event_view_json(user_id uuid, event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'place', v.place,
    'tabs', v.tabs,
    'pages', v.pages,
    'layouts', v.layouts,
    'choices', COALESCE((
      SELECT jsonb_object_agg(c.component, c.choices)
      FROM user_component_choices c
      WHERE c.user_id = v.user_id AND c.event_id = v.event_id
    ), '{}'::jsonb)
  )
  FROM user_event_views v
  WHERE v.user_id = $1 AND v.event_id = $2;
$$;

-- The account's stored view of an Event it may view, or NULL.
CREATE FUNCTION chronelle_user_event_view_read(workspace_id uuid, user_id uuid, event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF NOT chronelle_can_view(workspace_id, user_id, event_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  RETURN chronelle_user_event_view_json(user_id, event_id);
END
$$;

-- Saves the account's view of an Event it may view, as the API planned it
-- against the event's current layout:
--   defaults  the page order and layouts a first save stores
--   place     replaces the place and marks the event opened now
--   tabs, pages  {value, ifUnchanged?}: replace, or only while the field
--             still holds ifUnchanged (a copy brought up to the layout)
--   layouts   {add, set, drop}: add fills components the row lacks, set
--             replaces, drop removes
--   choices   each component's choices; an empty object deletes its row
--   components  the event's component ids; choices of other ids go
-- Then the account's oldest views beyond 200 (never this one) and oldest
-- component choices beyond 1,000 are removed. Returns the stored view.
CREATE FUNCTION chronelle_user_event_view_save(workspace_id uuid, user_id uuid, event_id uuid, write jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  tabs_write jsonb := write -> 'tabs';
  pages_write jsonb := write -> 'pages';
  choice_writes jsonb := COALESCE(write -> 'choices', '{}'::jsonb);
BEGIN
  IF NOT chronelle_can_view(workspace_id, user_id, event_id) OR NOT EXISTS (
    SELECT 1 FROM objects o
    WHERE o.workspace_id = workspace_id AND o.id = event_id AND o.object_type = 'event'
  ) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  IF write IS NULL OR jsonb_typeof(write) <> 'object' THEN
    RAISE EXCEPTION 'write is an object.' USING ERRCODE = 'PT422';
  END IF;

  INSERT INTO user_event_views (user_id, event_id, pages, layouts)
  VALUES (user_id, event_id,
    COALESCE(write -> 'defaults' -> 'pages', '[]'::jsonb),
    COALESCE(write -> 'defaults' -> 'layouts', '{}'::jsonb))
  ON CONFLICT ON CONSTRAINT user_event_views_pkey DO NOTHING;

  UPDATE user_event_views v
  SET place = CASE WHEN write ? 'place' THEN write -> 'place' ELSE v.place END,
      opened_at = CASE WHEN write ? 'place' THEN now() ELSE v.opened_at END,
      tabs = CASE
        WHEN tabs_write IS NULL THEN v.tabs
        WHEN NOT tabs_write ? 'ifUnchanged' OR v.tabs = tabs_write -> 'ifUnchanged' THEN tabs_write -> 'value'
        ELSE v.tabs END,
      pages = CASE
        WHEN pages_write IS NULL THEN v.pages
        WHEN NOT pages_write ? 'ifUnchanged' OR v.pages = pages_write -> 'ifUnchanged' THEN pages_write -> 'value'
        ELSE v.pages END,
      layouts = ((COALESCE(write -> 'layouts' -> 'add', '{}'::jsonb) || v.layouts)
          || COALESCE(write -> 'layouts' -> 'set', '{}'::jsonb))
        - ARRAY(SELECT jsonb_array_elements_text(COALESCE(write -> 'layouts' -> 'drop', '[]'::jsonb))),
      updated_at = now()
  WHERE v.user_id = user_id AND v.event_id = event_id;

  INSERT INTO user_component_choices AS c (user_id, event_id, component, choices)
  SELECT user_id, event_id, entry.key, entry.value
  FROM jsonb_each(choice_writes) AS entry(key, value)
  WHERE entry.value <> '{}'::jsonb
  ON CONFLICT ON CONSTRAINT user_component_choices_pkey
  DO UPDATE SET choices = excluded.choices, updated_at = now();
  DELETE FROM user_component_choices c
  WHERE c.user_id = user_id AND c.event_id = event_id
    AND (
      c.component IN (
        SELECT entry.key FROM jsonb_each(choice_writes) AS entry(key, value)
        WHERE entry.value = '{}'::jsonb
      )
      OR (
        c.component ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT (COALESCE(write -> 'components', '[]'::jsonb) ? c.component)
      )
    );

  DELETE FROM user_event_views v
  WHERE v.user_id = user_id AND v.event_id <> event_id
    AND (v.opened_at, v.event_id) < (
      SELECT k.opened_at, k.event_id FROM user_event_views k
      WHERE k.user_id = user_id AND k.event_id <> event_id
      ORDER BY k.opened_at DESC, k.event_id DESC
      OFFSET 198 LIMIT 1
    );
  DELETE FROM user_component_choices c
  WHERE c.user_id = user_id
    AND (c.updated_at, c.event_id, c.component) < (
      SELECT k.updated_at, k.event_id, k.component FROM user_component_choices k
      WHERE k.user_id = user_id
      ORDER BY k.updated_at DESC, k.event_id DESC, k.component DESC
      OFFSET 999 LIMIT 1
    );

  RETURN chronelle_user_event_view_json(user_id, event_id);
END
$$;

CREATE FUNCTION chronelle_assert_account_page(page text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF page IS NULL OR page NOT IN ('events', 'tasks', 'people') THEN
    RAISE EXCEPTION 'page is events, tasks, or people.' USING ERRCODE = 'PT422';
  END IF;
END
$$;

-- A collection page's choices as the account left them; {} when none.
CREATE FUNCTION chronelle_user_page_choices_read(user_id uuid, page text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  PERFORM chronelle_assert_account_page(page);
  RETURN COALESCE((
    SELECT c.choices FROM user_page_choices c
    WHERE c.user_id = user_id AND c.page = page
  ), '{}'::jsonb);
END
$$;

-- Merges a change into a collection page's choices by name: a value
-- replaces that choice and a JSON null removes it. The result keeps up to
-- 40 names in 16 KB; an empty result deletes the row. Returns the result.
CREATE FUNCTION chronelle_user_page_choices_update(user_id uuid, page text, changes jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  kept jsonb;
  removed text[];
  merged jsonb;
BEGIN
  PERFORM chronelle_assert_account_page(page);
  IF changes IS NULL OR jsonb_typeof(changes) <> 'object' THEN
    RAISE EXCEPTION 'changes is an object.' USING ERRCODE = 'PT422';
  END IF;
  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  INTO kept
  FROM jsonb_each(changes) AS entry(key, value)
  WHERE jsonb_typeof(entry.value) <> 'null';
  removed := ARRAY(
    SELECT entry.key FROM jsonb_each(changes) AS entry(key, value)
    WHERE jsonb_typeof(entry.value) = 'null'
  );
  INSERT INTO user_page_choices AS c (user_id, page, choices)
  VALUES (user_id, page, kept - removed)
  ON CONFLICT ON CONSTRAINT user_page_choices_pkey
  DO UPDATE SET choices = (c.choices || kept) - removed, updated_at = now()
  RETURNING c.choices INTO merged;
  IF (SELECT count(*) FROM jsonb_object_keys(merged)) > 40 OR octet_length(merged::text) > 16384 THEN
    RAISE EXCEPTION 'A page keeps up to 40 choices in up to 16 KB.' USING ERRCODE = 'PT422';
  END IF;
  IF merged = '{}'::jsonb THEN
    DELETE FROM user_page_choices c WHERE c.user_id = user_id AND c.page = page;
  END IF;
  RETURN merged;
END
$$;

REVOKE ALL ON FUNCTION chronelle_user_event_view_json(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_user_event_view_read(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_user_event_view_save(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_assert_account_page(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_user_page_choices_read(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION chronelle_user_page_choices_update(uuid, text, jsonb) FROM PUBLIC;

DO $$
DECLARE
  signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'chronelle_user_event_view_json(uuid, uuid)',
    'chronelle_user_event_view_read(uuid, uuid, uuid)',
    'chronelle_user_event_view_save(uuid, uuid, uuid, jsonb)',
    'chronelle_assert_account_page(text)',
    'chronelle_user_page_choices_read(uuid, text)',
    'chronelle_user_page_choices_update(uuid, text, jsonb)'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
    END IF;
  END LOOP;
END
$$;
