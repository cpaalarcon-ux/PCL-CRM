-- Client support services (build 2026-11-10.2750), from the Partner's written instruction of 10 Nov 2026 17:46.
-- This is the CLIENT-facing service desk (for example KRA notice lifting). It is separate from the internal staff help desk (erp_private.support_tickets), which is not
-- changed and bills nobody. Each service is flagged billable or not; a ticket for a billable service produces a DRAFT invoice when, and only when, the ticket is closed.
--   Billable:     KRA Agency Notice Lifting, Compliance Certificate Application, KRA Ledger Reconciliation, KRA VAT/Tax Compounding
--   Not billable: KRA Obligation Addition/Removal, General Queries
-- The invoice is a draft: a person with billing rights still posts it, and the existing rules apply (all fee lines at 16% VAT, a verified engagement letter before posting).
-- The fee amount is a person's entry on the ticket; no fee schedule or rate is stored or invented here.

CREATE TABLE erp_private.client_support_services(
 service_code text PRIMARY KEY CHECK(service_code ~ '^[A-Z][A-Z_]{2,48}$'),
 service_name text NOT NULL UNIQUE CHECK(btrim(service_name)<>''),
 is_billable boolean NOT NULL,
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL,
 source_note text NOT NULL CHECK(char_length(btrim(source_note))>=10),
 changed_by uuid REFERENCES erp_private.staff_members,
 changed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1
);
CREATE INDEX client_support_services_changed_by_idx ON erp_private.client_support_services(changed_by) WHERE changed_by IS NOT NULL;
INSERT INTO erp_private.client_support_services(service_code,service_name,is_billable,sort_order,source_note) VALUES
 ('KRA_NOTICE_LIFTING','KRA Agency Notice Lifting',true,1,'Billable, by the Partner''s written instruction of 10 Nov 2026 17:46.'),
 ('COMPLIANCE_CERT_APPLICATION','Compliance Certificate Application',true,2,'Billable, by the Partner''s written instruction of 10 Nov 2026 17:46.'),
 ('KRA_LEDGER_RECONCILIATION','KRA Ledger Reconciliation',true,3,'Billable, by the Partner''s written instruction of 10 Nov 2026 17:46.'),
 ('KRA_VAT_TAX_COMPOUNDING','KRA VAT/Tax Compounding',true,4,'Billable, by the Partner''s written instruction of 10 Nov 2026 17:46.'),
 ('KRA_OBLIGATION_CHANGE','KRA Obligation Addition/Removal',false,5,'Not billable, by the Partner''s written instruction of 10 Nov 2026 17:46.'),
 ('GENERAL_QUERY','General Queries',false,6,'Not billable, by the Partner''s written instruction of 10 Nov 2026 17:46.');

CREATE FUNCTION erp_private.client_support_service_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF ROW(NEW.service_code,NEW.service_name,NEW.sort_order) IS DISTINCT FROM ROW(OLD.service_code,OLD.service_name,OLD.sort_order) THEN RAISE EXCEPTION 'A service cannot be renamed or renumbered.' USING ERRCODE='23514'; END IF;
 IF a.staff_id IS NOT NULL AND a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner decides which client services are billed.' USING ERRCODE='42501'; END IF;
 IF NEW.is_billable IS DISTINCT FROM OLD.is_billable OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
  IF NEW.source_note IS NOT DISTINCT FROM OLD.source_note OR char_length(btrim(NEW.source_note))<10 THEN RAISE EXCEPTION 'Record where the Partner''s decision is written (at least 10 characters).' USING ERRCODE='23514'; END IF;
  NEW.changed_by:=a.staff_id; NEW.changed_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_support_service_guard BEFORE UPDATE ON erp_private.client_support_services FOR EACH ROW EXECUTE FUNCTION erp_private.client_support_service_guard();
CREATE TRIGGER client_support_service_no_delete BEFORE DELETE ON erp_private.client_support_services FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_support_services FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER UPDATE ON erp_private.client_support_services FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('service_code');

CREATE TABLE erp_private.client_support_tickets(
 ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 client_id uuid NOT NULL,
 firm_id uuid NOT NULL,
 project_id uuid,
 service_code text NOT NULL REFERENCES erp_private.client_support_services,
 subject text NOT NULL CHECK(char_length(btrim(subject)) BETWEEN 3 AND 200),
 details text NOT NULL CHECK(char_length(btrim(details))>=3 AND char_length(details)<=4000),
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','In progress','Waiting on client','Work done','Closed','Cancelled')),
 opened_by uuid NOT NULL REFERENCES erp_private.staff_members,
 assigned_to uuid NOT NULL REFERENCES erp_private.staff_members,
 opened_at timestamptz NOT NULL DEFAULT now(),
 fee_amount numeric(16,2) CHECK(fee_amount IS NULL OR fee_amount>0),
 invoice_id uuid UNIQUE REFERENCES erp_private.invoices,
 resolution text CHECK(resolution IS NULL OR char_length(btrim(resolution))>=10),
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links,
 FOREIGN KEY(project_id,client_id,firm_id) REFERENCES erp_private.projects(project_id,client_id,handling_firm_id),
 CHECK((status IN('Closed','Cancelled'))=(closed_at IS NOT NULL AND closed_by IS NOT NULL AND resolution IS NOT NULL)),
 CHECK(invoice_id IS NULL OR (status='Closed' AND fee_amount IS NOT NULL)),
 CHECK(status<>'Cancelled' OR (invoice_id IS NULL AND fee_amount IS NULL))
);
CREATE INDEX client_support_client_idx ON erp_private.client_support_tickets(client_id,status,opened_at DESC);
CREATE INDEX client_support_assigned_idx ON erp_private.client_support_tickets(assigned_to,status);
CREATE INDEX client_support_service_idx ON erp_private.client_support_tickets(service_code);
CREATE INDEX client_support_opened_by_idx ON erp_private.client_support_tickets(opened_by);
CREATE INDEX client_support_closed_by_idx ON erp_private.client_support_tickets(closed_by) WHERE closed_by IS NOT NULL;
CREATE INDEX client_support_project_idx ON erp_private.client_support_tickets(project_id,client_id,firm_id) WHERE project_id IS NOT NULL;

