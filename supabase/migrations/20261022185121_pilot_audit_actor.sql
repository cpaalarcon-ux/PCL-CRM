-- The managed auth schema cannot grant USAGE to a custom runtime role.
-- Use claims established only by the verified server connection for invoker audit code.
CREATE FUNCTION erp_private.request_actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
REVOKE EXECUTE ON FUNCTION erp_private.request_actor_id() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.request_actor_id() TO erp_api;
CREATE OR REPLACE FUNCTION erp_private.log_change() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
 VALUES(erp_private.request_actor_id(),current_user,TG_TABLE_NAME,TG_OP,to_jsonb(NEW)->>TG_ARGV[0],
 CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
 RETURN NEW;
END; $$;
ALTER POLICY audit_append ON erp_private.audit_events WITH CHECK(actor_auth_id=erp_private.request_actor_id() AND database_role='erp_api' AND (erp_private.actor()).staff_id IS NOT NULL);
ALTER POLICY access_append ON erp_private.document_access_events WITH CHECK(actor_auth_id=erp_private.request_actor_id() AND (erp_private.actor()).staff_id IS NOT NULL);
