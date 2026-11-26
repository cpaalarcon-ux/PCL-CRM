-- Change the share of an owner already on a client's record (owner share amendment batch).
-- A preparer (Assistant or Supervisor) proposes amendments but cannot read the owners table. This function tells the caller only what
-- they need about a client they can open: for the owner names they supplied, the owner record, the share now recorded and its version;
-- and the total share held by every owner they did not name. It returns no other owner's name, share or identity detail, and nothing
-- at all for a client the caller cannot open.
CREATE FUNCTION erp_private.owner_amend_position(p_client uuid, p_names text[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN NOT erp_private.client_allowed(p_client) THEN NULL ELSE jsonb_build_object(
  'matched', coalesce((SELECT jsonb_agg(jsonb_build_object('owner_id', o.owner_id, 'name', lower(btrim(o.full_name)), 'display_name', o.full_name,
     'share', coalesce(o.ownership_percentage, 0), 'revision', o.revision) ORDER BY o.created_at)
    FROM erp_private.beneficial_owners o WHERE o.client_id = p_client AND o.deleted_at IS NULL AND lower(btrim(o.full_name)) = ANY (p_names)), '[]'::jsonb),
  'other_total', coalesce((SELECT sum(coalesce(o.ownership_percentage, 0)) FROM erp_private.beneficial_owners o
    WHERE o.client_id = p_client AND o.deleted_at IS NULL AND NOT (lower(btrim(o.full_name)) = ANY (p_names))), 0)) END
$$;
REVOKE ALL ON FUNCTION erp_private.owner_amend_position(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION erp_private.owner_amend_position(uuid, text[]) TO erp_api;
