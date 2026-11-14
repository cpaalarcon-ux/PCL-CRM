-- Optional per-person restrictions narrow role defaults. Existing handlers
-- still enforce role, maker-checker and firm/project scope independently.
CREATE TABLE erp_private.staff_area_restrictions (
  staff_id uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  area_code text NOT NULL CHECK (area_code IN (
    'clients','projects','time_hr','documents','communications',
    'billing_wip','audit','leads','staff_access','settings'
  )),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3 AND length(reason) <= 1000),
  created_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, area_code)
);

CREATE INDEX staff_area_restrictions_actor_idx
  ON erp_private.staff_area_restrictions(staff_id, area_code);

ALTER TABLE erp_private.staff_area_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.staff_area_restrictions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON erp_private.staff_area_restrictions TO erp_api;

CREATE POLICY staff_area_restrictions_read
  ON erp_private.staff_area_restrictions
  FOR SELECT TO erp_api
  USING (staff_id = (erp_private.actor()).staff_id OR erp_private.manages(staff_id));

CREATE POLICY staff_area_restrictions_insert
  ON erp_private.staff_area_restrictions
  FOR INSERT TO erp_api
  WITH CHECK (
    erp_private.manages(staff_id)
    AND created_by = (erp_private.actor()).staff_id
  );

CREATE POLICY staff_area_restrictions_delete
  ON erp_private.staff_area_restrictions
  FOR DELETE TO erp_api
  USING (erp_private.manages(staff_id));
