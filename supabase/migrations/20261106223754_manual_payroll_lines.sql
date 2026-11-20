-- Manual payroll lines: a payroll month can be typed in, with no source file. Everything else (calculation,
-- independent review, replacement rules) is unchanged. A file import still needs its project document.
ALTER TABLE erp_private.period_imports ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE erp_private.period_imports ADD COLUMN entry_mode text NOT NULL DEFAULT 'File' CHECK(entry_mode IN ('File','Manual'));
ALTER TABLE erp_private.period_imports ADD CONSTRAINT period_import_entry_mode_check CHECK(
 (entry_mode='File' AND document_id IS NOT NULL) OR (entry_mode='Manual' AND kind='Payroll' AND document_id IS NULL));

-- Patch the current guard in place so this migration does not depend on which earlier migration last redefined it.
DO $do$
DECLARE d text;n text;
BEGIN
 SELECT pg_get_functiondef('erp_private.period_import_guard()'::regprocedure) INTO d;
 n:=replace(d,'IF NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=NEW.document_id','IF NEW.entry_mode=''File'' AND NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=NEW.document_id');
 IF n=d THEN RAISE EXCEPTION 'period_import_guard document check not found'; END IF;
 d:=n;
 n:=replace(d,'NEW.prepared_by,NEW.notes) IS DISTINCT FROM (OLD.project_id','NEW.prepared_by,NEW.notes,NEW.entry_mode) IS DISTINCT FROM (OLD.project_id');
 IF n=d THEN RAISE EXCEPTION 'period_import_guard immutability tuple (new side) not found'; END IF;
 d:=n;
 n:=replace(d,'OLD.prepared_by,OLD.notes) THEN','OLD.prepared_by,OLD.notes,OLD.entry_mode) THEN');
 IF n=d THEN RAISE EXCEPTION 'period_import_guard immutability tuple (old side) not found'; END IF;
 EXECUTE n;
END
$do$;
