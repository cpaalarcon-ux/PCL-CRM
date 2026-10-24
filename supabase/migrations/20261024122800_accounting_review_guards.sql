-- Enforce review separation in the database as well as in the API.
CREATE OR REPLACE FUNCTION erp_private.accounting_control_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF TG_TABLE_NAME='account_catalog' THEN
  IF TG_OP='UPDATE' AND OLD.status='Active' THEN RAISE EXCEPTION 'Active account identity is immutable; add another code' USING ERRCODE='23514';END IF;
  IF NEW.status='Active' AND current_user='erp_api' AND a.category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='sales_reconciliations' THEN
  IF TG_OP='INSERT' THEN
   IF current_user='erp_api' AND (NEW.status<>'Draft' OR NEW.prepared_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Create your own draft review' USING ERRCODE='42501';END IF;
  ELSE
   IF OLD.status='Locked' THEN RAISE EXCEPTION 'Approved reconciliation is immutable' USING ERRCODE='23514';END IF;
   IF (NEW.project_id,NEW.review_type,NEW.starts_on,NEW.ends_on,NEW.prepared_by) IS DISTINCT FROM (OLD.project_id,OLD.review_type,OLD.starts_on,OLD.ends_on,OLD.prepared_by) THEN RAISE EXCEPTION 'Reconciliation identity is immutable' USING ERRCODE='23514';END IF;
   IF OLD.status='Submitted' THEN
    IF NEW.status NOT IN ('Locked','Returned') THEN RAISE EXCEPTION 'Reviewer must return submitted work' USING ERRCODE='23514';END IF;
    IF current_user='erp_api' AND (a.staff_id=OLD.prepared_by OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR length(btrim(coalesce(NEW.review_note,'')))=0) THEN RAISE EXCEPTION 'Independent review and conclusion required' USING ERRCODE='42501';END IF;
    IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_note','review_snapshot','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_note','review_snapshot','revision','updated_at']) THEN RAISE EXCEPTION 'Return work before changing submitted values' USING ERRCODE='23514';END IF;
   ELSE
    IF current_user='erp_api' AND a.staff_id IS DISTINCT FROM OLD.prepared_by THEN RAISE EXCEPTION 'Assigned preparer must change the draft' USING ERRCODE='42501';END IF;
    IF NEW.status NOT IN ('Draft','Submitted') THEN RAISE EXCEPTION 'Submit before approval' USING ERRCODE='23514';END IF;
   END IF;
  END IF;
 END IF;RETURN NEW;
END;$$;
DROP TRIGGER control_guard ON erp_private.sales_reconciliations;
CREATE TRIGGER control_guard BEFORE INSERT OR UPDATE ON erp_private.sales_reconciliations FOR EACH ROW EXECUTE FUNCTION erp_private.accounting_control_guard();
ALTER TABLE erp_private.sales_reconciliations ADD CONSTRAINT sales_review_preparer_idx_check CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by);
CREATE INDEX sales_recon_preparer_idx ON erp_private.sales_reconciliations(prepared_by);
CREATE INDEX sales_recon_reviewer_idx ON erp_private.sales_reconciliations(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX accounting_policy_staff_idx ON erp_private.accounting_policies(configured_by);
CREATE INDEX sales_version_staff_idx ON erp_private.sales_review_versions(created_by);
CREATE INDEX sales_version_recon_idx ON erp_private.sales_review_versions(reconciliation_id);
