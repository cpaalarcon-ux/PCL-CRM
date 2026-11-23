CREATE TABLE erp_private.client_credentials (
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 credential_type text NOT NULL CHECK (credential_type IN ('KRA_ITAX','KRA_ETIMS')),
 username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 255),
 ciphertext text NOT NULL CHECK (char_length(ciphertext) BETWEEN 24 AND 1400),
 nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9+/]{16}$'),
 key_version text NOT NULL CHECK (key_version ~ '^[A-Z0-9_]{1,20}$'),
 updated_by uuid NOT NULL REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 PRIMARY KEY (client_id,credential_type)
);

CREATE TABLE erp_private.client_credential_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL,
 credential_type text NOT NULL,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,
 actor_auth_id uuid NOT NULL,
 credential_revision integer NOT NULL,
 action text NOT NULL CHECK (action IN ('REVEAL','UPDATE')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (client_id,credential_type) REFERENCES erp_private.client_credentials ON DELETE RESTRICT
);
CREATE INDEX client_credential_events_client_idx ON erp_private.client_credential_events(client_id,occurred_at DESC);
CREATE TRIGGER client_credential_events_immutable BEFORE UPDATE OR DELETE ON erp_private.client_credential_events
 FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

CREATE TABLE erp_private.client_credential_permissions (
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 permission text NOT NULL CHECK (permission IN ('View','Edit','Revoked')),
 changed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (client_id,staff_id)
);
ALTER TABLE erp_private.client_credential_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_credential_permissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.client_credential_permissions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER client_credential_permission_audit AFTER INSERT OR UPDATE ON erp_private.client_credential_permissions
 FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('client_id');

