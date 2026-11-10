-- Document Vault workflow migration
-- Apply only through a reviewed database migration after the authenticated API,
-- private object store and malware scanning service are available.
-- Email/WhatsApp providers must be connected through the Communication Hub;
-- this migration stores their references, not message credentials or file bytes.

BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source_channel TEXT NOT NULL DEFAULT 'MANUAL_UPLOAD'
    CHECK (source_channel IN ('MANUAL_UPLOAD','EMAIL','WHATSAPP','CLIENT_PORTAL','SYSTEM')),
  ADD COLUMN IF NOT EXISTS source_reference TEXT,
  ADD COLUMN IF NOT EXISTS source_contact_id BIGINT REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_communication_id BIGINT REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS assigned_reviewer_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'NEEDS_CLASSIFICATION'
    CHECK (review_status IN ('NEEDS_CLASSIFICATION','ASSIGNED','IN_REVIEW','APPROVED','RETURNED','FINAL','ARCHIVED')),
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_comment TEXT,
  ADD COLUMN IF NOT EXISTS confidentiality_level TEXT NOT NULL DEFAULT 'CLIENT_CONFIDENTIAL'
    CHECK (confidentiality_level IN ('CLIENT_CONFIDENTIAL','PERSONAL_DATA','RESTRICTED','CLIENT_SHAREABLE')),
  ADD COLUMN IF NOT EXISTS malware_scan_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (malware_scan_status IN ('PENDING','CLEAN','QUARANTINED','FAILED','NOT_APPLICABLE')),
  ADD COLUMN IF NOT EXISTS content_sha256 TEXT
    CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS retention_policy_id BIGINT REFERENCES data_retention_policies(retention_policy_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS documents_client_review_idx
  ON documents (client_id, review_status, received_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_reviewer_queue_idx
  ON documents (assigned_reviewer_user_id, review_status, received_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_source_channel_idx
  ON documents (source_channel, received_at DESC);

CREATE OR REPLACE FUNCTION enforce_document_metadata_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $
DECLARE
  parent_client_id BIGINT;
  parent_firm_id BIGINT;
  source_client_id BIGINT;
  source_firm_id BIGINT;
BEGIN
  IF NEW.engagement_id IS NOT NULL THEN
    SELECT client_id, handling_firm_id INTO parent_client_id, parent_firm_id
    FROM engagements WHERE engagement_id = NEW.engagement_id;
    IF parent_client_id IS NULL OR parent_client_id <> NEW.client_id OR parent_firm_id <> NEW.handling_firm_id THEN
      RAISE EXCEPTION 'Document, client and engagement must share the same client and handling firm.';
    END IF;
  ELSE
    SELECT default_firm_id INTO parent_firm_id FROM clients WHERE client_id = NEW.client_id;
    IF parent_firm_id IS NOT NULL AND parent_firm_id <> NEW.handling_firm_id THEN
      RAISE EXCEPTION 'A client-level document must use the client handling firm.';
    END IF;
  END IF;

  IF NEW.source_contact_id IS NOT NULL THEN
    SELECT client_id INTO source_client_id FROM client_contacts WHERE contact_id = NEW.source_contact_id;
    IF source_client_id IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'The source contact must belong to the document client.';
    END IF;
  END IF;

  IF NEW.source_communication_id IS NOT NULL THEN
    SELECT client_id, handling_firm_id INTO source_client_id, source_firm_id
    FROM communication_hub WHERE hub_communication_id = NEW.source_communication_id;
    IF source_firm_id IS DISTINCT FROM NEW.handling_firm_id
       OR (source_client_id IS NOT NULL AND source_client_id <> NEW.client_id) THEN
      RAISE EXCEPTION 'The source communication must belong to the document client and handling firm.';
    END IF;
  END IF;

  IF NEW.assigned_reviewer_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM user_firm_access
       WHERE user_id = NEW.assigned_reviewer_user_id AND firm_id = NEW.handling_firm_id
     ) THEN
    RAISE EXCEPTION 'The assigned reviewer must have access to the handling firm.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS documents_metadata_scope_check ON documents;
CREATE TRIGGER documents_metadata_scope_check
BEFORE INSERT OR UPDATE OF client_id, engagement_id, handling_firm_id, source_contact_id, source_communication_id, assigned_reviewer_user_id
ON documents FOR EACH ROW EXECUTE FUNCTION enforce_document_metadata_scope();

CREATE TABLE IF NOT EXISTS engagement_task_document_links (
  engagement_task_document_link_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES active_engagement_tasks(task_id) ON DELETE RESTRICT,
  document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  link_purpose TEXT NOT NULL CHECK (link_purpose IN ('SOURCE_EVIDENCE','WORKING_PAPER','SUPPORTING_EVIDENCE','DELIVERABLE','CLIENT_CORRESPONDENCE')),
  linked_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, document_id, link_purpose)
);

CREATE INDEX IF NOT EXISTS engagement_task_document_links_document_idx
  ON engagement_task_document_links (document_id);

CREATE OR REPLACE FUNCTION enforce_engagement_task_document_scope()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  task_firm_id BIGINT;
  task_client_id BIGINT;
  task_engagement_id BIGINT;
  document_firm_id BIGINT;
  document_client_id BIGINT;
  document_engagement_id BIGINT;
BEGIN
  SELECT engagement.handling_firm_id, engagement.client_id, task.engagement_id
    INTO task_firm_id, task_client_id, task_engagement_id
  FROM active_engagement_tasks task
  JOIN engagements engagement ON engagement.engagement_id = task.engagement_id
  WHERE task.task_id = NEW.task_id;

  SELECT handling_firm_id, client_id, engagement_id
    INTO document_firm_id, document_client_id, document_engagement_id
  FROM documents
  WHERE document_id = NEW.document_id;

  IF task_firm_id IS NULL OR document_firm_id IS NULL
     OR task_firm_id <> document_firm_id
     OR task_client_id <> document_client_id
     OR task_engagement_id <> document_engagement_id THEN
    RAISE EXCEPTION 'Document and task must belong to the same client, engagement and handling firm.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_task_document_scope_check ON engagement_task_document_links;
CREATE TRIGGER engagement_task_document_scope_check
BEFORE INSERT OR UPDATE ON engagement_task_document_links
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_task_document_scope();

CREATE TABLE IF NOT EXISTS document_access_grants (
  document_access_grant_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  permission_level TEXT NOT NULL CHECK (permission_level IN ('VIEW','REVIEW','MANAGE')),
  granted_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  revocation_note TEXT,
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK ((revoked_at IS NULL AND revoked_by_user_id IS NULL AND revocation_note IS NULL) OR (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL AND revocation_note IS NOT NULL AND length(trim(revocation_note)) > 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS document_access_grants_active_user_idx
  ON document_access_grants (document_id, user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS document_access_grants_user_idx
  ON document_access_grants (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS document_review_events (
  document_review_event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL CHECK (from_status IN ('NEEDS_CLASSIFICATION','ASSIGNED','IN_REVIEW','APPROVED','RETURNED','FINAL','ARCHIVED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('NEEDS_CLASSIFICATION','ASSIGNED','IN_REVIEW','APPROVED','RETURNED','FINAL','ARCHIVED')),
  actor_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  comment_text TEXT NOT NULL CHECK (length(trim(comment_text)) > 0),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_status <> to_status)
);

CREATE INDEX IF NOT EXISTS document_review_events_timeline_idx
  ON document_review_events (document_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_document_review_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Document review history is append-only.';
END;
$$;

DROP TRIGGER IF EXISTS document_review_events_immutable ON document_review_events;
CREATE TRIGGER document_review_events_immutable
BEFORE UPDATE OR DELETE ON document_review_events
FOR EACH ROW EXECUTE FUNCTION prevent_document_review_event_mutation();

CREATE OR REPLACE FUNCTION app_can_access_document(target_document_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM documents document
    JOIN vault_categories category ON category.category_id = document.category_id
    JOIN users actor ON actor.user_id = app_user_id()
    JOIN roles actor_role ON actor_role.role_id = actor.role_id
    WHERE document.document_id = target_document_id
      AND document.deleted_at IS NULL
      AND document.malware_scan_status IN ('CLEAN','NOT_APPLICABLE')
      AND actor.is_active
      AND app_has_firm_access(document.handling_firm_id)
      AND (
        actor_role.hierarchy_level <= 2
        OR document.assigned_reviewer_user_id = actor.user_id
        OR EXISTS (
          SELECT 1
          FROM document_access_grants grant_record
          WHERE grant_record.document_id = document.document_id
            AND grant_record.user_id = actor.user_id
            AND grant_record.revoked_at IS NULL
            AND (grant_record.expires_at IS NULL OR grant_record.expires_at > now())
        )
        OR (
          NOT category.is_restricted
          AND document.document_type NOT IN ('KYC','ENGAGEMENT_LETTER')
          AND (
            EXISTS (
              SELECT 1 FROM staff_assignments assignment
              WHERE assignment.engagement_id = document.engagement_id
                AND assignment.handling_firm_id = document.handling_firm_id
                AND assignment.user_id = actor.user_id
                AND CURRENT_DATE BETWEEN assignment.planned_start_date AND assignment.planned_end_date
            )
            OR EXISTS (
              SELECT 1
              FROM engagement_task_document_links link
              JOIN active_engagement_tasks task ON task.task_id = link.task_id
              WHERE link.document_id = document.document_id
                AND (task.assigned_to = actor.user_id OR task.assigned_role_name = actor_role.role_name)
                AND task.status NOT IN ('Completed','Rejected')
            )
            OR EXISTS (
              SELECT 1
              FROM tax_project_task_evidence evidence
              JOIN tax_period_project_tasks task ON task.tax_period_project_task_id = evidence.tax_period_project_task_id
              WHERE evidence.vault_document_id = document.document_id
                AND task.assigned_role_name = actor_role.role_name
                AND task.status NOT IN ('COMPLETED','CANCELLED')
            )
            OR EXISTS (
              SELECT 1
              FROM audit_file_attachments attachment
              JOIN audit_files audit_file ON audit_file.audit_file_id = attachment.audit_file_id
              JOIN staff_assignments assignment ON assignment.engagement_id = audit_file.engagement_id
              WHERE attachment.document_id = document.document_id
                AND assignment.user_id = actor.user_id
                AND assignment.handling_firm_id = document.handling_firm_id
                AND CURRENT_DATE BETWEEN assignment.planned_start_date AND assignment.planned_end_date
            )
            OR EXISTS (
              SELECT 1
              FROM communication_attachments attachment
              JOIN communication_hub communication ON communication.hub_communication_id = attachment.hub_communication_id
              JOIN staff_assignments assignment ON assignment.engagement_id = communication.engagement_id
              WHERE attachment.document_id = document.document_id
                AND assignment.user_id = actor.user_id
                AND assignment.handling_firm_id = document.handling_firm_id
                AND CURRENT_DATE BETWEEN assignment.planned_start_date AND assignment.planned_end_date
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION app_can_manage_document(target_document_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_can_access_document(target_document_id)
    AND (
      EXISTS (
        SELECT 1 FROM users actor JOIN roles actor_role ON actor_role.role_id = actor.role_id
        WHERE actor.user_id = app_user_id() AND actor_role.hierarchy_level <= 2
      )
      OR EXISTS (
        SELECT 1 FROM documents document
        WHERE document.document_id = target_document_id
          AND document.assigned_reviewer_user_id = app_user_id()
      )
      OR EXISTS (
        SELECT 1 FROM document_access_grants grant_record
        WHERE grant_record.document_id = target_document_id
          AND grant_record.user_id = app_user_id()
          AND grant_record.permission_level IN ('REVIEW','MANAGE')
          AND grant_record.revoked_at IS NULL
          AND (grant_record.expires_at IS NULL OR grant_record.expires_at > now())
      )
    );
$$;

CREATE OR REPLACE FUNCTION app_can_create_document(
  target_firm_id BIGINT,
  target_engagement_id BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_has_firm_access(target_firm_id)
    AND EXISTS (
      SELECT 1
      FROM users actor JOIN roles actor_role ON actor_role.role_id = actor.role_id
      WHERE actor.user_id = app_user_id()
        AND actor.is_active
        AND (
          actor_role.hierarchy_level <= 2
          OR EXISTS (
            SELECT 1 FROM staff_assignments assignment
            WHERE assignment.engagement_id = target_engagement_id
              AND assignment.handling_firm_id = target_firm_id
              AND assignment.user_id = actor.user_id
              AND CURRENT_DATE BETWEEN assignment.planned_start_date AND assignment.planned_end_date
          )
          OR EXISTS (
            SELECT 1 FROM active_engagement_tasks task
            WHERE task.engagement_id = target_engagement_id
              AND task.assigned_to = actor.user_id
              AND task.status NOT IN ('Completed','Rejected')
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION transition_document_review(
  target_document_id BIGINT,
  next_status TEXT,
  decision_comment TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  previous_status TEXT;
  uploader_user_id BIGINT;
  assigned_reviewer BIGINT;
BEGIN
  IF app_user_id() IS NULL OR NOT app_can_manage_document(target_document_id) THEN
    RAISE EXCEPTION 'You are not authorised to review this document.';
  END IF;
  IF decision_comment IS NULL OR length(trim(decision_comment)) = 0 THEN
    RAISE EXCEPTION 'A review comment is required.';
  END IF;

  SELECT review_status, uploaded_by, assigned_reviewer_user_id
    INTO previous_status, uploader_user_id, assigned_reviewer
  FROM documents WHERE document_id = target_document_id;
  IF previous_status IS NULL THEN
    RAISE EXCEPTION 'Document was not found.';
  END IF;

  IF NOT (
    (previous_status = 'NEEDS_CLASSIFICATION' AND next_status IN ('ASSIGNED','RETURNED'))
    OR (previous_status = 'ASSIGNED' AND next_status IN ('IN_REVIEW','RETURNED'))
    OR (previous_status = 'IN_REVIEW' AND next_status IN ('APPROVED','RETURNED'))
    OR (previous_status = 'RETURNED' AND next_status = 'ASSIGNED')
    OR (previous_status = 'APPROVED' AND next_status IN ('FINAL','RETURNED'))
    OR (previous_status = 'FINAL' AND next_status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'That document review transition is not allowed.';
  END IF;

  IF next_status = 'ASSIGNED' AND assigned_reviewer IS NULL THEN
    RAISE EXCEPTION 'Assign a reviewer before moving the document to Assigned.';
  END IF;
  IF next_status IN ('APPROVED','FINAL','ARCHIVED') AND uploader_user_id = app_user_id() THEN
    RAISE EXCEPTION 'The uploader cannot approve or finalise their own document.';
  END IF;

  PERFORM set_config('app.document_review_transition','on',true);
  UPDATE documents
  SET review_status = next_status,
      reviewed_by_user_id = app_user_id(),
      reviewed_at = now(),
      review_comment = trim(decision_comment),
      is_locked = is_locked OR next_status IN ('FINAL','ARCHIVED')
  WHERE document_id = target_document_id;
  PERFORM set_config('app.document_review_transition','off',true);

  INSERT INTO document_review_events
    (document_id, from_status, to_status, actor_user_id, comment_text)
  VALUES
    (target_document_id, previous_status, next_status, app_user_id(), trim(decision_comment));
END;
$$;

CREATE OR REPLACE FUNCTION protect_document_review_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     AND current_setting('app.document_review_transition',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Use the controlled document review workflow to change review status.';
  END IF;
  IF OLD.is_locked AND NOT NEW.is_locked THEN
    RAISE EXCEPTION 'A locked document cannot be unlocked; upload a superseding version.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_protect_review_state ON documents;
CREATE TRIGGER documents_protect_review_state
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION protect_document_review_state();

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_task_document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_by_firm_access ON documents;
DROP POLICY IF EXISTS documents_select_by_assignment ON documents;
DROP POLICY IF EXISTS documents_insert_by_assignment ON documents;
DROP POLICY IF EXISTS documents_update_by_reviewer ON documents;
DROP POLICY IF EXISTS engagement_task_document_links_select ON engagement_task_document_links;
DROP POLICY IF EXISTS engagement_task_document_links_manage ON engagement_task_document_links;
DROP POLICY IF EXISTS engagement_task_document_links_update ON engagement_task_document_links;
DROP POLICY IF EXISTS document_access_grants_select ON document_access_grants;
DROP POLICY IF EXISTS document_access_grants_manage ON document_access_grants;
DROP POLICY IF EXISTS document_access_grants_update ON document_access_grants;
DROP POLICY IF EXISTS document_review_events_select ON document_review_events;
DROP POLICY IF EXISTS document_review_events_insert ON document_review_events;
DROP POLICY IF EXISTS document_access_logs_select_by_assignment ON document_access_logs;
DROP POLICY IF EXISTS document_access_logs_insert_by_actor ON document_access_logs;
CREATE POLICY documents_select_by_assignment ON documents FOR SELECT
USING (app_can_access_document(document_id));
CREATE POLICY documents_insert_by_assignment ON documents FOR INSERT
WITH CHECK (app_can_create_document(handling_firm_id, engagement_id));
CREATE POLICY documents_update_by_reviewer ON documents FOR UPDATE
USING (app_can_manage_document(document_id))
WITH CHECK (app_can_manage_document(document_id));

CREATE POLICY engagement_task_document_links_select ON engagement_task_document_links FOR SELECT
USING (app_can_access_document(document_id));
CREATE POLICY engagement_task_document_links_manage ON engagement_task_document_links FOR INSERT
WITH CHECK (app_can_manage_document(document_id) AND linked_by_user_id = app_user_id());
CREATE POLICY engagement_task_document_links_update ON engagement_task_document_links FOR UPDATE
USING (app_can_manage_document(document_id))
WITH CHECK (app_can_manage_document(document_id));

CREATE POLICY document_access_grants_select ON document_access_grants FOR SELECT
USING (app_can_access_document(document_id));
CREATE POLICY document_access_grants_manage ON document_access_grants FOR INSERT
WITH CHECK (
  app_has_firm_access((SELECT handling_firm_id FROM documents WHERE documents.document_id = document_access_grants.document_id))
  AND granted_by_user_id = app_user_id()
  AND EXISTS (SELECT 1 FROM users actor JOIN roles role ON role.role_id = actor.role_id
              WHERE actor.user_id = app_user_id() AND actor.is_active AND role.hierarchy_level <= 2)
);
CREATE POLICY document_access_grants_update ON document_access_grants FOR UPDATE
USING (
  app_has_firm_access((SELECT handling_firm_id FROM documents WHERE documents.document_id = document_access_grants.document_id))
  AND EXISTS (SELECT 1 FROM users actor JOIN roles role ON role.role_id = actor.role_id
              WHERE actor.user_id = app_user_id() AND role.hierarchy_level <= 2)
)
WITH CHECK (
  app_has_firm_access((SELECT handling_firm_id FROM documents WHERE documents.document_id = document_access_grants.document_id))
  AND EXISTS (SELECT 1 FROM users actor JOIN roles role ON role.role_id = actor.role_id
              WHERE actor.user_id = app_user_id() AND role.hierarchy_level <= 2)
);

ALTER TABLE document_access_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_access_logs_select_by_assignment ON document_access_logs;
DROP POLICY IF EXISTS document_access_logs_insert_by_actor ON document_access_logs;
CREATE POLICY document_access_logs_select_by_assignment ON document_access_logs FOR SELECT
USING (app_can_access_document(document_id));
CREATE POLICY document_access_logs_insert_by_actor ON document_access_logs FOR INSERT
WITH CHECK (app_can_access_document(document_id) AND user_id = app_user_id());

CREATE OR REPLACE FUNCTION prevent_document_access_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $
BEGIN
  RAISE EXCEPTION 'Document access history is append-only.';
END;
$;

DROP TRIGGER IF EXISTS document_access_logs_immutable ON document_access_logs;
CREATE TRIGGER document_access_logs_immutable
BEFORE UPDATE OR DELETE ON document_access_logs
FOR EACH ROW EXECUTE FUNCTION prevent_document_access_log_mutation();

CREATE POLICY document_review_events_select ON document_review_events FOR SELECT
USING (app_can_access_document(document_id));
CREATE POLICY document_review_events_insert ON document_review_events FOR INSERT
WITH CHECK (app_can_manage_document(document_id) AND actor_user_id = app_user_id());

COMMIT;

-- Client portal uploads and email/WhatsApp ingestion must use authenticated,
-- server-side endpoints. The browser-local preview cannot enforce these rules,
-- validate malware scans, store file bytes or issue secure download links.
