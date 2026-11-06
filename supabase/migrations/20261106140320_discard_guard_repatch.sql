-- The source-aware sales migration replaces period_import_guard() as a whole. Re-apply the Discarded rules on top of it.
-- Safe to run when the rules are already present (it then does nothing).
DO $patch$
DECLARE def text; patched text;
BEGIN
 def:=pg_get_functiondef('erp_private.period_import_guard()'::regprocedure);
 IF position('Discarded' IN def)>0 THEN RETURN; END IF;
 patched:=replace(def,$a$IF OLD.status='Superseded' THEN$a$,$b$IF OLD.status IN ('Superseded','Discarded') THEN$b$);
 IF patched=def THEN RAISE EXCEPTION 'period_import_guard: superseded rule not found'; END IF;
 def:=patched;
 patched:=replace(def,$a$ELSIF NEW.status='Superseded' THEN$a$,
  $b$ELSIF NEW.status='Discarded' AND OLD.status IN ('Draft','Returned') THEN
   IF current_user='erp_api' AND (a.staff_id IS NULL OR (a.staff_id IS DISTINCT FROM OLD.prepared_by AND a.category_code NOT IN ('PARTNER','MANAGER')) OR NEW.discarded_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Only the preparer, a Manager or a Partner can discard a draft summary' USING ERRCODE='42501';END IF;
  ELSIF NEW.status='Superseded' THEN$b$);
 IF patched=def THEN RAISE EXCEPTION 'period_import_guard: discard rule not found'; END IF;
 EXECUTE patched;
END
$patch$;
