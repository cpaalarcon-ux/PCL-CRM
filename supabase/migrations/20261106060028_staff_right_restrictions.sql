-- Function-level rights. A Manager or Partner can switch off one named function (for example "Verify KYC") for one person.
-- Like the area restrictions, this only narrows what the role already allows; the server refuses the matching actions.
CREATE TABLE erp_private.staff_right_restrictions (
  staff_id uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  right_code text NOT NULL CHECK (right_code ~ '^[a-z]+\.[a-z_]+$'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3 AND length(reason) <= 1000),
  created_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, right_code)
);
CREATE INDEX staff_right_restrictions_created_by_idx ON erp_private.staff_right_restrictions(created_by);

ALTER TABLE erp_private.staff_right_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.staff_right_restrictions FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON erp_private.staff_right_restrictions TO erp_api;

CREATE POLICY staff_right_restrictions_read ON erp_private.staff_right_restrictions
  FOR SELECT TO erp_api USING (staff_id = (erp_private.actor()).staff_id OR erp_private.manages(staff_id));
CREATE POLICY staff_right_restrictions_insert ON erp_private.staff_right_restrictions
  FOR INSERT TO erp_api WITH CHECK (erp_private.manages(staff_id) AND created_by = (erp_private.actor()).staff_id);
CREATE POLICY staff_right_restrictions_delete ON erp_private.staff_right_restrictions
  FOR DELETE TO erp_api USING (erp_private.manages(staff_id));
