-- Step 2 of the joined-practice review (2026-11-09): one master for the client's entity type.
--
-- The client's Legal structure + Subcategory (erp_private.legal_structure_types) is the master. Two other fields now follow it:
--   * clients.legal_entity_type (the accounting family) must equal the pair's engine_family;
--   * client_compliance.entity_type (the KYC entity type) must equal the pair's kyc_entity_type.
-- client_tax_profiles.entity_type is the TAX-SIDE taxpayer type. It keeps its own choice (the suggested value in
-- legal_structure_tax_defaults is Suggested only and awaits the Tax Lead), but a difference is counted in the release checks.
-- Nothing is rewritten for existing rows: a client that already disagrees is reported, not changed.

-- The KYC entity type is derived from the accounting family, in one place, so it cannot drift from the master table.
ALTER TABLE erp_private.legal_structure_types
 ADD COLUMN kyc_entity_type text GENERATED ALWAYS AS (
  CASE engine_family
   WHEN 'Limited company' THEN 'Company'
   WHEN 'Foreign branch' THEN 'Company'
   WHEN 'Partnership' THEN 'Partnership'
   WHEN 'Sole proprietor' THEN 'Sole proprietor'
   ELSE 'Other'
  END) STORED;

-- The accounting family must follow the master when both are set. The first confirmation of the family may still come later.
CREATE FUNCTION erp_private.client_family_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_family text;
BEGIN
 IF NEW.legal_structure IS NULL OR NEW.legal_subtype IS NULL OR NEW.legal_entity_type IS NULL THEN RETURN NEW; END IF;
 SELECT t.engine_family INTO v_family FROM erp_private.legal_structure_types t WHERE t.structure=NEW.legal_structure AND t.subtype=NEW.legal_subtype;
 IF v_family IS NOT NULL AND NEW.legal_entity_type<>v_family THEN
  RAISE EXCEPTION 'The accounting family (%) follows the legal structure (% / %) and must be %',NEW.legal_entity_type,NEW.legal_structure,NEW.legal_subtype,v_family USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_family_follows_structure BEFORE INSERT OR UPDATE OF legal_structure,legal_subtype,legal_entity_type ON erp_private.clients FOR EACH ROW EXECUTE FUNCTION erp_private.client_family_guard();

-- The KYC entity type must follow the master when the client has a structure.
CREATE FUNCTION erp_private.kyc_type_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_type text;
BEGIN
 SELECT t.kyc_entity_type INTO v_type FROM erp_private.clients c JOIN erp_private.legal_structure_types t ON t.structure=c.legal_structure AND t.subtype=c.legal_subtype WHERE c.client_id=NEW.client_id;
 IF v_type IS NOT NULL AND NEW.entity_type<>v_type THEN
  RAISE EXCEPTION 'The KYC entity type follows the client legal structure and must be %',v_type USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_kyc_type_follows_structure BEFORE INSERT OR UPDATE OF entity_type ON erp_private.client_compliance FOR EACH ROW EXECUTE FUNCTION erp_private.kyc_type_guard();

-- When the structure is set or changed, the KYC entity type moves with it. Runs as the owner because a first classification can be
-- made by someone who cannot otherwise edit the KYC file; the server already sends a verified file back for re-verification.
CREATE FUNCTION erp_private.kyc_type_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_type text;
BEGIN
 IF NEW.legal_structure IS NULL OR NEW.legal_subtype IS NULL THEN RETURN NEW; END IF;
 SELECT t.kyc_entity_type INTO v_type FROM erp_private.legal_structure_types t WHERE t.structure=NEW.legal_structure AND t.subtype=NEW.legal_subtype;
 IF v_type IS NOT NULL THEN
  UPDATE erp_private.client_compliance SET entity_type=v_type WHERE client_id=NEW.client_id AND entity_type<>v_type;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_kyc_type_sync AFTER UPDATE OF legal_structure,legal_subtype ON erp_private.clients FOR EACH ROW EXECUTE FUNCTION erp_private.kyc_type_sync();

-- Clients that already disagree with the master (read-only report; used by the release checks).
CREATE FUNCTION erp_private.entity_type_conflicts() RETURNS TABLE(client_id uuid,problem text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT c.client_id,'accounting family '||c.legal_entity_type||' differs from '||t.engine_family
  FROM erp_private.clients c JOIN erp_private.legal_structure_types t ON t.structure=c.legal_structure AND t.subtype=c.legal_subtype
  WHERE c.deleted_at IS NULL AND c.legal_entity_type IS NOT NULL AND c.legal_entity_type<>t.engine_family
 UNION ALL
 SELECT c.client_id,'KYC entity type '||k.entity_type||' differs from '||t.kyc_entity_type
  FROM erp_private.clients c JOIN erp_private.client_compliance k ON k.client_id=c.client_id
  JOIN erp_private.legal_structure_types t ON t.structure=c.legal_structure AND t.subtype=c.legal_subtype
  WHERE c.deleted_at IS NULL AND k.entity_type<>t.kyc_entity_type
 UNION ALL
 SELECT p.client_id,'tax profile type '||p.entity_type||' differs from the suggested '||d.profile_entity_type
  FROM erp_private.client_tax_profiles p JOIN erp_private.clients c ON c.client_id=p.client_id
  JOIN erp_private.legal_structure_tax_defaults d ON d.structure=c.legal_structure AND d.subtype=c.legal_subtype
  WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.entity_type<>d.profile_entity_type
$$;

REVOKE EXECUTE ON FUNCTION erp_private.client_family_guard(),erp_private.kyc_type_guard(),erp_private.kyc_type_sync(),erp_private.entity_type_conflicts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.entity_type_conflicts() TO erp_api;
