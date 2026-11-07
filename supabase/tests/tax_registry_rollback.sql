-- Rollback-only fixtures: approvals never persist in an environment.
BEGIN;
DO $$
DECLARE f uuid:=gen_random_uuid();c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();ap uuid:=gen_random_uuid();s uuid:=gen_random_uuid();u uuid:=gen_random_uuid();sess uuid:=gen_random_uuid();profile uuid:=gen_random_uuid();rate uuid:=gen_random_uuid();other uuid:=gen_random_uuid();n integer;
BEGIN
 INSERT INTO auth.users(id) VALUES(u);INSERT INTO auth.sessions(id,user_id) VALUES(sess,u);
 INSERT INTO erp_private.firms(firm_id,firm_code,legal_name) VALUES(f,'R8TEST','Rollback-only firm');
 INSERT INTO erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status,sessions_invalid_before) VALUES(s,u,'R8TEST','r8.test','Rollback-only Partner','PARTNER','Permanent','Active',now()-interval '1 day');
 INSERT INTO erp_private.pilot_sessions(session_id,staff_id,expires_at) VALUES(sess,s,now()+interval '1 hour');
 INSERT INTO erp_private.staff_firm_access(staff_id,firm_id) VALUES(s,f);
 INSERT INTO erp_private.clients(client_id,company_name,owner_staff_id) VALUES(c,'Rollback-only client',s);
 INSERT INTO erp_private.client_firm_links(client_id,firm_id) VALUES(c,f);
 INSERT INTO erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) VALUES(p,c,f,'Tax project','TAX-COMP',s),(ap,c,f,'Audit project','AUD-STAT',s);
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(p,s,f,'PARTNER');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'session_id',sess)::text,true);
 SET LOCAL ROLE erp_api;
 INSERT INTO erp_private.engagement_controls(project_id,eqr_required,eqr_reviewer_id,stage) VALUES(p,true,s,'EQR'),(ap,true,s,'EQR');
 IF EXISTS(SELECT 1 FROM erp_private.engagement_controls WHERE project_id=p AND (eqr_required OR eqr_reviewer_id IS NOT NULL OR stage='EQR')) THEN RAISE EXCEPTION 'Tax incorrectly retains audit EQR';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.engagement_controls WHERE project_id=ap AND eqr_required AND stage='EQR') THEN RAISE EXCEPTION 'Audit EQR was removed';END IF;
 INSERT INTO erp_private.client_tax_profiles(profile_id,client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,created_by) VALUES(profile,c,'Company','Resident','Standard',ARRAY['VAT','Company'],'2026-01-01','2026-12-31','Rollback evidence',s);
 UPDATE erp_private.client_tax_profiles SET status='Verified',verified_by=s,verified_at=now() WHERE profile_id=profile;
 UPDATE erp_private.client_tax_profiles SET notes='Silent change' WHERE profile_id=profile;
 IF EXISTS(SELECT 1 FROM erp_private.client_tax_profiles WHERE profile_id=profile AND notes='Silent change') THEN RAISE EXCEPTION 'Verified profile changed';END IF;
 INSERT INTO erp_private.client_tax_profiles(profile_id,client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,created_by) VALUES(other,c,'Company','Resident','Standard',ARRAY['VAT'],'2026-02-01','2026-03-31','Overlap evidence',s);
 BEGIN UPDATE erp_private.client_tax_profiles SET status='Verified',verified_by=s,verified_at=now() WHERE profile_id=other;RAISE EXCEPTION 'Overlapping profile accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO erp_private.tax_rates(rate_id,rate_key,label,tax_type,effective_from,effective_to,parameters,source_url,source_note,created_by) VALUES(rate,'ROLLBACK_RATE','Rollback rule','VAT','2026-01-01','2026-12-31','{"rate":16}','https://www.kra.go.ke','Rollback only',s);
 UPDATE erp_private.tax_rates SET status='Approved',approved_by=s,approved_at=now() WHERE rate_id=rate;
 INSERT INTO erp_private.tax_rates(rate_id,rate_key,label,tax_type,effective_from,effective_to,parameters,source_url,source_note,created_by) VALUES(other,'ROLLBACK_RATE','Rollback rule','VAT','2026-02-01','2026-03-31','{"rate":16}','https://www.kra.go.ke','Rollback only',s);
 BEGIN UPDATE erp_private.tax_rates SET status='Approved',approved_by=s,approved_at=now() WHERE rate_id=other;RAISE EXCEPTION 'Overlapping approved rate accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 UPDATE erp_private.tax_rates SET rate_key='QA_TEST' WHERE rate_id=other;
 BEGIN UPDATE erp_private.tax_rates SET status='Approved',approved_by=s,approved_at=now() WHERE rate_id=other;RAISE EXCEPTION 'QA approved for clients';EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO erp_private.project_schedules(project_id,frequency,pack,starts_on,ends_on,effective_from,obligations,assigned_to,reviewer_id) VALUES(p,'Weekly + Monthly + Annually','Tax Compilation','2026-01-01','2026-12-31','2026-01-01',ARRAY['VAT','PAYE'],s,s);
 SELECT count(DISTINCT split_part(template_key,'-',1)) INTO n FROM erp_private.schedule_occurrences('Weekly + Monthly + Annually','Tax Compilation','2026-01-01','2026-12-31','2026-01-01',ARRAY['VAT','PAYE'],'2027-02-01');IF n<>3 THEN RAISE EXCEPTION 'Combined frequency missing a period';END IF;
 SELECT count(*) INTO n FROM erp_private.schedule_occurrences('Weekly + Monthly + Annually','Tax Compilation','2026-01-01','2026-12-31','2026-10-25',ARRAY['VAT'],'2026-10-26') WHERE template_key='annual-compile';IF n<>1 THEN RAISE EXCEPTION 'New annual frequency lost the current annual compilation';END IF;
 PERFORM erp_private.generate_project_tasks(p);SELECT count(*) INTO n FROM erp_private.tasks WHERE project_id=p;PERFORM erp_private.generate_project_tasks(p);IF n<>(SELECT count(*) FROM erp_private.tasks WHERE project_id=p) THEN RAISE EXCEPTION 'Recurrence creates duplicates';END IF;
 BEGIN UPDATE erp_private.release_checks SET status='Passed',evidence='Short',reviewed_by=s,reviewed_at=now() WHERE check_code='UAT';RAISE EXCEPTION 'UAT passed without evidence';EXCEPTION WHEN check_violation THEN NULL;END;
 RESET ROLE;
END;$$;
ROLLBACK;
