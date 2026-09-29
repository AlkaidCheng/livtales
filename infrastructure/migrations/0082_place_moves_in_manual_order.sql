-- A task or reminder moves in manual order next to the record it now
-- follows (afterId) or precedes (beforeId), and takes a rank between that
-- record and its neighbour in the workspace's order as it stands, so moves
-- made meanwhile keep their places around it. The moved record never
-- counts as a neighbour, and ranks compare in byte order, the order they
-- are written in. The workspace's fence is taken before the neighbour is
-- read, as the service takes it, so moves in one workspace take their
-- places one after another. The anchor is a record of the same type in the
-- workspace that the caller can view.
CREATE FUNCTION chronelle_placed_changes(workspace_id uuid, user_id uuid, object_type text, object_id uuid, changes jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  field text;
  anchor_id uuid;
  anchor_rank text;
  neighbour text;
  placed text;
BEGIN
  IF changes IS NULL OR NOT (changes ? 'afterId' OR changes ? 'beforeId') THEN
    RETURN changes;
  END IF;
  IF object_type NOT IN ('task', 'reminder') THEN
    RAISE EXCEPTION 'Only tasks and reminders take a place in manual order.' USING ERRCODE = 'PT422';
  END IF;
  IF changes ? 'rank' OR (changes ? 'afterId' AND changes ? 'beforeId') THEN
    RAISE EXCEPTION 'Give a place in manual order as one of rank, afterId, or beforeId.' USING ERRCODE = 'PT422';
  END IF;
  field := CASE WHEN changes ? 'afterId' THEN 'afterId' ELSE 'beforeId' END;
  IF jsonb_typeof(changes -> field) <> 'string'
    OR (changes ->> field) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '% must name another % you can see.', field, object_type USING ERRCODE = 'PT422';
  END IF;
  anchor_id := (changes ->> field)::uuid;
  PERFORM 1 FROM workspaces w WHERE w.id = workspace_id FOR NO KEY UPDATE;
  IF object_type = 'task' THEN
    SELECT t.rank INTO anchor_rank FROM tasks t
    WHERE t.workspace_id = workspace_id AND t.object_id = anchor_id AND t.object_id <> object_id;
  ELSE
    SELECT r.rank INTO anchor_rank FROM reminders r
    WHERE r.workspace_id = workspace_id AND r.object_id = anchor_id AND r.object_id <> object_id;
  END IF;
  IF anchor_rank IS NULL OR NOT chronelle_can_view(workspace_id, user_id, anchor_id) THEN
    RAISE EXCEPTION '% must name another % you can see.', field, object_type USING ERRCODE = 'PT422';
  END IF;
  IF field = 'afterId' THEN
    IF object_type = 'task' THEN
      SELECT min(t.rank COLLATE "C") INTO neighbour FROM tasks t
      WHERE t.workspace_id = workspace_id AND t.object_id <> object_id AND t.rank COLLATE "C" > anchor_rank;
    ELSE
      SELECT min(r.rank COLLATE "C") INTO neighbour FROM reminders r
      WHERE r.workspace_id = workspace_id AND r.object_id <> object_id AND r.rank COLLATE "C" > anchor_rank;
    END IF;
    placed := chronelle_rank_between(anchor_rank, neighbour);
  ELSE
    IF object_type = 'task' THEN
      SELECT max(t.rank COLLATE "C") INTO neighbour FROM tasks t
      WHERE t.workspace_id = workspace_id AND t.object_id <> object_id AND t.rank COLLATE "C" < anchor_rank;
    ELSE
      SELECT max(r.rank COLLATE "C") INTO neighbour FROM reminders r
      WHERE r.workspace_id = workspace_id AND r.object_id <> object_id AND r.rank COLLATE "C" < anchor_rank;
    END IF;
    placed := chronelle_rank_between(neighbour, anchor_rank);
  END IF;
  RETURN (changes - 'afterId' - 'beforeId') || jsonb_build_object('rank', placed);
END
$$;

-- From 0075: a place given as afterId or beforeId becomes a rank before
-- the object is locked, so every object write, commands included, takes it.
CREATE OR REPLACE FUNCTION chronelle_object_update(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  object_type text,
  object_id uuid,
  expected_version integer,
  changes jsonb,
  command jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  current_object objects%ROWTYPE;
  next_version integer;
  audit_id uuid := chronelle_uuidv7();
  written_at timestamptz := now();
  audit_metadata jsonb;
  snapshot jsonb;
  rows jsonb;
BEGIN
  IF object_type NOT IN ('event', 'task', 'expense', 'reminder', 'person', 'note') THEN
    RAISE EXCEPTION 'Unsupported object type %.', object_type USING ERRCODE = 'PT422';
  END IF;
  IF NOT chronelle_can_edit(workspace_id, user_id, object_id) THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  changes := chronelle_placed_changes(workspace_id, user_id, object_type, object_id, changes);
  SELECT * INTO current_object FROM objects o
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.object_type = object_type
  FOR UPDATE;
  IF NOT FOUND OR current_object.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'The resource is unavailable.' USING ERRCODE = 'PT403';
  END IF;
  EXECUTE format('SELECT chronelle_%I_validate($1, $2, $3)', object_type) USING workspace_id, object_id, changes;
  IF current_object.version <> expected_version THEN
    RAISE EXCEPTION 'The object changed since it was read.' USING ERRCODE = 'PT409';
  END IF;
  next_version := expected_version + 1;
  UPDATE objects o
  SET display_name = COALESCE(changes ->> 'displayName', o.display_name),
      custom_properties = COALESCE(changes -> 'customProperties', o.custom_properties),
      metadata = COALESCE(changes -> 'metadata', o.metadata),
      updated_at = written_at,
      version = next_version
  WHERE o.workspace_id = workspace_id AND o.id = object_id AND o.version = expected_version;
  EXECUTE format('SELECT chronelle_%I_apply($1, $2, $3)', object_type) USING workspace_id, object_id, changes;
  IF NOT EXISTS (
    SELECT 1 FROM object_revisions r
    WHERE r.object_id = object_id AND r.object_version = expected_version
  ) THEN
    RAISE EXCEPTION 'Object revision baseline is missing; run db:baseline-revisions before serving writes.'
      USING ERRCODE = 'PT500';
  END IF;
  audit_metadata := jsonb_build_object('previousVersion', expected_version, 'version', next_version);
  IF command IS NOT NULL THEN
    audit_metadata := audit_metadata || jsonb_build_object('command', command);
  END IF;
  INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id, metadata, created_at)
  VALUES (audit_id, workspace_id, 'user', user_id, object_type || '.updated', object_id, request_id, audit_metadata, written_at);
  EXECUTE format('SELECT chronelle_%I_serialize($1, $2)', object_type) INTO snapshot USING workspace_id, object_id;
  INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind, source_revision_id,
                                actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot, created_at)
  VALUES (chronelle_uuidv7(), workspace_id, object_id, next_version, 'updated', NULL,
          'user', user_id, request_id, audit_id, 1, snapshot, written_at);
  EXECUTE format('SELECT chronelle_%I_rows($1, $2)', object_type) INTO rows USING workspace_id, object_id;
  RETURN rows;
END
$$;
