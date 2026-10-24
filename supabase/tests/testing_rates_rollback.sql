BEGIN;
DO $$
DECLARE u uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();s uuid:=gen_random_uuid();r uuid:=gen_random_uuid();approved uuid:=gen_random_uuid();changed uuid;
BEGIN
 INSERT INTO auth.users(id) VALUES(u);INSERT INTO auth.sessions(id,user_id) VALUES(sid,u);
 INSERT INTO erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status,sessions_invalid_before) VALUES(s,u,'TEST-RATE-MANAGER','test.rate.manager','Fictional rate Manager','MANAGER','Permanent','Active',now()-interval '1 day');
 INSERT INTO erp_private.pilot_sessions(session_id,staff_id,expires_at) VALUES(sid,s,now()+interval '1 hour');
 INSERT INTO erp_private.tax_rates(rate_id,rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,created_by,is_test,approved_by,approved_at) VALUES(r,'QA_PROVISIONAL','VAT','FICTIONAL TESTING RULE','2026-01-01','2026-12-31','{"rate":16}','https://www.kra.go.ke','Fictional permission fixture','Testing',s,true,null,null),(approved,'QA_IMMUTABLE','VAT','FICTIONAL FORMAL-PERMISSION FIXTURE','2026-01-01','2026-12-31','{"rate":16}','https://www.kra.go.ke','Fictional permission fixture','Approved',s,true,s,now());
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'session_id',sid)::text,true);SET LOCAL ROLE erp_api;
 UPDATE erp_private.tax_rates SET source_note='Amended testing fixture' WHERE rate_id=r RETURNING rate_id INTO changed;
 IF changed IS DISTINCT FROM r THEN RAISE EXCEPTION 'Provisional rule not amendable';END IF;
 changed:=NULL;UPDATE erp_private.tax_rates SET source_note='Forbidden formal edit' WHERE rate_id=approved RETURNING rate_id INTO changed;
 IF changed IS NOT NULL THEN RAISE EXCEPTION 'Formal rate became mutable';END IF;
 RESET ROLE;
END;$$;
ROLLBACK;
