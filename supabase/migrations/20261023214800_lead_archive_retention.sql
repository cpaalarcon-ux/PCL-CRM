-- Converted lead history is immutable, but may still be soft-archived.
CREATE OR REPLACE FUNCTION erp_private.lead_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.firm_id IS DISTINCT FROM OLD.firm_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN RAISE EXCEPTION 'Lead ownership and handling firm are fixed; create a separate lead' USING ERRCODE='23514';END IF;
 IF OLD.stage='Converted' AND (to_jsonb(NEW)-ARRAY['deleted_at','updated_at','revision','potential_pie']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_at','updated_at','revision','potential_pie']) THEN RAISE EXCEPTION 'This lead is converted; update the linked client' USING ERRCODE='23514';END IF;
 IF NEW.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=NEW.client_id AND l.firm_id=NEW.firm_id AND l.deleted_at IS NULL) THEN RAISE EXCEPTION 'Client must be linked to the same handling firm' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
