-- Billing brought over from the previous system (Odoo): invoices, credit notes and payments, kept under each client.
-- Firm decisions (27 Nov 2026): the full history is held, read-only; clients not in the ERP are left out.
-- These are NOT ERP invoices. They are never numbered here, never sent to KRA and never enter the VAT or ledger figures: all of that
-- was done in the previous system. They appear on the client statement, and an unpaid one can be receipted here until it is cleared.
-- Loading is in two steps by two people: a person with the Finance right stages a checked file; a different Partner approves it.

CREATE TABLE erp_private.prior_billing_batches(
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_ref text NOT NULL UNIQUE CHECK(batch_ref ~ '^PB-[0-9]{8}-[0-9A-F]{6}$'),
 source text NOT NULL DEFAULT 'Odoo' CHECK(length(btrim(source)) BETWEEN 2 AND 40),
 file_name text NOT NULL, file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'Staged' CHECK(status IN('Staged','Loaded','Discarded')),
 rows jsonb NOT NULL, summary jsonb NOT NULL,
 staged_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT, staged_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT, decided_at timestamptz, decision_note text,
 CHECK((status='Staged')=(decided_by IS NULL)), CHECK(decided_by IS NULL OR decided_by<>staged_by));
CREATE INDEX prior_billing_batches_staged_by_idx ON erp_private.prior_billing_batches(staged_by);
CREATE INDEX prior_billing_batches_decided_by_idx ON erp_private.prior_billing_batches(decided_by);
-- The same file is not staged or loaded twice.
CREATE UNIQUE INDEX prior_billing_batches_file_idx ON erp_private.prior_billing_batches(file_sha256) WHERE status<>'Discarded';

CREATE TABLE erp_private.prior_billing_documents(
 doc_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES erp_private.prior_billing_batches(batch_id) ON DELETE RESTRICT,
 source text NOT NULL, kind text NOT NULL CHECK(kind IN('Invoice','Credit note','Payment')),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 3 AND 60),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id) ON DELETE RESTRICT,
 firm_id uuid REFERENCES erp_private.firms(firm_id) ON DELETE RESTRICT,
 doc_date date NOT NULL, due_date date,
 net_amount numeric(14,2), vat_amount numeric(14,2), total_amount numeric(14,2) NOT NULL CHECK(total_amount>0),
 amount_due numeric(14,2) NOT NULL DEFAULT 0 CHECK(amount_due>=0 AND amount_due<=total_amount),
 prior_status text NOT NULL, reverses_reference text, method text,
 loaded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source,kind,reference),
 CHECK(kind='Invoice' OR amount_due=0), CHECK(kind<>'Payment' OR (net_amount IS NULL AND vat_amount IS NULL)));
CREATE INDEX prior_billing_documents_client_idx ON erp_private.prior_billing_documents(client_id,doc_date);
CREATE INDEX prior_billing_documents_batch_idx ON erp_private.prior_billing_documents(batch_id);
CREATE INDEX prior_billing_documents_firm_idx ON erp_private.prior_billing_documents(firm_id);

-- Money received here, after the move, against an invoice from the previous system. A reversal is a new line; nothing is edited.
CREATE TABLE erp_private.prior_billing_receipts(
 receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
 doc_id uuid NOT NULL REFERENCES erp_private.prior_billing_documents(doc_id) ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id) ON DELETE RESTRICT,
 firm_id uuid NOT NULL REFERENCES erp_private.firms(firm_id) ON DELETE RESTRICT,
 receipt_number text NOT NULL UNIQUE, payment_date date NOT NULL,
 method text NOT NULL CHECK(method IN('Cash','M-Pesa','Bank','Cheque')), reference text NOT NULL CHECK(length(btrim(reference))>=1),
 amount numeric(14,2) NOT NULL CHECK(amount<>0),
 reverses_id uuid UNIQUE REFERENCES erp_private.prior_billing_receipts(receipt_id) ON DELETE RESTRICT, reason text,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((reverses_id IS NULL AND amount>0) OR (reverses_id IS NOT NULL AND amount<0 AND length(btrim(COALESCE(reason,'')))>=10)));
