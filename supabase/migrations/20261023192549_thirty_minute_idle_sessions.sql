BEGIN;
-- Only verified server identities may touch a session. Reading data or renewing a
-- token without new user activity must not advance the idle deadline.
CREATE FUNCTION erp_private.touch_session(p_session uuid,p_user uuid,p_activity_age_ms integer DEFAULT NULL,p_token_expiry timestamptz DEFAULT NULL)
RETURNS TABLE(staff_id uuid,last_seen_at timestamptz,expires_at timestamptz)
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 UPDATE erp_private.pilot_sessions p
 SET last_seen_at=CASE WHEN p_activity_age_ms IS NULL THEN p.last_seen_at ELSE greatest(p.last_seen_at,now()-p_activity_age_ms*interval '1 millisecond') END,
 expires_at=coalesce(p_token_expiry,p.expires_at)
 FROM erp_private.staff_members s,auth.sessions a
 WHERE p.session_id=p_session AND p.staff_id=s.staff_id AND a.id=p.session_id AND a.user_id=s.auth_user_id
 AND s.auth_user_id=p_user AND s.access_status='Active' AND s.deleted_at IS NULL
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND p.revoked_at IS NULL AND (p_token_expiry>now() OR p.expires_at>now())
 AND p.last_seen_at>now()-interval '30 minutes' AND p.issued_at>=s.sessions_invalid_before
 AND (p_activity_age_ms IS NULL OR p_activity_age_ms BETWEEN 0 AND 1799999)
 RETURNING p.staff_id,p.last_seen_at,p.expires_at
$$;
REVOKE ALL ON FUNCTION erp_private.touch_session(uuid,uuid,integer,timestamptz) FROM PUBLIC,anon,authenticated,service_role,erp_api;
CREATE OR REPLACE FUNCTION erp_private.actor() RETURNS erp_private.staff_members
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s FROM erp_private.staff_members s JOIN erp_private.pilot_sessions p ON p.staff_id=s.staff_id
 JOIN auth.sessions a ON a.id=p.session_id AND a.user_id=s.auth_user_id
 WHERE auth.uid() IS NOT NULL AND s.auth_user_id=auth.uid() AND p.session_id=(auth.jwt()->>'session_id')::uuid
 AND s.access_status='Active' AND s.deleted_at IS NULL
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND p.revoked_at IS NULL AND p.expires_at>now() AND p.last_seen_at>now()-interval '30 minutes'
 AND p.issued_at>=s.sessions_invalid_before LIMIT 1
$$;
COMMIT;
