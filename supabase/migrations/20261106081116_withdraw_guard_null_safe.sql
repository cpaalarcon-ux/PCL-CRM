-- Make the withdrawal exceptions null-safe. With the withdrawal flag unset, "flag = 'journal'" is NULL, which made the whole
-- exception condition NULL (treated as false) and let a direct update through. Compare with coalesce so an unset flag is simply false.
DO $patch$
DECLARE def text; patched text;
BEGIN
 def:=pg_get_functiondef('erp_private.accounting_control_guard()'::regprocedure);
 patched:=replace(def,
  $a$NEW.status='Draft' AND current_setting('erp.withdraw',true)='sales_recon' AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR a.staff_id=OLD.prepared_by)$a$,
  $b$NEW.status='Draft' AND coalesce(current_setting('erp.withdraw',true),'')='sales_recon' AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR coalesce(a.staff_id=OLD.prepared_by,false))$b$);
 IF patched=def THEN RAISE EXCEPTION 'accounting_control_guard: withdrawal rule not found'; END IF;
 EXECUTE patched;

 def:=pg_get_functiondef('erp_private.ledger_row_guard()'::regprocedure);
 patched:=replace(def,
  $a$NEW.status='Draft' AND current_setting('erp.withdraw',true)='journal' AND OLD.checked_by IS NULL AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR a.staff_id IN (OLD.prepared_by,OLD.last_prepared_by))$a$,
  $b$NEW.status='Draft' AND coalesce(current_setting('erp.withdraw',true),'')='journal' AND OLD.checked_by IS NULL AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR coalesce(a.staff_id IN (OLD.prepared_by,OLD.last_prepared_by),false))$b$);
 IF patched=def THEN RAISE EXCEPTION 'ledger_row_guard: journal withdrawal rule not found'; END IF;
 def:=patched;
 patched:=replace(def,
  $a$NEW.status='Draft' AND current_setting('erp.withdraw',true)='asset' AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR a.staff_id IN (OLD.prepared_by,OLD.last_prepared_by))$a$,
  $b$NEW.status='Draft' AND coalesce(current_setting('erp.withdraw',true),'')='asset' AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR coalesce(a.staff_id IN (OLD.prepared_by,OLD.last_prepared_by),false))$b$);
 IF patched=def THEN RAISE EXCEPTION 'ledger_row_guard: asset withdrawal rule not found'; END IF;
 EXECUTE patched;
END
$patch$;
