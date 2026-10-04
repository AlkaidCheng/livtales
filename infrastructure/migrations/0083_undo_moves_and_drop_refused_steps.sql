-- Undo and redo put a task back in its place, and a refused step leaves the
-- caller's stack.
--
-- An undo or redo of a task writes its rank in manual order and its section
-- from the revision it restores, when that revision recorded them; a
-- section that is no longer one of the To-dos of the task's Event is left
-- out, and the task comes back outside any section. Restoring a revision
-- from History still never writes a place.
--
-- An undo or redo refused because an object its command changed has
-- changed since takes that command off the stack, with every other undo
-- and redo entry that changed the object, since the same change blocks each
-- of them. The stack takes a version step, and the function answers
-- {"refusedObjectId": ...} in place of a receipt, with nothing else
-- written: no edit, receipt, or audit event.

-- From 0061: the content a command restores is ReversibleCommandService's
-- selectCommandContent(): the restorable content, with a task's duration,
-- repeat rule, and location, and the parts of a task's place the snapshot
-- recorded.
CREATE OR REPLACE FUNCTION chronelle_command_content(object_type text, snapshot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE object_type
    WHEN 'event' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'startsOn', snapshot -> 'startsOn',
      'endsOn', snapshot -> 'endsOn',
      'startsAt', snapshot -> 'startsAt',
      'endsAt', snapshot -> 'endsAt',
      'timezone', snapshot -> 'timezone',
      'isAllDay', snapshot -> 'isAllDay',
      'location', snapshot -> 'location',
      'description', snapshot -> 'description')
    WHEN 'task' THEN jsonb_build_object(
      'displayName', snapshot -> 'displayName',
      'customProperties', snapshot -> 'customProperties',
      'status', snapshot -> 'status',
      'dueOn', snapshot -> 'dueOn',
      'dueAt', snapshot -> 'dueAt',
      'durationMinutes', snapshot -> 'durationMinutes',
      'repeatRule', snapshot -> 'repeatRule',
      'repeatUntil', snapshot -> 'repeatUntil',
      'location', snapshot -> 'location',
      'description', snapshot -> 'description',
      'completedAt', snapshot -> 'completedAt')
      || (SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
          FROM jsonb_each(snapshot) e WHERE e.key IN ('rank', 'sectionId'))
  END;
$$;

