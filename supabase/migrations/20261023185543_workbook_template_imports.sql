-- Add workbook expenditure sources without changing private storage or record access.
BEGIN;
ALTER TABLE erp_private.workbook_batches DROP CONSTRAINT workbook_batches_dataset_check;
ALTER TABLE erp_private.workbook_batches ADD CONSTRAINT workbook_batches_dataset_check
 CHECK (dataset IN ('Sales','Purchases','Bank','General','Expenditure','Non-eTIMS'));
ALTER TABLE erp_private.workbook_rows ADD COLUMN review_details jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK (jsonb_typeof(review_details)='object');
CREATE OR REPLACE FUNCTION erp_private.workbook_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['route','category_code','narration','asset_details','review_details','revision','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['route','category_code','narration','asset_details','review_details','revision','updated_at']) THEN
 RAISE EXCEPTION 'Imported source rows are immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE INDEX workbook_cost_reference_idx ON erp_private.workbook_rows(client_id,upper(normalized->>'invoice')) WHERE dataset IN ('Purchases','Expenditure','Non-eTIMS');
COMMIT;
