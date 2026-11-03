CREATE TABLE erp_private.workbook_batches (
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 document_id uuid NOT NULL REFERENCES erp_private.documents,sheet_name text NOT NULL,header_row integer NOT NULL CHECK(header_row>0),
 dataset text NOT NULL CHECK(dataset IN ('Sales','Purchases','Bank','General')),period_start date NOT NULL,period_end date NOT NULL,
 column_map jsonb NOT NULL,source_count integer NOT NULL,new_count integer NOT NULL,duplicate_count integer NOT NULL,rejected_count integer NOT NULL,
 uploaded_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_count=new_count+duplicate_count+rejected_count),CHECK(period_end>=period_start)
);
CREATE INDEX workbook_batches_project_idx ON erp_private.workbook_batches(project_id,created_at);
CREATE INDEX workbook_batches_document_idx ON erp_private.workbook_batches(document_id);
CREATE INDEX workbook_batches_staff_idx ON erp_private.workbook_batches(uploaded_by);
CREATE TABLE erp_private.workbook_rows (
 row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES erp_private.workbook_batches DEFERRABLE INITIALLY DEFERRED,
 project_id uuid NOT NULL REFERENCES erp_private.projects,client_id uuid NOT NULL REFERENCES erp_private.clients,
 dataset text NOT NULL,source_row integer NOT NULL,row_key text NOT NULL,raw_values jsonb NOT NULL,normalized jsonb NOT NULL,
 route integer CHECK(route IN (1,2,3)),category_code text,narration text,asset_details text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 UNIQUE(client_id,dataset,row_key)
);
CREATE INDEX workbook_rows_batch_idx ON erp_private.workbook_rows(batch_id);
CREATE INDEX workbook_rows_project_idx ON erp_private.workbook_rows(project_id);
CREATE TABLE erp_private.workbook_rejections (
 rejection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES erp_private.workbook_batches,
 source_row integer NOT NULL,reason text NOT NULL,raw_values jsonb NOT NULL
);
CREATE INDEX workbook_rejections_batch_idx ON erp_private.workbook_rejections(batch_id);
CREATE FUNCTION erp_private.workbook_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['route','category_code','narration','asset_details','revision','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['route','category_code','narration','asset_details','revision','updated_at']) THEN
 RAISE EXCEPTION 'Imported source rows are immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER workbook_row_guard BEFORE UPDATE ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.workbook_row_guard();


-- Relational identity constraints prevent a workbook row being relinked to another client/project.
ALTER TABLE erp_private.projects ADD CONSTRAINT projects_client_pair UNIQUE(project_id,client_id);
ALTER TABLE erp_private.documents ADD CONSTRAINT documents_project_pair UNIQUE(document_id,project_id);
ALTER TABLE erp_private.workbook_batches ADD CONSTRAINT batch_project_pair UNIQUE(batch_id,project_id),
 ADD CONSTRAINT batch_document_project_fk FOREIGN KEY(document_id,project_id) REFERENCES erp_private.documents(document_id,project_id);
ALTER TABLE erp_private.workbook_rows ADD CONSTRAINT rows_client_project_fk FOREIGN KEY(project_id,client_id) REFERENCES erp_private.projects(project_id,client_id),
 ADD CONSTRAINT rows_batch_project_fk FOREIGN KEY(batch_id,project_id) REFERENCES erp_private.workbook_batches(batch_id,project_id) DEFERRABLE INITIALLY DEFERRED;

;

