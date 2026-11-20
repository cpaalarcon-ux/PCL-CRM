-- Confirming or superseding an audit TB import was always refused: the generated column "difference" is not yet computed in a BEFORE UPDATE trigger,
-- so the guard saw it as a changed source detail. "difference" is derived from total_debit and total_credit, which stay protected, so it is left out of the comparison.
CREATE OR REPLACE FUNCTION erp_private.audit_tb_import_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_values jsonb; new_values jsonb;
BEGIN
 old_values=to_jsonb(OLD)-'status'-'confirmed_by'-'confirmed_at'-'superseded_by'-'superseded_reason'-'revision'-'updated_at'-'difference';
 new_values=to_jsonb(NEW)-'status'-'confirmed_by'-'confirmed_at'-'superseded_by'-'superseded_reason'-'revision'-'updated_at'-'difference';
 IF old_values IS DISTINCT FROM new_values THEN
  RAISE EXCEPTION 'Imported trial-balance source details are immutable.' USING ERRCODE='42501';
 END IF;
 IF OLD.status='Draft' AND NEW.status='Confirmed'
    AND NEW.confirmed_by IS NOT NULL AND NEW.confirmed_at IS NOT NULL
    AND NEW.superseded_by IS NULL AND NEW.superseded_reason IS NULL THEN RETURN NEW; END IF;
 IF OLD.status IN ('Draft','Confirmed') AND NEW.status='Superseded'
    AND NEW.superseded_reason IS NOT NULL AND NEW.superseded_by IS NULL
    AND NEW.confirmed_by IS NOT DISTINCT FROM OLD.confirmed_by
    AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN RETURN NEW; END IF;
 IF OLD.status='Superseded' AND NEW.status='Superseded'
    AND OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL
    AND NEW.superseded_reason IS NOT DISTINCT FROM OLD.superseded_reason
    AND NEW.confirmed_by IS NOT DISTINCT FROM OLD.confirmed_by
    AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Trial-balance history cannot be rewritten.' USING ERRCODE='42501';
END; $$;
