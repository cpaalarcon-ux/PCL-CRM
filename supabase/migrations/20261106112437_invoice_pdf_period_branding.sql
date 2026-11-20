-- Invoice PDF: the service period is its own field, the balance brought forward is fixed when the invoice is posted,
-- each firm can carry its logo, and a firm can number invoices continuously (INV/ACL/00323) instead of by year.
ALTER TABLE erp_private.invoices
 ADD COLUMN service_from date,ADD COLUMN service_to date,ADD COLUMN service_months integer,
 ADD COLUMN brought_forward numeric(16,2) CHECK(brought_forward IS NULL OR brought_forward>=0),
 ADD CONSTRAINT invoice_service_period CHECK((service_from IS NULL)=(service_to IS NULL) AND (service_from IS NULL OR service_to>=service_from)),
 ADD CONSTRAINT invoice_service_months CHECK(service_months IS NULL OR (service_from IS NOT NULL AND service_months BETWEEN 1 AND 60));
ALTER TABLE erp_private.firms
 ADD COLUMN invoice_numbering text NOT NULL DEFAULT 'yearly' CHECK(invoice_numbering IN ('yearly','continuous'));
CREATE TABLE erp_private.firm_logos(
 firm_id uuid PRIMARY KEY REFERENCES erp_private.firms,
 mime_type text NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
 data_base64 text NOT NULL CHECK(length(data_base64) BETWEEN 60 AND 400000),
 updated_by uuid NOT NULL REFERENCES erp_private.staff_members,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX firm_logos_updated_by_idx ON erp_private.firm_logos(updated_by);
ALTER TABLE erp_private.firm_logos ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.firm_logos FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_logos_read ON erp_private.firm_logos FOR SELECT TO erp_api USING(erp_private.firm_allowed(firm_id));
CREATE POLICY firm_logos_add ON erp_private.firm_logos FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND updated_by=(erp_private.actor()).staff_id);
CREATE POLICY firm_logos_change ON erp_private.firm_logos FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER' AND updated_by=(erp_private.actor()).staff_id);
REVOKE ALL ON erp_private.firm_logos FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE ON erp_private.firm_logos TO erp_api;
-- The logo image is not copied into the audit trail; the action records a small audit event (firm, type, size, who) instead.
