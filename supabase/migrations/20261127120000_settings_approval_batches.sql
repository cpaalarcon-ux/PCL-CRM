-- Actionable settings approvals. Keep proposal identity and batch audit data in erp_private;
-- all decisions still pass through the existing typed application handlers.
ALTER TABLE erp_private.account_catalog
  ADD COLUMN proposed_by uuid REFERENCES erp_private.staff_members(staff_id),
  ADD COLUMN approved_by uuid REFERENCES erp_private.staff_members(staff_id),
  ADD COLUMN approved_at timestamptz;

-- Recover proposal identity for existing draft additions from their immutable insert audit event.
UPDATE erp_private.account_catalog c
SET proposed_by=x.staff_id
FROM (
  SELECT DISTINCT ON (e.record_key) e.record_key,s.staff_id
  FROM erp_private.audit_events e
  JOIN erp_private.staff_members s ON s.auth_user_id=e.actor_auth_id
  WHERE e.table_name='account_catalog' AND e.action='INSERT'
  ORDER BY e.record_key,e.occurred_at
) x
WHERE c.code=x.record_key AND c.status='Draft' AND c.proposed_by IS NULL;

ALTER TABLE erp_private.account_catalog
  ADD CONSTRAINT account_catalog_approval_separation_check
  CHECK(proposed_by IS NULL OR approved_by IS NULL OR proposed_by<>approved_by);

CREATE FUNCTION erp_private.account_catalog_approval_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
  a:=erp_private.actor();
  IF TG_OP='UPDATE' AND NEW.proposed_by IS DISTINCT FROM OLD.proposed_by THEN
    RAISE EXCEPTION 'The account proposer is retained and cannot be changed.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND current_user='erp_api' AND NEW.status='Draft' AND NEW.proposed_by IS DISTINCT FROM a.staff_id THEN
    RAISE EXCEPTION 'A draft account must retain its proposer.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='Draft' AND NEW.status='Active' AND current_user='erp_api' THEN
    IF a.category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required.' USING ERRCODE='42501'; END IF;
    IF OLD.proposed_by IS NULL OR OLD.proposed_by=a.staff_id THEN RAISE EXCEPTION 'A different Partner must approve a draft account with a known proposer.' USING ERRCODE='42501'; END IF;
    IF NEW.approved_by IS DISTINCT FROM a.staff_id OR NEW.approved_at IS NULL THEN RAISE EXCEPTION 'Record the approving Partner and approval time.' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.account_catalog_approval_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.account_catalog_approval_guard() TO erp_api;
CREATE TRIGGER catalog_approval_guard BEFORE INSERT OR UPDATE ON erp_private.account_catalog
  FOR EACH ROW EXECUTE FUNCTION erp_private.account_catalog_approval_guard();

CREATE TABLE erp_private.approval_batches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  record_type text NOT NULL CHECK(record_type IN('TAX_RATE','CHART_ACCOUNT','STATEMENT_MAP')),
  items_approved integer NOT NULL CHECK(items_approved>0),
  item_ids jsonb NOT NULL CHECK(jsonb_typeof(item_ids)='array' AND jsonb_array_length(item_ids)=items_approved),
  review_confirmed boolean NOT NULL CHECK(review_confirmed),
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_batches_batch_idx ON erp_private.approval_batches(batch_id,record_type);
CREATE INDEX approval_batches_user_idx ON erp_private.approval_batches(user_id,approved_at DESC);
ALTER TABLE erp_private.approval_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.approval_batches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.approval_batches FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.approval_batches TO erp_api;
CREATE POLICY approval_batches_read ON erp_private.approval_batches FOR SELECT TO erp_api
  USING((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY approval_batches_add ON erp_private.approval_batches FOR INSERT TO erp_api
  WITH CHECK(user_id=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND review_confirmed);
CREATE TRIGGER approval_batch_audit AFTER INSERT ON erp_private.approval_batches
  FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('id');
CREATE TRIGGER approval_batch_no_delete BEFORE DELETE ON erp_private.approval_batches
  FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
