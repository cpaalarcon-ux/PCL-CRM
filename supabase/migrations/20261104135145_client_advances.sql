-- Client advances: money received before an invoice exists.
-- An advance is a liability to the client (not income). It is held by the firm that received it and can only be
-- applied to that same firm's invoices. Applying it writes an ordinary payment row (method 'Advance') that points
-- back to the advance, so statements, receipts and reversals keep working and a reversal returns the credit.

CREATE TABLE erp_private.client_advances (
 advance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 client_id uuid NOT NULL,
 firm_id uuid NOT NULL REFERENCES erp_private.firms,
 project_id uuid,
 receipt_number text NOT NULL UNIQUE,
 received_date date NOT NULL,
 method text NOT NULL CHECK(method IN ('Cash','M-Pesa','Bank','Cheque')),
 reference text NOT NULL CHECK(btrim(reference)<>''),
 amount numeric(16,2) NOT NULL CHECK(amount>0),
 purpose text,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(advance_id,client_id,firm_id),
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links(client_id,firm_id),
 FOREIGN KEY(project_id,client_id,firm_id) REFERENCES erp_private.projects(project_id,client_id,handling_firm_id)
);
CREATE INDEX client_advance_client_idx ON erp_private.client_advances(client_id,firm_id,received_date);
CREATE INDEX client_advance_project_idx ON erp_private.client_advances(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE erp_private.client_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_advances FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.client_advances TO erp_api;
CREATE POLICY advances_read ON erp_private.client_advances FOR SELECT TO erp_api USING(
 erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (erp_private.has_capability('FINANCE') OR erp_private.is_leader())
 AND (project_id IS NULL OR erp_private.project_allowed(project_id)));
CREATE POLICY advances_add ON erp_private.client_advances FOR INSERT TO erp_api WITH CHECK(
 erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND erp_private.has_capability('FINANCE')
 AND created_by=(erp_private.actor()).staff_id AND (project_id IS NULL OR erp_private.finance_allowed(project_id,true)));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_advances FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.client_advances FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_advances FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('advance_id');

-- Payments may now be an application of an advance.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.payments'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%Cheque%' LOOP
  EXECUTE format('ALTER TABLE erp_private.payments DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE erp_private.payments ADD COLUMN advance_id uuid;
ALTER TABLE erp_private.payments
 ADD CONSTRAINT payments_method_check CHECK(method IN ('Cash','M-Pesa','Bank','Cheque','Advance')),
 ADD CONSTRAINT payments_advance_pair CHECK((method='Advance')=(advance_id IS NOT NULL)),
 ADD CONSTRAINT payments_advance_same_firm FOREIGN KEY(advance_id,client_id,firm_id) REFERENCES erp_private.client_advances(advance_id,client_id,firm_id);
CREATE INDEX payment_advance_idx ON erp_private.payments(advance_id) WHERE advance_id IS NOT NULL;

CREATE FUNCTION erp_private.advance_application_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.client_advances; used numeric;
BEGIN
 IF NEW.advance_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.advance_id::text,0));
 SELECT * INTO a FROM erp_private.client_advances WHERE advance_id=NEW.advance_id;
 IF a.advance_id IS NULL THEN RAISE EXCEPTION 'Advance is not available' USING ERRCODE='23514'; END IF;
 IF a.project_id IS NOT NULL AND a.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'This advance is earmarked for another project' USING ERRCODE='23514'; END IF;
 IF NEW.reverses_id IS NULL THEN
  SELECT coalesce(sum(amount),0) INTO used FROM erp_private.payments WHERE advance_id=NEW.advance_id;
  IF used+NEW.amount>a.amount THEN RAISE EXCEPTION 'The advance credit is not enough' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER advance_application_guard BEFORE INSERT ON erp_private.payments FOR EACH ROW EXECUTE FUNCTION erp_private.advance_application_guard();
