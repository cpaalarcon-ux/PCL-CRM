-- Realtime needs a membership predicate, not a public REST RPC. Retain the
-- guarded boolean function in the unexposed private schema with no table grants.
ALTER FUNCTION public.pcl_discussion_realtime_allowed(text) SET SCHEMA erp_private;
GRANT USAGE ON SCHEMA erp_private TO authenticated;
REVOKE ALL ON FUNCTION erp_private.pcl_discussion_realtime_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION erp_private.pcl_discussion_realtime_allowed(text) TO authenticated;
