-- Build 2857: evidence folders. Setting a service up makes one evidence folder for each task, in the same step as the task. A folder is a record with a fixed path
-- (Clients/<client>/<service>_<year>/Period_<yyyy-mm>/<task>/) that the task's evidence is filed under. Private storage has no empty folders, so the record is the folder.
-- A folder is a record and is not changed or removed; a task that is later dropped keeps its folder as history.
CREATE TABLE erp_private.evidence_folders(
 folder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL UNIQUE REFERENCES erp_private.tasks ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 setup_id uuid REFERENCES erp_private.engagement_setups ON DELETE RESTRICT,
 service_code text NOT NULL REFERENCES erp_private.services(service_code) ON DELETE RESTRICT,
 period_start date NOT NULL,
 period_end date NOT NULL,
 path_prefix text NOT NULL CHECK(path_prefix ~ '^Clients/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/Period_[0-9]{4}-[0-9]{2}/[A-Za-z0-9_:-]+/$' AND char_length(path_prefix)<=300),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(period_end>=period_start),
 UNIQUE(project_id,path_prefix)
);
CREATE INDEX evidence_folders_client_idx ON erp_private.evidence_folders(client_id);
CREATE INDEX evidence_folders_setup_idx ON erp_private.evidence_folders(setup_id) WHERE setup_id IS NOT NULL;
CREATE INDEX evidence_folders_service_idx ON erp_private.evidence_folders(service_code);
CREATE INDEX evidence_folders_created_by_idx ON erp_private.evidence_folders(created_by);
ALTER TABLE erp_private.evidence_folders ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.evidence_folders FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.evidence_folders TO erp_api;
CREATE POLICY evidence_folders_read ON erp_private.evidence_folders FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY evidence_folders_insert ON erp_private.evidence_folders FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id);
CREATE FUNCTION erp_private.evidence_folders_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'An evidence folder is a record and is not changed or removed.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.evidence_folders FOR EACH ROW EXECUTE FUNCTION erp_private.evidence_folders_immutable();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.evidence_folders FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('folder_id');
