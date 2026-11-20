-- Debtors ageing: a client's bank or mobile-money credit is allocated to the client's sales invoice it settled.
-- Append-only: an allocation is undone by a reversing row, never edited or deleted. This is a working-paper
-- allocation; it does not post to the ledger.

CREATE TABLE erp_private.customer_receipt_allocations (
 allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 bank_row_id uuid NOT NULL REFERENCES erp_private.workbook_rows(row_id),
 sales_row_id uuid NOT NULL REFERENCES erp_private.workbook_rows(row_id),
 amount numeric(16,2) NOT NULL CHECK(amount<>0),
 reverses_id uuid UNIQUE REFERENCES erp_private.customer_receipt_allocations,
 reason text,
 allocated_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((reverses_id IS NULL AND amount>0) OR (reverses_id IS NOT NULL AND amount<0 AND btrim(coalesce(reason,''))<>''))
);
CREATE INDEX receipt_alloc_project_idx ON erp_private.customer_receipt_allocations(project_id);
CREATE INDEX receipt_alloc_bank_idx ON erp_private.customer_receipt_allocations(bank_row_id);
CREATE INDEX receipt_alloc_sales_idx ON erp_private.customer_receipt_allocations(sales_row_id);

ALTER TABLE erp_private.customer_receipt_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.customer_receipt_allocations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.customer_receipt_allocations TO erp_api;
CREATE POLICY receipt_alloc_read ON erp_private.customer_receipt_allocations FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY receipt_alloc_add ON erp_private.customer_receipt_allocations FOR INSERT TO erp_api WITH CHECK(
 erp_private.project_allowed(project_id) AND allocated_by=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code<>'INTERN');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.customer_receipt_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.customer_receipt_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.customer_receipt_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('allocation_id');

CREATE FUNCTION erp_private.receipt_allocation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b erp_private.workbook_rows; s erp_private.workbook_rows; o erp_private.customer_receipt_allocations;
 credit numeric; gross numeric; used_bank numeric; used_sales numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.bank_row_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.sales_row_id::text,0));
 SELECT * INTO b FROM erp_private.workbook_rows WHERE row_id=NEW.bank_row_id;
 SELECT * INTO s FROM erp_private.workbook_rows WHERE row_id=NEW.sales_row_id;
 IF b.row_id IS NULL OR s.row_id IS NULL OR b.project_id<>NEW.project_id OR s.project_id<>NEW.project_id THEN
  RAISE EXCEPTION 'The receipt and the invoice must belong to this project' USING ERRCODE='23514'; END IF;
 IF b.dataset<>'Bank' OR s.dataset<>'Sales' THEN RAISE EXCEPTION 'Allocate a bank or mobile-money credit to a sales invoice' USING ERRCODE='23514'; END IF;
 IF NEW.reverses_id IS NOT NULL THEN
  SELECT * INTO o FROM erp_private.customer_receipt_allocations WHERE allocation_id=NEW.reverses_id;
  IF o.allocation_id IS NULL OR o.reverses_id IS NOT NULL OR o.bank_row_id<>NEW.bank_row_id OR o.sales_row_id<>NEW.sales_row_id OR o.amount+NEW.amount<>0 THEN
   RAISE EXCEPTION 'A reversal must mirror the allocation it undoes' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 credit:=coalesce(nullif(b.normalized->>'credit',''),'0')::numeric;
 gross:=coalesce(nullif(s.normalized->>'amount',''),'0')::numeric+coalesce(nullif(s.normalized->>'vat',''),'0')::numeric;
 IF credit<=0 THEN RAISE EXCEPTION 'That bank line is not a credit (money in)' USING ERRCODE='23514'; END IF;
 IF gross<=0 THEN RAISE EXCEPTION 'Receipts can only be allocated to an invoice, not a credit note' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0) INTO used_bank FROM erp_private.customer_receipt_allocations WHERE bank_row_id=NEW.bank_row_id;
 SELECT coalesce(sum(amount),0) INTO used_sales FROM erp_private.customer_receipt_allocations WHERE sales_row_id=NEW.sales_row_id;
 IF used_bank+NEW.amount>credit THEN RAISE EXCEPTION 'The allocation is more than the bank credit that is left' USING ERRCODE='23514'; END IF;
 IF used_sales+NEW.amount>gross THEN RAISE EXCEPTION 'The allocation is more than the invoice balance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_allocation_guard BEFORE INSERT ON erp_private.customer_receipt_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.receipt_allocation_guard();
