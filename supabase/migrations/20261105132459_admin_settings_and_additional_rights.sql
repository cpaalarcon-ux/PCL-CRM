-- 1) System Administrator settings rights: add sectors, upload and download private reference
--    documents, read go-live readiness. Approval stays with Managers and Partners.
CREATE POLICY sectors_add_admin ON erp_private.sectors FOR INSERT
 WITH CHECK (erp_private.is_admin() AND NOT system_default);
CREATE POLICY reference_admin_read ON erp_private.reference_documents FOR SELECT
 USING (erp_private.is_admin());
CREATE POLICY reference_admin_insert ON erp_private.reference_documents FOR INSERT
 WITH CHECK (erp_private.is_admin() AND uploaded_by=(erp_private.actor()).staff_id AND status='Awaiting review');
CREATE POLICY reference_access_admin_add ON erp_private.reference_access_events FOR INSERT
 WITH CHECK (erp_private.is_admin() AND actor_id=(erp_private.actor()).staff_id AND action IN ('UPLOAD','DOWNLOAD'));
CREATE POLICY release_admin_read ON erp_private.release_checks FOR SELECT
 USING (erp_private.is_admin());

-- 2) Additional rights granted by a Partner to a named person, with a reason and an end date.
ALTER TABLE erp_private.staff_capabilities DROP CONSTRAINT staff_capabilities_pkey;
ALTER TABLE erp_private.staff_capabilities
 ADD COLUMN grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN reason text,
 ADD COLUMN granted_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 ADD COLUMN expires_on date,
 ADD COLUMN revoked_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 ADD COLUMN revoke_reason text;
