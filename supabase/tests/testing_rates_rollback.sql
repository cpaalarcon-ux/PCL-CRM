BEGIN;
DO $$
DECLARE
 manager_user uuid:=gen_random_uuid();partner_user uuid:=gen_random_uuid();
 manager_session uuid:=gen_random_uuid();partner_session uuid:=gen_random_uuid();
 manager_staff uuid:=gen_random_uuid();partner_staff uuid:=gen_random_uuid();
 testing_rate uuid:=gen_random_uuid();approval_rate uuid:=gen_random_uuid();self_rate uuid:=gen_random_uuid();
 old_testing uuid:=gen_random_uuid();old_approved uuid:=gen_random_uuid();changed uuid;
BEGIN
 INSERT INTO auth.users(id) VALUES(manager_user),(partner_user);
 INSERT INTO auth.sessions(id,user_id) VALUES(manager_session,manager_user),(partner_session,partner_user);
 INSERT INTO erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status,sessions_invalid_before)
 VALUES(manager_staff,manager_user,'TEST-RATE-MANAGER','test.rate.manager','Fictional rate Manager','MANAGER','Permanent','Active',now()-interval '1 day'),
       (partner_staff,partner_user,'TEST-RATE-PARTNER','test.rate.partner','Fictional rate Partner','PARTNER','Permanent','Active',now()-interval '1 day');
 INSERT INTO erp_private.pilot_sessions(session_id,staff_id,expires_at)
 VALUES(manager_session,manager_staff,now()+interval '1 hour'),(partner_session,partner_staff,now()+interval '1 hour');

 INSERT INTO erp_private.tax_rates(rate_id,rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,created_by,is_test,approved_by,approved_at)
 VALUES
 (testing_rate,'KE_TEST_AUTHORIZED','Corporation tax','Staging test fixture','2026-01-01','2026-12-31','{"rate":25}','https://www.kra.go.ke/tax','Income Tax Act section 3; controlled staging test fixture.','Draft',manager_staff,false,null,null),
 (approval_rate,'KE_TEST_APPROVAL','Corporation tax','Approval fixture','2026-01-01','2026-12-31','{"rate":30}','https://www.kra.go.ke/tax','Income Tax Act section 3 and Third Schedule; reviewed legal basis.','Draft',manager_staff,false,null,null),
 (self_rate,'KE_TEST_SELF_APPROVAL','Corporation tax','Self-approval fixture','2026-01-01','2026-12-31','{"rate":30}','https://www.kra.go.ke/tax','Income Tax Act section 3 and Third Schedule; reviewed legal basis.','Draft',partner_staff,false,null,null),
 (old_testing,'QA_PROVISIONAL','VAT','FICTIONAL TESTING RULE','2026-01-01','2026-12-31','{"rate":16}','https://www.kra.go.ke','Fictional permission fixture','Testing',manager_staff,true,null,null),
 (old_approved,'QA_IMMUTABLE','VAT','FICTIONAL FORMAL-PERMISSION FIXTURE','2026-01-01','2026-12-31','{"rate":16}','https://www.kra.go.ke','Fictional permission fixture','Approved',manager_staff,true,partner_staff,now());

 PERFORM set_config('request.jwt.claims',json_build_object('sub',manager_user,'session_id',manager_session)::text,true);
 SET LOCAL ROLE erp_api;

 BEGIN
  UPDATE erp_private.tax_rates SET status='Testing',testing_authorized_at=now() WHERE rate_id=testing_rate;
  RAISE EXCEPTION 'Testing status accepted without a test note';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 UPDATE erp_private.tax_rates SET status='Testing',testing_authorized_at=now(),testing_authorization_note='Compare the 2026 tax result with the reviewed sample and confirm the staged source mapping.' WHERE rate_id=testing_rate;

 UPDATE erp_private.tax_rates SET source_note='Amended testing fixture' WHERE rate_id=old_testing RETURNING rate_id INTO changed;
 IF changed IS DISTINCT FROM old_testing THEN RAISE EXCEPTION 'Provisional rule not amendable';END IF;
 changed:=NULL;UPDATE erp_private.tax_rates SET source_note='Forbidden formal edit' WHERE rate_id=old_approved RETURNING rate_id INTO changed;
 IF changed IS NOT NULL THEN RAISE EXCEPTION 'Formal rate became mutable';END IF;

 BEGIN
  UPDATE erp_private.tax_rates SET status='Approved',approved_by=manager_staff,approved_at=now(),partner_source_verified_on=current_date WHERE rate_id=approval_rate;
  RAISE EXCEPTION 'Manager approved a tax rate';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',partner_user,'session_id',partner_session)::text,true);
 BEGIN
  UPDATE erp_private.tax_rates SET status='Approved',approved_by=partner_staff,approved_at=now(),partner_source_verified_on=current_date WHERE rate_id=self_rate;
  RAISE EXCEPTION 'Partner approved their own tax rate';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 UPDATE erp_private.tax_rates SET status='Approved',approved_by=partner_staff,approved_at=now(),partner_source_verified_on=current_date WHERE rate_id=approval_rate RETURNING rate_id INTO changed;
 IF changed IS DISTINCT FROM approval_rate THEN RAISE EXCEPTION 'Independent Partner approval with official evidence failed';END IF;
 RESET ROLE;
END;$$;
ROLLBACK;
