-- Fictional records only. All records and changes roll back.
BEGIN;
DO $$
DECLARE uid uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();staff uuid:=gen_random_uuid();n integer;seen timestamptz;old_seen timestamptz:=now()-interval '10 minutes';
BEGIN
 INSERT INTO auth.users(id) VALUES(uid);
 INSERT INTO auth.sessions(id,user_id) VALUES(sid,uid);
 INSERT INTO erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status,auth_user_id,sessions_invalid_before)
 VALUES(staff,'IDLE-QA','idle.qa.'||left(staff::text,8),'Idle QA fictional staff','ASSISTANT','Permanent','Active',uid,now()-interval '1 day');
 INSERT INTO erp_private.pilot_sessions(session_id,staff_id,issued_at,last_seen_at,expires_at)
 VALUES(sid,staff,now()-interval '1 hour',old_seen,now()+interval '1 hour');
 SELECT last_seen_at INTO seen FROM erp_private.touch_session(sid,uid);
 IF seen IS DISTINCT FROM old_seen THEN RAISE EXCEPTION 'Background request extended idle time';END IF;
 SELECT last_seen_at INTO seen FROM erp_private.touch_session(sid,uid,NULL,now()+interval '2 hours');
 IF seen IS DISTINCT FROM old_seen THEN RAISE EXCEPTION 'Refresh without activity extended idle time';END IF;
 SELECT last_seen_at INTO seen FROM erp_private.touch_session(sid,uid,60000);
 IF seen IS DISTINCT FROM now()-interval '1 minute' THEN RAISE EXCEPTION 'Input age not preserved';END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',uid,'session_id',sid)::text,true);
 IF (erp_private.actor()).staff_id IS DISTINCT FROM staff THEN RAISE EXCEPTION 'Active staff denied';END IF;
 UPDATE erp_private.pilot_sessions SET last_seen_at=now()-interval '30 minutes' WHERE session_id=sid;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,0,now()+interval '2 hours');
 IF n<>1 OR (erp_private.actor()).staff_id IS DISTINCT FROM staff THEN RAISE EXCEPTION 'Inactivity incorrectly revoked manual login';END IF;
 UPDATE erp_private.pilot_sessions SET last_seen_at=now()-interval '29 minutes 59 seconds' WHERE session_id=sid;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,0);
 IF n<>1 THEN RAISE EXCEPTION 'Valid input before deadline rejected';END IF;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,gen_random_uuid(),0);
 IF n<>0 THEN RAISE EXCEPTION 'Mismatched identity accepted';END IF;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,-1);
 IF n<>0 THEN RAISE EXCEPTION 'Future input accepted';END IF;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,1800000);
 IF n<>1 THEN RAISE EXCEPTION 'Inactivity incorrectly rejected active login';END IF;
 UPDATE erp_private.pilot_sessions SET revoked_at=now() WHERE session_id=sid;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,0,now()+interval '2 hours');
 IF n<>0 THEN RAISE EXCEPTION 'Revoked session renewed';END IF;
 UPDATE erp_private.pilot_sessions SET revoked_at=NULL WHERE session_id=sid;
 UPDATE erp_private.staff_members SET access_status='Inactive' WHERE staff_id=staff;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,0);
 IF n<>0 THEN RAISE EXCEPTION 'Disabled staff accepted';END IF;
 UPDATE erp_private.staff_members SET access_status='Active',sessions_invalid_before=now() WHERE staff_id=staff;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,0);
 IF n<>0 THEN RAISE EXCEPTION 'Password-reset cutoff bypassed';END IF;
 UPDATE erp_private.staff_members SET sessions_invalid_before=now()-interval '1 day',contract_end_date=current_date-1 WHERE staff_id=staff;
 SELECT count(*) INTO n FROM erp_private.touch_session(sid,uid,0);
 IF n<>0 THEN RAISE EXCEPTION 'Expired staff contract accepted';END IF;
 UPDATE erp_private.staff_members SET contract_end_date=NULL WHERE staff_id=staff;
 IF has_function_privilege('erp_api','erp_private.touch_session(uuid,uuid,integer,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','erp_private.touch_session(uuid,uuid,integer,timestamptz)','EXECUTE')
 OR has_function_privilege('authenticated','erp_private.touch_session(uuid,uuid,integer,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Browser/application role can touch privileged session state';END IF;
END; $$;
ROLLBACK;