-- dropObjectCommands(): the caller's locked stack without the undo and redo
-- entries whose command changed the object, saved under its version
-- predicate with version expectations kept only for objects a remaining
-- entry changed.
CREATE FUNCTION chronelle_command_drop_object(stack command_stacks, object_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  dropped uuid[];
  undo_ids uuid[];
  redo_ids uuid[];
  retained_versions jsonb;
BEGIN
  dropped := ARRAY(
    SELECT DISTINCT c.command_id FROM command_changes c
    WHERE c.workspace_id = stack.workspace_id AND c.user_id = stack.user_id
      AND c.object_id = object_id AND c.command_id = ANY (stack.undo_ids || stack.redo_ids)
  );
  undo_ids := ARRAY(SELECT e.id FROM unnest(stack.undo_ids) WITH ORDINALITY AS e(id, place)
                    WHERE e.id <> ALL (dropped) ORDER BY e.place);
  redo_ids := ARRAY(SELECT e.id FROM unnest(stack.redo_ids) WITH ORDINALITY AS e(id, place)
                    WHERE e.id <> ALL (dropped) ORDER BY e.place);
  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO retained_versions
  FROM jsonb_each(stack.expected_versions) e
  WHERE EXISTS (
    SELECT 1 FROM command_changes c
    WHERE c.workspace_id = stack.workspace_id AND c.user_id = stack.user_id
      AND c.command_id = ANY (undo_ids || redo_ids) AND c.object_id = e.key::uuid
  );
  UPDATE command_stacks s
  SET version = stack.version + 1, undo_ids = undo_ids, redo_ids = redo_ids,
      expected_versions = retained_versions
  WHERE s.workspace_id = stack.workspace_id AND s.user_id = stack.user_id AND s.version = stack.version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;
END
$$;

-- From 0075: an object that changed since the stack's expectation refuses
-- the step and takes the object's entries off the stack; a task's section
-- that no longer holds is left out of the content.
CREATE OR REPLACE FUNCTION chronelle_command_transition(
  workspace_id uuid,
  user_id uuid,
  request_id uuid,
  operation_id uuid,
  command_id uuid,
  expected_stack_version integer,
  direction text,
  request_hash text
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
#variable_conflict use_variable
DECLARE
  receipt jsonb := chronelle_command_replay(workspace_id, user_id, operation_id, request_hash);
  stack command_stacks%ROWTYPE;
  source uuid[];
  change command_changes%ROWTYPE;
  current_object objects%ROWTYPE;
  revision object_revisions%ROWTYPE;
  content jsonb;
  changes jsonb[] := '{}';
  edit jsonb;
  versions jsonb := '[]'::jsonb;
  command jsonb := jsonb_build_object('id', command_id::text, 'operationId', operation_id::text, 'direction', direction);
BEGIN
  IF direction NOT IN ('undo', 'redo') THEN
    RAISE EXCEPTION 'direction must be undo or redo.' USING ERRCODE = 'PT422';
  END IF;
  IF receipt IS NOT NULL THEN
    RETURN receipt;
  END IF;
  stack := chronelle_command_stack(workspace_id, user_id);
  source := CASE direction WHEN 'undo' THEN stack.undo_ids ELSE stack.redo_ids END;
  IF stack.version <> expected_stack_version OR source[cardinality(source)] IS DISTINCT FROM command_id THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;

  FOR change IN
    SELECT * FROM command_changes c
    WHERE c.workspace_id = workspace_id AND c.user_id = user_id AND c.command_id = command_id
    ORDER BY c.object_id
  LOOP
    current_object := chronelle_command_target(workspace_id, user_id, change.object_id);
    IF current_object.version IS DISTINCT FROM (stack.expected_versions ->> change.object_id::text)::integer THEN
      PERFORM chronelle_command_drop_object(stack, change.object_id);
      RETURN jsonb_build_object('refusedObjectId', change.object_id::text);
    END IF;
    SELECT * INTO revision FROM object_revisions r
    WHERE r.object_id = change.object_id
      AND r.object_version = CASE direction WHEN 'undo' THEN change.before_version ELSE change.after_version END;
    IF NOT FOUND OR revision.snapshot_schema_version <> 1 THEN
      RAISE EXCEPTION 'Unsupported command revision.' USING ERRCODE = 'PT500';
    END IF;
    IF revision.snapshot ->> 'deletedAt' IS NOT NULL THEN
      RAISE EXCEPTION 'Command content must reference a live revision.' USING ERRCODE = 'PT500';
    END IF;
    content := chronelle_command_content(current_object.object_type, revision.snapshot);
    IF content ->> 'sectionId' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM sections s
      WHERE s.workspace_id = current_object.workspace_id AND s.id = (content ->> 'sectionId')::uuid
        AND s.view = 'todos' AND s.event_id = current_object.permission_scope_id
        AND current_object.permission_scope_id <> current_object.id
    ) THEN
      content := content || jsonb_build_object('sectionId', NULL);
    END IF;
    changes := changes || jsonb_build_object(
      'objectType', current_object.object_type, 'objectId', change.object_id::text,
      'expectedVersion', current_object.version, 'content', content);
  END LOOP;
  IF cardinality(changes) = 0 THEN
    RAISE EXCEPTION 'The command history changed. Refresh before trying again.' USING ERRCODE = 'PT409';
  END IF;

  FOREACH edit IN ARRAY changes LOOP
    PERFORM chronelle_object_update(workspace_id, user_id, request_id, edit ->> 'objectType',
                                    (edit ->> 'objectId')::uuid, (edit ->> 'expectedVersion')::integer,
                                    edit -> 'content', command);
    versions := versions || jsonb_build_object('id', edit -> 'objectId', 'version', (edit ->> 'expectedVersion')::integer + 1);
    stack.expected_versions := stack.expected_versions
      || jsonb_build_object(edit ->> 'objectId', (edit ->> 'expectedVersion')::integer + 1);
  END LOOP;
  IF direction = 'undo' THEN
    stack.undo_ids := stack.undo_ids[1:cardinality(stack.undo_ids) - 1];
    stack.redo_ids := stack.redo_ids || command_id;
  ELSE
    stack.redo_ids := stack.redo_ids[1:cardinality(stack.redo_ids) - 1];
    stack.undo_ids := stack.undo_ids || command_id;
  END IF;
  RETURN chronelle_command_record(request_id, request_hash, stack, jsonb_build_object(
    'operationId', operation_id::text, 'commandId', command_id::text, 'direction', direction,
    'stackVersion', stack.version + 1, 'objects', versions));
END
$$;