ALTER TABLE erp_private.staff_capabilities ADD PRIMARY KEY (grant_id);
CREATE UNIQUE INDEX staff_capabilities_one_active ON erp_private.staff_capabilities(staff_id,capability) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION erp_private.has_capability(c text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND ((erp_private.actor()).category_code='PARTNER' OR EXISTS(
  SELECT 1 FROM erp_private.staff_capabilities x WHERE x.staff_id=(erp_private.actor()).staff_id AND x.capability=c AND x.deleted_at IS NULL
   AND (x.expires_on IS NULL OR x.expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date)))
$$;

CREATE OR REPLACE FUNCTION erp_private.staff_rights_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members; today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner can manage additional rights.' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('today',today,
  'staff',coalesce((SELECT jsonb_agg(jsonb_build_object('staff_id',s.staff_id,'staff_identifier',s.staff_identifier,'full_name',s.full_name,'category_code',s.category_code,'access_status',s.access_status,
     'grants',coalesce((SELECT jsonb_agg(jsonb_build_object('grant_id',g.grant_id,'capability',g.capability,'reason',g.reason,'expires_on',g.expires_on,'granted_at',g.created_at,'granted_by_name',gb.full_name,
        'expired',g.expires_on IS NOT NULL AND g.expires_on<today) ORDER BY g.created_at DESC)
       FROM erp_private.staff_capabilities g LEFT JOIN erp_private.staff_members gb ON gb.staff_id=g.granted_by WHERE g.staff_id=s.staff_id AND g.deleted_at IS NULL),'[]'::jsonb))
    ORDER BY s.staff_identifier) FROM erp_private.staff_members s WHERE s.deleted_at IS NULL),'[]'::jsonb),
  'history',coalesce((SELECT jsonb_agg(u.h ORDER BY u.at DESC) FROM (
    SELECT g.created_at at,jsonb_build_object('staff_name',s.full_name,'capability',g.capability,'reason',g.reason,'expires_on',g.expires_on,'at',g.created_at,'event','Granted','by',gb.full_name) h
     FROM erp_private.staff_capabilities g JOIN erp_private.staff_members s ON s.staff_id=g.staff_id LEFT JOIN erp_private.staff_members gb ON gb.staff_id=g.granted_by WHERE g.granted_by IS NOT NULL
    UNION ALL
    SELECT g.deleted_at,jsonb_build_object('staff_name',s.full_name,'capability',g.capability,'reason',g.revoke_reason,'expires_on',g.expires_on,'at',g.deleted_at,'event','Revoked','by',rb.full_name)
     FROM erp_private.staff_capabilities g JOIN erp_private.staff_members s ON s.staff_id=g.staff_id LEFT JOIN erp_private.staff_members rb ON rb.staff_id=g.revoked_by WHERE g.revoked_by IS NOT NULL
    ORDER BY 1 DESC LIMIT 100) u),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION erp_private.staff_right_grant(p_staff uuid,p_capability text,p_reason text,p_expires date) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members; t erp_private.staff_members; today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date; gid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner can grant additional rights.' USING ERRCODE='42501'; END IF;
 IF p_capability IS DISTINCT FROM 'FINANCE' THEN RAISE EXCEPTION 'Only the FINANCE right can be granted today. HR, MLRO and SYSTEM_ADMIN are reserved and no screen uses them yet.' USING ERRCODE='23514'; END IF;
 SELECT * INTO t FROM erp_private.staff_members WHERE staff_id=p_staff AND deleted_at IS NULL FOR UPDATE;
 IF t.staff_id IS NULL THEN RAISE EXCEPTION 'Choose a current staff member.' USING ERRCODE='23514'; END IF;
 IF t.staff_id=a.staff_id THEN RAISE EXCEPTION 'You cannot grant a right to yourself. Ask another Engagement Partner.' USING ERRCODE='42501'; END IF;
 IF t.access_status<>'Active' THEN RAISE EXCEPTION 'This account is not active.' USING ERRCODE='23514'; END IF;
 IF t.category_code='PARTNER' THEN RAISE EXCEPTION 'Engagement Partners already hold every additional right.' USING ERRCODE='23514'; END IF;
 IF t.category_code='ADMIN' THEN RAISE EXCEPTION 'System Administrators do not work on client or finance records, so they cannot hold the FINANCE right.' USING ERRCODE='23514'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Record the reason for this right (at least 10 characters).' USING ERRCODE='23514'; END IF;
 IF p_expires IS NULL OR p_expires<today OR p_expires>today+365 THEN RAISE EXCEPTION 'Choose an end date from today up to one year ahead.' USING ERRCODE='23514'; END IF;
 IF t.contract_end_date IS NOT NULL AND p_expires>t.contract_end_date THEN RAISE EXCEPTION 'The end date cannot be after this person''s contract end date.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.staff_capabilities WHERE staff_id=p_staff AND capability=p_capability AND deleted_at IS NULL) THEN RAISE EXCEPTION 'This person already has the right. Revoke it first to change the end date.' USING ERRCODE='23505'; END IF;
 INSERT INTO erp_private.staff_capabilities(staff_id,capability,reason,granted_by,expires_on) VALUES(p_staff,p_capability,btrim(p_reason),a.staff_id,p_expires) RETURNING grant_id INTO gid;
 INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values)
  VALUES(auth.uid(),current_user,'staff_capabilities','STAFF_RIGHT_GRANTED',gid::text,jsonb_build_object('staff_id',p_staff,'capability',p_capability,'expires_on',p_expires,'reason',btrim(p_reason)));
 RETURN gid;
END $$;

CREATE OR REPLACE FUNCTION erp_private.staff_right_revoke(p_grant uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members; g erp_private.staff_capabilities;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner can revoke additional rights.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'Record why the right is withdrawn.' USING ERRCODE='23514'; END IF;
 SELECT * INTO g FROM erp_private.staff_capabilities WHERE grant_id=p_grant AND deleted_at IS NULL FOR UPDATE;
 IF g.grant_id IS NULL THEN RAISE EXCEPTION 'This right was already withdrawn.' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.staff_capabilities SET deleted_at=now(),revoked_by=a.staff_id,revoke_reason=btrim(p_reason) WHERE grant_id=p_grant;
 INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values)
  VALUES(auth.uid(),current_user,'staff_capabilities','STAFF_RIGHT_REVOKED',p_grant::text,jsonb_build_object('staff_id',g.staff_id,'capability',g.capability,'reason',btrim(p_reason)));
END $$;

REVOKE ALL ON FUNCTION erp_private.staff_rights_overview(),erp_private.staff_right_grant(uuid,text,text,date),erp_private.staff_right_revoke(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.staff_rights_overview(),erp_private.staff_right_grant(uuid,text,text,date),erp_private.staff_right_revoke(uuid,text) TO erp_api;