CREATE FUNCTION erp_private.client_support_ticket_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;s erp_private.client_support_services;i erp_private.invoices;w erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code IN('INTERN','ADMIN') THEN RAISE EXCEPTION 'Your role does not handle client support tickets.' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM erp_private.client_support_services WHERE service_code=NEW.service_code;
 SELECT * INTO w FROM erp_private.staff_members WHERE staff_id=NEW.assigned_to AND deleted_at IS NULL AND access_status='Active';
 IF NOT FOUND OR w.category_code IN('INTERN','ADMIN') THEN RAISE EXCEPTION 'Assign the ticket to an active member of staff who handles client work.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT s.is_active THEN RAISE EXCEPTION 'That service is switched off.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'Open' OR NEW.invoice_id IS NOT NULL OR NEW.fee_amount IS NOT NULL OR NEW.resolution IS NOT NULL THEN RAISE EXCEPTION 'A new ticket starts open, without a fee or an invoice.' USING ERRCODE='23514'; END IF;
  NEW.opened_by:=a.staff_id; NEW.opened_at:=now();
  RETURN NEW;
 END IF;
 IF OLD.status IN('Closed','Cancelled') THEN RAISE EXCEPTION 'A closed or cancelled ticket cannot be changed.' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.ticket_id,NEW.ticket_number,NEW.client_id,NEW.firm_id,NEW.service_code,NEW.opened_by,NEW.opened_at) IS DISTINCT FROM ROW(OLD.ticket_id,OLD.ticket_number,OLD.client_id,OLD.firm_id,OLD.service_code,OLD.opened_by,OLD.opened_at)
  THEN RAISE EXCEPTION 'The client, firm and service of a ticket cannot be changed. Cancel it and open a new one.' USING ERRCODE='23514'; END IF;
 IF NEW.fee_amount IS NOT NULL AND NOT s.is_billable THEN RAISE EXCEPTION '% is not a billable service, so it takes no fee.',s.service_name USING ERRCODE='23514'; END IF;
 IF NEW.status='Closed' THEN
  IF s.is_billable THEN
   IF NEW.fee_amount IS NULL OR NEW.project_id IS NULL THEN RAISE EXCEPTION 'Closing a billable ticket needs the fee (before VAT) and the engagement it is billed under.' USING ERRCODE='23514'; END IF;
   IF NEW.invoice_id IS NULL THEN RAISE EXCEPTION 'A billable ticket is closed together with its draft invoice.' USING ERRCODE='23514'; END IF;
   SELECT * INTO i FROM erp_private.invoices WHERE invoice_id=NEW.invoice_id AND deleted_at IS NULL;
   IF NOT FOUND OR i.status<>'Draft' OR i.client_id<>NEW.client_id OR i.firm_id<>NEW.firm_id OR i.project_id<>NEW.project_id OR i.net_amount<>NEW.fee_amount
    THEN RAISE EXCEPTION 'The draft invoice does not match the ticket (client, firm, engagement and fee).' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.invoice_id IS NOT NULL OR NEW.fee_amount IS NOT NULL THEN RAISE EXCEPTION '% is not billable: no invoice is created.',s.service_name USING ERRCODE='23514'; END IF;
  END IF;
  NEW.closed_by:=a.staff_id; NEW.closed_at:=now();
 ELSIF NEW.status='Cancelled' THEN
  NEW.closed_by:=a.staff_id; NEW.closed_at:=now();
 ELSE
  IF NEW.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'An invoice is created only when a billable ticket is closed.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_support_ticket_guard BEFORE INSERT OR UPDATE ON erp_private.client_support_tickets FOR EACH ROW EXECUTE FUNCTION erp_private.client_support_ticket_guard();
CREATE TRIGGER client_support_ticket_no_delete BEFORE DELETE ON erp_private.client_support_tickets FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_support_tickets FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_support_tickets FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('ticket_id');

ALTER TABLE erp_private.client_support_services ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.client_support_services FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_support_tickets ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.client_support_tickets FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON erp_private.client_support_services TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_support_tickets TO erp_api;
CREATE POLICY client_support_services_read ON erp_private.client_support_services FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY client_support_services_update ON erp_private.client_support_services FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY client_support_read ON erp_private.client_support_tickets FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id));
CREATE POLICY client_support_insert ON erp_private.client_support_tickets FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND opened_by=(erp_private.actor()).staff_id);
CREATE POLICY client_support_update ON erp_private.client_support_tickets FOR UPDATE TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id));

REVOKE ALL ON FUNCTION erp_private.client_support_service_guard(),erp_private.client_support_ticket_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_support_service_guard(),erp_private.client_support_ticket_guard() TO erp_api;
