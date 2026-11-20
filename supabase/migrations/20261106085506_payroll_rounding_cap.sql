-- Payroll rounding tolerance. Each tax or deduction amount may differ from the uploaded payroll by up to KES 1 per employee (fixed in the
-- application) as long as the month's total of such differences stays within this cap. Only a Partner can change the cap.
CREATE TABLE erp_private.payroll_tolerance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  monthly_cap_kes numeric(10,2) NOT NULL DEFAULT 50 CHECK (monthly_cap_kes >= 0 AND monthly_cap_kes <= 1000),
  reason text,
  updated_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_tolerance_updated_by_idx ON erp_private.payroll_tolerance(updated_by);
INSERT INTO erp_private.payroll_tolerance(singleton) VALUES (true);

ALTER TABLE erp_private.payroll_tolerance ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.payroll_tolerance FORCE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON erp_private.payroll_tolerance TO erp_api;
CREATE POLICY payroll_tolerance_read ON erp_private.payroll_tolerance FOR SELECT TO erp_api USING (true);
CREATE POLICY payroll_tolerance_partner_update ON erp_private.payroll_tolerance FOR UPDATE TO erp_api
  USING (coalesce((erp_private.actor()).category_code = 'PARTNER', false))
  WITH CHECK (coalesce((erp_private.actor()).category_code = 'PARTNER', false) AND updated_by = (erp_private.actor()).staff_id);
