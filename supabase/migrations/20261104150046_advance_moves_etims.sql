-- Advance refunds and inter-firm transfers, and the eTIMS reference on posted invoices.
-- An advance is a liability to the client. It leaves the firm in one of three ways: applied to an invoice (payments),
-- refunded to the client, or transferred to another firm that the client uses. Refunds and transfers are append-only
-- movements. A transfer creates a new advance in the receiving firm (method 'Transfer') and a movement that points to it.

DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.client_advances'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%Cheque%' LOOP
  EXECUTE format('ALTER TABLE erp_private.client_advances DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE erp_private.client_advances ADD CONSTRAINT client_advances_method_check CHECK(method IN ('Cash','M-Pesa','Bank','Cheque','Transfer'));

CREATE TABLE erp_private.advance_movements (
 movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 advance_id uuid NOT NULL,
 client_id uuid NOT NULL,
 firm_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('Refund','Transfer')),
 amount numeric(16,2) NOT NULL CHECK(amount>0),
 movement_date date NOT NULL,
 voucher_number text NOT NULL UNIQUE,
 method text CHECK(method IN ('Cash','M-Pesa','Bank','Cheque')),
 reference text NOT NULL CHECK(btrim(reference)<>''),
 reason text NOT NULL CHECK(char_length(btrim(reason))>=10),
 to_advance_id uuid UNIQUE REFERENCES erp_private.client_advances(advance_id),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(advance_id,client_id,firm_id) REFERENCES erp_private.client_advances(advance_id,client_id,firm_id),
 CHECK((kind='Transfer')=(to_advance_id IS NOT NULL)),
 CHECK((kind='Refund')=(method IS NOT NULL))
);
CREATE INDEX advance_movement_advance_idx ON erp_private.advance_movements(advance_id);

CREATE FUNCTION erp_private.advance_balance(adv uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT round(a.amount
  -coalesce((SELECT sum(p.amount) FROM erp_private.payments p WHERE p.advance_id=a.advance_id),0)
  -coalesce((SELECT sum(m.amount) FROM erp_private.advance_movements m WHERE m.advance_id=a.advance_id),0),2)
 FROM erp_private.client_advances a WHERE a.advance_id=adv $$;
GRANT EXECUTE ON FUNCTION erp_private.advance_balance(uuid) TO erp_api;

-- Applying an advance now also counts refunds and transfers as credit used.
CREATE OR REPLACE FUNCTION erp_private.advance_application_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.client_advances; used numeric;
BEGIN
 IF NEW.advance_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.advance_id::text,0));
 SELECT * INTO a FROM erp_private.client_advances WHERE advance_id=NEW.advance_id;
 IF a.advance_id IS NULL THEN RAISE EXCEPTION 'Advance is not available' USING ERRCODE='23514'; END IF;
 IF a.project_id IS NOT NULL AND a.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'This advance is earmarked for another project' USING ERRCODE='23514'; END IF;
 IF NEW.reverses_id IS NULL THEN
  SELECT coalesce(sum(amount),0) INTO used FROM erp_private.payments WHERE advance_id=NEW.advance_id;
  used:=used+coalesce((SELECT sum(amount) FROM erp_private.advance_movements WHERE advance_id=NEW.advance_id),0);
  IF used+NEW.amount>a.amount THEN RAISE EXCEPTION 'The advance credit is not enough' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION erp_private.advance_movement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.client_advances; t erp_private.client_advances;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.advance_id::text,0));
 SELECT * INTO a FROM erp_private.client_advances WHERE advance_id=NEW.advance_id;
 IF a.advance_id IS NULL THEN RAISE EXCEPTION 'Advance is not available' USING ERRCODE='23514'; END IF;
 IF NEW.movement_date<a.received_date THEN RAISE EXCEPTION 'A refund or transfer cannot be dated before the advance was received' USING ERRCODE='23514'; END IF;
 IF NEW.amount>erp_private.advance_balance(NEW.advance_id) THEN RAISE EXCEPTION 'The advance credit is not enough' USING ERRCODE='23514'; END IF;
 IF NEW.kind='Transfer' THEN
  SELECT * INTO t FROM erp_private.client_advances WHERE advance_id=NEW.to_advance_id;
  IF t.advance_id IS NULL OR t.client_id<>a.client_id OR t.firm_id=a.firm_id OR t.amount<>NEW.amount OR t.method<>'Transfer' OR t.received_date<>NEW.movement_date THEN
   RAISE EXCEPTION 'A transfer must create the matching advance for the same client in a different firm' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER advance_movement_guard BEFORE INSERT ON erp_private.advance_movements FOR EACH ROW EXECUTE FUNCTION erp_private.advance_movement_guard();

ALTER TABLE erp_private.advance_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.advance_movements FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.advance_movements TO erp_api;
CREATE POLICY movements_read ON erp_private.advance_movements FOR SELECT TO erp_api USING(
 erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (erp_private.has_capability('FINANCE') OR erp_private.is_leader()));
CREATE POLICY movements_add ON erp_private.advance_movements FOR INSERT TO erp_api WITH CHECK(
 erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND erp_private.is_leader() AND erp_private.has_capability('FINANCE')
 AND created_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.advance_movements FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.advance_movements FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.advance_movements FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('movement_id');

-- eTIMS reference for a posted invoice. Staff copy it from the eTIMS portal; the ERP does not submit to eTIMS.
CREATE TABLE erp_private.invoice_etims (
 invoice_id uuid PRIMARY KEY REFERENCES erp_private.invoices,
 project_id uuid NOT NULL,
 firm_id uuid NOT NULL REFERENCES erp_private.firms,
 etims_invoice_no text NOT NULL CHECK(btrim(etims_invoice_no)<>''),
 qr_url text CHECK(qr_url IS NULL OR qr_url ~ '^https://[^[:space:]]+$'),
 etims_issued_on date NOT NULL,
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(firm_id,etims_invoice_no)
);
CREATE FUNCTION erp_private.invoice_etims_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i erp_private.invoices;
BEGIN
 SELECT * INTO i FROM erp_private.invoices WHERE invoice_id=NEW.invoice_id;
 IF i.invoice_id IS NULL OR i.status<>'Posted' THEN RAISE EXCEPTION 'Record the eTIMS reference on a posted invoice' USING ERRCODE='23514'; END IF;
 IF i.project_id<>NEW.project_id OR i.firm_id<>NEW.firm_id THEN RAISE EXCEPTION 'The eTIMS reference must belong to the invoice''s firm and project' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_etims_guard BEFORE INSERT ON erp_private.invoice_etims FOR EACH ROW EXECUTE FUNCTION erp_private.invoice_etims_guard();
ALTER TABLE erp_private.invoice_etims ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.invoice_etims FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.invoice_etims TO erp_api;
CREATE POLICY etims_read ON erp_private.invoice_etims FOR SELECT TO erp_api USING(erp_private.finance_allowed(project_id));
CREATE POLICY etims_add ON erp_private.invoice_etims FOR INSERT TO erp_api WITH CHECK(erp_private.finance_allowed(project_id,true) AND recorded_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.invoice_etims FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.invoice_etims FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.invoice_etims FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('invoice_id');
