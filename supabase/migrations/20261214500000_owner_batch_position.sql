-- Owners from the client workbook (owner batch loader).
-- The firm's rule is that the owners of a client account for the whole of it: their shares total 100%.
-- A preparer (Assistant or Supervisor) proposes owners but cannot read the owners table, so the loader could not count
-- the owners already on a client's record. This function tells the caller only two things about a client they can open:
-- the total share already recorded, and which of the names they supplied are already recorded. It returns no other
-- owner's name, share or identity detail, and nothing at all for a client the caller cannot open.
CREATE FUNCTION erp_private.owner_batch_position(p_client uuid,p_names text[]) RETURNS TABLE(recorded_total numeric,recorded_names text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(sum(o.ownership_percentage),0)::numeric,
        coalesce(array_agg(lower(btrim(o.full_name))) FILTER (WHERE lower(btrim(o.full_name))=ANY(p_names)),'{}'::text[])
 FROM erp_private.beneficial_owners o
 WHERE o.client_id=p_client AND o.deleted_at IS NULL AND erp_private.client_allowed(p_client)
$$;
REVOKE ALL ON FUNCTION erp_private.owner_batch_position(uuid,text[]) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.owner_batch_position(uuid,text[]) TO erp_api;
