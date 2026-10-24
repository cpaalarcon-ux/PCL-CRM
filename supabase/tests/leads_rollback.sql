BEGIN;
DO $$
DECLARE f uuid:=gen_random_uuid();other_f uuid:=gen_random_uuid();c uuid:=gen_random_uuid();s uuid:=gen_random_uuid();u uuid:=gen_random_uuid();sess uuid:=gen_random_uuid();l uuid:=gen_random_uuid();other_l uuid:=gen_random_uuid();n integer;
BEGIN
 INSERT INTO auth.users(id) VALUES(u);INSERT INTO auth.sessions(id,user_id) VALUES(sess,u);
 INSERT INTO erp_private.firms(firm_id,firm_code,legal_name) VALUES(f,'LEADQA','Rollback firm'),(other_f,'LEADOTHER','Other rollback firm');
 INSERT INTO erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status,sessions_invalid_before) VALUES(s,u,'LEADQA','lead.qa','Rollback Manager','MANAGER','Permanent','Active',now()-interval '1 day');
 INSERT INTO erp_private.pilot_sessions(session_id,staff_id,expires_at) VALUES(sess,s,now()+interval '1 hour');
 INSERT INTO erp_private.staff_firm_access(staff_id,firm_id) VALUES(s,f);
 INSERT INTO erp_private.leads(lead_id,request_id,firm_id,company_name,primary_sector,branch_location,service_code,lead_source,owner_id) VALUES(other_l,gen_random_uuid(),other_f,'Inaccessible lead','Financial Services','Nairobi','TAX-COMP','Referral',s);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'session_id',sess)::text,true);SET LOCAL ROLE erp_api;
 IF EXISTS(SELECT 1 FROM erp_private.leads WHERE lead_id=other_l) THEN RAISE EXCEPTION 'Cross-firm lead leaked';END IF;
 INSERT INTO erp_private.leads(lead_id,request_id,firm_id,company_name,primary_sector,branch_location,service_code,lead_source,owner_id) VALUES(l,gen_random_uuid(),f,'Visible lead','Financial Services','Nairobi','TAX-COMP','Referral',s);
 IF NOT EXISTS(SELECT 1 FROM erp_private.leads WHERE lead_id=l AND potential_pie) THEN RAISE EXCEPTION 'PIE flag missing';END IF;
 BEGIN UPDATE erp_private.leads SET firm_id=other_f WHERE lead_id=l;RAISE EXCEPTION 'Firm changed';EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO erp_private.clients(client_id,company_name,owner_staff_id) VALUES(c,'Converted client',s);
 BEGIN UPDATE erp_private.leads SET stage='Converted',client_id=c,converted_at=now() WHERE lead_id=l;RAISE EXCEPTION 'Converted across missing firm link';EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO erp_private.client_firm_links(client_id,firm_id) VALUES(c,f);
 UPDATE erp_private.leads SET stage='Converted',client_id=c,converted_at=now() WHERE lead_id=l;
 BEGIN UPDATE erp_private.leads SET stage='Accepted' WHERE lead_id=l;RAISE EXCEPTION 'Converted lead overwritten';EXCEPTION WHEN check_violation THEN NULL;END;
 RESET ROLE;UPDATE erp_private.leads SET deleted_at=now() WHERE lead_id=l;SET LOCAL ROLE erp_api;
 IF EXISTS(SELECT 1 FROM erp_private.leads WHERE lead_id=l) THEN RAISE EXCEPTION 'Archived lead is visible';END IF;
 IF EXISTS(SELECT 1 FROM erp_private.projects WHERE client_id=c) THEN RAISE EXCEPTION 'Conversion activated a job';END IF;
 RESET ROLE;UPDATE erp_private.staff_members SET category_code='ASSISTANT' WHERE staff_id=s;SET LOCAL ROLE erp_api;
 IF EXISTS(SELECT 1 FROM erp_private.leads) THEN RAISE EXCEPTION 'Assistant can read leaders-only leads';END IF;
 BEGIN INSERT INTO erp_private.leads(request_id,firm_id,company_name,primary_sector,branch_location,service_code,lead_source,owner_id) VALUES(gen_random_uuid(),f,'Forbidden','Agribusiness','Nairobi','TAX-COMP','Referral',s);RAISE EXCEPTION 'Assistant created lead';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
END;$$;
ROLLBACK;