CREATE INDEX prior_billing_receipts_doc_idx ON erp_private.prior_billing_receipts(doc_id);
CREATE INDEX prior_billing_receipts_client_idx ON erp_private.prior_billing_receipts(client_id,payment_date);
CREATE INDEX prior_billing_receipts_firm_idx ON erp_private.prior_billing_receipts(firm_id);
CREATE INDEX prior_billing_receipts_by_idx ON erp_private.prior_billing_receipts(created_by);

-- What is still owed on one previous-system invoice.
CREATE OR REPLACE FUNCTION erp_private.prior_billing_outstanding(p_doc uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT round(d.amount_due-COALESCE((SELECT sum(r.amount) FROM erp_private.prior_billing_receipts r WHERE r.doc_id=d.doc_id),0),2) FROM erp_private.prior_billing_documents d WHERE d.doc_id=p_doc $$;

-- Loaded documents and receipts are never changed or removed.
CREATE OR REPLACE FUNCTION erp_private.prior_billing_frozen() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'Previous-system billing records are kept as loaded; they are not edited or deleted' USING ERRCODE='23514'; END $$;
CREATE TRIGGER prior_billing_documents_frozen BEFORE UPDATE OR DELETE ON erp_private.prior_billing_documents FOR EACH ROW EXECUTE FUNCTION erp_private.prior_billing_frozen();
CREATE TRIGGER prior_billing_receipts_frozen BEFORE UPDATE OR DELETE ON erp_private.prior_billing_receipts FOR EACH ROW EXECUTE FUNCTION erp_private.prior_billing_frozen();
CREATE TRIGGER prior_billing_batches_no_delete BEFORE DELETE ON erp_private.prior_billing_batches FOR EACH ROW EXECUTE FUNCTION erp_private.prior_billing_frozen();
-- A receipt is for an invoice, is dated on or after it and not in the future, and never takes the invoice below nil or above what was owed when loaded.
CREATE OR REPLACE FUNCTION erp_private.prior_billing_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d record;left_ numeric;o record;
BEGIN
 SELECT * INTO d FROM erp_private.prior_billing_documents WHERE doc_id=NEW.doc_id FOR UPDATE;
 IF d.kind<>'Invoice' THEN RAISE EXCEPTION 'A receipt is recorded against an invoice' USING ERRCODE='23514'; END IF;
 IF d.firm_id IS NULL THEN RAISE EXCEPTION 'This invoice has no firm; it cannot be receipted here' USING ERRCODE='23514'; END IF;
 NEW.client_id:=d.client_id;NEW.firm_id:=d.firm_id;
 IF NEW.payment_date<d.doc_date OR NEW.payment_date>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'The payment date must be on or after the invoice date and not in the future' USING ERRCODE='23514'; END IF;
 IF NEW.reverses_id IS NOT NULL THEN
  SELECT * INTO o FROM erp_private.prior_billing_receipts WHERE receipt_id=NEW.reverses_id;
  IF o.doc_id<>NEW.doc_id OR o.reverses_id IS NOT NULL OR NEW.amount<>-o.amount THEN RAISE EXCEPTION 'A reversal takes back one whole receipt on the same invoice' USING ERRCODE='23514'; END IF;
 END IF;
 left_:=erp_private.prior_billing_outstanding(NEW.doc_id)-NEW.amount;
 IF left_<0 THEN RAISE EXCEPTION 'This is more than is still owed on the invoice' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prior_billing_receipt_guard BEFORE INSERT ON erp_private.prior_billing_receipts FOR EACH ROW EXECUTE FUNCTION erp_private.prior_billing_receipt_guard();
CREATE TRIGGER prior_billing_receipts_audit AFTER INSERT ON erp_private.prior_billing_receipts FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('receipt_id');
CREATE TRIGGER prior_billing_batches_audit AFTER INSERT OR UPDATE ON erp_private.prior_billing_batches FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('batch_id');

-- Who may see and do what. Reading: a Manager or Partner, or a person with the Finance right, for clients they can open.
-- Staging a file and recording receipts: the Finance right. Approving or discarding a staged file: a Partner who did not stage it (approval in billing is a Partner decision).
CREATE OR REPLACE FUNCTION erp_private.prior_billing_reader() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT erp_private.is_leader() OR erp_private.has_capability('FINANCE') $$;
ALTER TABLE erp_private.prior_billing_batches ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.prior_billing_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.prior_billing_documents ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.prior_billing_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.prior_billing_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.prior_billing_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY prior_billing_batches_read ON erp_private.prior_billing_batches FOR SELECT TO erp_api USING(erp_private.prior_billing_reader());
CREATE POLICY prior_billing_batches_stage ON erp_private.prior_billing_batches FOR INSERT TO erp_api WITH CHECK(erp_private.has_capability('FINANCE') AND staged_by=(erp_private.actor()).staff_id AND status='Staged');
CREATE POLICY prior_billing_documents_read ON erp_private.prior_billing_documents FOR SELECT TO erp_api USING(erp_private.prior_billing_reader() AND erp_private.client_allowed(client_id));
CREATE POLICY prior_billing_receipts_read ON erp_private.prior_billing_receipts FOR SELECT TO erp_api USING(erp_private.prior_billing_reader() AND erp_private.client_allowed(client_id));
CREATE POLICY prior_billing_receipts_add ON erp_private.prior_billing_receipts FOR INSERT TO erp_api WITH CHECK(erp_private.has_capability('FINANCE') AND created_by=(erp_private.actor()).staff_id);
GRANT SELECT,INSERT ON erp_private.prior_billing_batches,erp_private.prior_billing_receipts TO erp_api;
GRANT SELECT ON erp_private.prior_billing_documents TO erp_api;

-- Approve or discard a staged file. Approval writes every row as a document in one step, or nothing.
CREATE OR REPLACE FUNCTION erp_private.prior_billing_decide(p_batch_ref text,p_decision text,p_note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a record;b record;note text:=btrim(COALESCE(p_note,''));n integer;
BEGIN
 a:=erp_private.actor();
 IF a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can approve or discard a previous-system billing file' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN('Approve','Discard') THEN RAISE EXCEPTION 'Choose Approve or Discard' USING ERRCODE='22023'; END IF;
 SELECT * INTO b FROM erp_private.prior_billing_batches WHERE batch_ref=p_batch_ref FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That file is not on record' USING ERRCODE='22023'; END IF;
 IF b.status<>'Staged' THEN RAISE EXCEPTION 'This file is already %',lower(b.status) USING ERRCODE='23514'; END IF;
 IF p_decision='Discard' THEN
  IF length(note)<10 THEN RAISE EXCEPTION 'Give the reason for discarding in at least 10 characters' USING ERRCODE='22023'; END IF;
  UPDATE erp_private.prior_billing_batches SET status='Discarded',decided_by=a.staff_id,decided_at=now(),decision_note=note WHERE batch_id=b.batch_id AND b.staged_by<>a.staff_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'A different Partner discards a file you staged' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('ok',true,'batch_ref',b.batch_ref,'status','Discarded');
 END IF;
 IF b.staged_by=a.staff_id THEN RAISE EXCEPTION 'A different Partner approves a file you staged' USING ERRCODE='42501'; END IF;
 INSERT INTO erp_private.prior_billing_documents(batch_id,source,kind,reference,client_id,firm_id,doc_date,due_date,net_amount,vat_amount,total_amount,amount_due,prior_status,reverses_reference,method)
  SELECT b.batch_id,b.source,r->>'kind',r->>'reference',(r->>'client_id')::uuid,NULLIF(r->>'firm_id','')::uuid,(r->>'doc_date')::date,NULLIF(r->>'due_date','')::date,
   NULLIF(r->>'net_amount','')::numeric,NULLIF(r->>'vat_amount','')::numeric,(r->>'total_amount')::numeric,COALESCE(NULLIF(r->>'amount_due','')::numeric,0),r->>'prior_status',NULLIF(r->>'reverses_reference',''),NULLIF(r->>'method','')
  FROM jsonb_array_elements(b.rows) r;
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE erp_private.prior_billing_batches SET status='Loaded',decided_by=a.staff_id,decided_at=now(),decision_note=NULLIF(note,'') WHERE batch_id=b.batch_id;
 RETURN jsonb_build_object('ok',true,'batch_ref',b.batch_ref,'status','Loaded','documents',n);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.prior_billing_decide(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.prior_billing_decide(text,text,text) TO erp_api;
