-- Recurring engagement fees are separate from recurring work/task schedules.
-- This migration creates controlled fee schedules and keeps generated invoices
-- as drafts until a Partner reviews and posts them.
CREATE TABLE erp_private.recurring_fee_schedules (
 fee_schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 frequency text NOT NULL CHECK(frequency IN ('Monthly','Quarterly','Annually')),
 amount_ex_vat numeric(16,2) NOT NULL CHECK(amount_ex_vat>0),
 vat_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK(vat_rate BETWEEN 0 AND 100),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 300),
 starts_on date NOT NULL,
 ends_on date,
 status text NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Paused','Cancelled','Ended')),
 status_reason text,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 updated_by uuid NOT NULL REFERENCES erp_private.staff_members,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on IS NULL OR ends_on>=starts_on)
);
CREATE UNIQUE INDEX recurring_fee_one_current_per_project
 ON erp_private.recurring_fee_schedules(project_id) WHERE status IN ('Active','Paused');
CREATE INDEX recurring_fee_project_status ON erp_private.recurring_fee_schedules(project_id,status,starts_on);

ALTER TABLE erp_private.invoices
 ADD COLUMN recurring_fee_schedule_id uuid REFERENCES erp_private.recurring_fee_schedules ON DELETE RESTRICT,
 ADD COLUMN recurring_period_start date,
 ADD CONSTRAINT invoice_recurring_period_pair CHECK((recurring_fee_schedule_id IS NULL)=(recurring_period_start IS NULL));
CREATE UNIQUE INDEX invoice_recurring_fee_once_per_period
 ON erp_private.invoices(recurring_fee_schedule_id,recurring_period_start)
 WHERE recurring_fee_schedule_id IS NOT NULL;

ALTER TABLE erp_private.recurring_fee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.recurring_fee_schedules FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.recurring_fee_schedules TO erp_api;
CREATE TRIGGER recurring_fee_no_delete BEFORE DELETE ON erp_private.recurring_fee_schedules
 FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER recurring_fee_audit AFTER INSERT OR UPDATE ON erp_private.recurring_fee_schedules
 FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('fee_schedule_id');
CREATE TRIGGER recurring_fee_revision BEFORE UPDATE ON erp_private.recurring_fee_schedules
 FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE POLICY recurring_fee_read ON erp_private.recurring_fee_schedules FOR SELECT TO erp_api
 USING(erp_private.finance_allowed(project_id));
CREATE POLICY recurring_fee_add ON erp_private.recurring_fee_schedules FOR INSERT TO erp_api
 WITH CHECK(erp_private.is_leader() AND erp_private.finance_allowed(project_id,true)
  AND created_by=(erp_private.actor()).staff_id AND updated_by=(erp_private.actor()).staff_id);
CREATE POLICY recurring_fee_update ON erp_private.recurring_fee_schedules FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND erp_private.finance_allowed(project_id,true))
 WITH CHECK(erp_private.is_leader() AND erp_private.finance_allowed(project_id,true)
  AND updated_by=(erp_private.actor()).staff_id);