CREATE FUNCTION erp_private.client_credential_scope(c uuid, editing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH current_staff AS (SELECT x.staff_id,x.category_code FROM erp_private.actor() x)
 SELECT EXISTS(
  SELECT 1 FROM current_staff a
  JOIN erp_private.project_assignments pa ON pa.staff_id=a.staff_id
  JOIN erp_private.projects p USING(project_id,handling_firm_id)
  JOIN erp_private.clients cl ON cl.client_id=p.client_id AND cl.deleted_at IS NULL
  JOIN erp_private.staff_firm_access fa ON fa.staff_id=a.staff_id AND fa.firm_id=p.handling_firm_id AND fa.deleted_at IS NULL
  JOIN erp_private.firms f ON f.firm_id=p.handling_firm_id AND f.is_active AND f.deleted_at IS NULL
  WHERE p.client_id=c AND (NOT erp_private.uat_scope_enabled() OR cl.is_uat_fixture) AND p.status='Active' AND p.deleted_at IS NULL AND pa.deleted_at IS NULL
   AND coalesce(pa.start_date,'-infinity'::date)<=(now() AT TIME ZONE 'Africa/Nairobi')::date
   AND coalesce(pa.end_date,'infinity'::date)>=(now() AT TIME ZONE 'Africa/Nairobi')::date
   AND a.category_code IN ('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
   AND (NOT editing OR a.category_code IN ('PARTNER','MANAGER'))
   AND (a.category_code='PARTNER' OR EXISTS (
    SELECT 1 FROM erp_private.client_credential_permissions g WHERE g.client_id=c AND g.staff_id=a.staff_id
     AND (g.permission='Edit' OR (NOT editing AND g.permission='View'))
   ))
   AND NOT EXISTS (SELECT 1 FROM erp_private.staff_area_restrictions r WHERE r.staff_id=a.staff_id AND r.area_code='clients')
   AND NOT EXISTS (SELECT 1 FROM erp_private.staff_right_restrictions r WHERE r.staff_id=a.staff_id
    AND (r.right_code='clientvault.view' OR (editing AND r.right_code='clientvault.edit')))
 )
$$;
ALTER TABLE erp_private.client_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_credential_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_credential_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.client_credentials, erp_private.client_credential_events FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION erp_private.client_credential_scope(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_credential_scope(uuid,boolean) TO erp_api;
GRANT SELECT, INSERT, UPDATE ON erp_private.client_credentials TO erp_api;
GRANT INSERT ON erp_private.client_credential_events TO erp_api;
CREATE POLICY client_credential_read ON erp_private.client_credentials FOR SELECT TO erp_api
 USING (erp_private.client_credential_scope(client_id));
CREATE POLICY client_credential_create ON erp_private.client_credentials FOR INSERT TO erp_api
 WITH CHECK (erp_private.client_credential_scope(client_id,true) AND updated_by=(erp_private.actor()).staff_id AND revision=1);
CREATE POLICY client_credential_update ON erp_private.client_credentials FOR UPDATE TO erp_api
 USING (erp_private.client_credential_scope(client_id,true))
 WITH CHECK (erp_private.client_credential_scope(client_id,true) AND updated_by=(erp_private.actor()).staff_id);
CREATE POLICY client_credential_audit_insert ON erp_private.client_credential_events FOR INSERT TO erp_api
 WITH CHECK (erp_private.client_credential_scope(client_id,action='UPDATE') AND actor_id=(erp_private.actor()).staff_id
  AND actor_auth_id=auth.uid() AND EXISTS (
   SELECT 1 FROM erp_private.client_credentials c WHERE c.client_id=client_credential_events.client_id
    AND c.credential_type=client_credential_events.credential_type AND c.revision=credential_revision
 ));

CREATE FUNCTION erp_private.client_credential_people(c uuid)
RETURNS TABLE (staff_id uuid, full_name text, category_code text, permission text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.staff_id,s.full_name,s.category_code,coalesce(g.permission,'Revoked')
 FROM erp_private.staff_members s
 LEFT JOIN erp_private.client_credential_permissions g ON g.client_id=c AND g.staff_id=s.staff_id
 WHERE (erp_private.actor()).category_code='PARTNER' AND erp_private.client_credential_scope(c,true)
 AND s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code IN ('MANAGER','SUPERVISOR','ASSISTANT')
 AND coalesce(s.contract_end_date,'infinity'::date)>=(now() AT TIME ZONE 'Africa/Nairobi')::date
 AND EXISTS (
  SELECT 1 FROM erp_private.projects p JOIN erp_private.project_assignments a USING(project_id,handling_firm_id)
  JOIN erp_private.staff_firm_access f ON f.staff_id=a.staff_id AND f.firm_id=a.handling_firm_id AND f.deleted_at IS NULL
  JOIN erp_private.firms fr ON fr.firm_id=f.firm_id AND fr.is_active AND fr.deleted_at IS NULL
  WHERE p.client_id=c AND p.status='Active' AND p.deleted_at IS NULL AND a.staff_id=s.staff_id AND a.deleted_at IS NULL
   AND coalesce(a.start_date,'-infinity'::date)<=(now() AT TIME ZONE 'Africa/Nairobi')::date
   AND coalesce(a.end_date,'infinity'::date)>=(now() AT TIME ZONE 'Africa/Nairobi')::date
 )
 ORDER BY s.full_name,s.staff_id
$$;

CREATE FUNCTION erp_private.client_credential_permission(c uuid, s uuid, wanted text, expected text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members; target record;
BEGIN
 a:=erp_private.actor();
 IF a.category_code IS DISTINCT FROM 'PARTNER' OR NOT erp_private.client_credential_scope(c,true) THEN
  RAISE EXCEPTION 'An assigned Engagement Partner must manage credential access.' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c||':'||s||':credential-access',0));
 SELECT * INTO target FROM erp_private.client_credential_people(c) p WHERE p.staff_id=s;
 IF NOT FOUND OR wanted NOT IN ('View','Edit','Revoked') OR (wanted='Edit' AND target.category_code<>'MANAGER') THEN
  RAISE EXCEPTION 'Choose an eligible assigned staff member and permission.' USING ERRCODE='23514';
 END IF;
 IF target.permission IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Credential access changed. Reopen this client to refresh permissions.' USING ERRCODE='40001';
 END IF;
 IF target.permission IS DISTINCT FROM wanted THEN
  INSERT INTO erp_private.client_credential_permissions(client_id,staff_id,permission,changed_by)
   VALUES(c,s,wanted,a.staff_id)
   ON CONFLICT (client_id,staff_id) DO UPDATE
    SET permission=excluded.permission,changed_by=excluded.changed_by,changed_at=clock_timestamp();
 END IF;
END; $$;

REVOKE ALL ON FUNCTION erp_private.client_credential_people(uuid),erp_private.client_credential_permission(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_credential_people(uuid),erp_private.client_credential_permission(uuid,uuid,text,text) TO erp_api;

CREATE FUNCTION erp_private.client_credential_activity(c uuid)
RETURNS TABLE (credential_type text, action text, actor text, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT e.credential_type,e.action,s.full_name,e.occurred_at
 FROM erp_private.client_credential_events e JOIN erp_private.staff_members s ON s.staff_id=e.actor_id
 WHERE e.client_id=c AND (erp_private.actor()).category_code='PARTNER' AND erp_private.client_credential_scope(c)
 ORDER BY e.occurred_at DESC,e.event_id LIMIT 50
$$;
REVOKE ALL ON FUNCTION erp_private.client_credential_activity(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_credential_activity(uuid) TO erp_api;
