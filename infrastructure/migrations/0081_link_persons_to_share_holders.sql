-- A Person's linked account may also be one that holds a live share in the
-- workspace: a guest of one of its Events may be linked to a Person there,
-- as "Assign to me" does from the guest's side. A share counts while it has
-- not expired and its object is live, or it is the owner's (as entering the
-- workspace counts it). The rest of 0057's rule stands: a member of the
-- workspace or a friend of one, and one Person per account.
CREATE OR REPLACE FUNCTION chronelle_assert_person_state(workspace_id uuid, object_id uuid, user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_variable
BEGIN
  IF user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.workspace_id = workspace_id AND m.user_id = user_id
    ) AND NOT EXISTS (
      SELECT 1 FROM user_connections c
      JOIN workspace_members m ON m.workspace_id = workspace_id
      WHERE c.status = 'accepted'
        AND ((c.requester_id = user_id AND c.addressee_id = m.user_id)
          OR (c.addressee_id = user_id AND c.requester_id = m.user_id))
    ) AND NOT EXISTS (
      SELECT 1 FROM resource_grants g
      JOIN objects o ON o.workspace_id = g.workspace_id AND o.id = g.resource_id
      WHERE g.workspace_id = workspace_id
        AND g.principal_type = 'user'
        AND g.principal_id = user_id
        AND (g.expires_at IS NULL OR g.expires_at > now())
        AND (o.deleted_at IS NULL OR g.role = 'owner')
    ) THEN
      RAISE EXCEPTION 'userId must name a member of this workspace, a friend of one, or an account it shares with.' USING ERRCODE = 'PT422';
    END IF;
    IF EXISTS (
      SELECT 1 FROM persons p
      WHERE p.workspace_id = workspace_id AND p.user_id = user_id AND p.object_id <> object_id
    ) THEN
      RAISE EXCEPTION 'userId is already linked to another person.' USING ERRCODE = 'PT422';
    END IF;
  END IF;
END
$$;
