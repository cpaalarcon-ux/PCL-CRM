-- Private task procedures; source tax computations and engagement gates remain authoritative.
CREATE TABLE erp_private.task_procedures (
 task_id uuid PRIMARY KEY REFERENCES erp_private.tasks,project_id uuid NOT NULL REFERENCES erp_private.projects,
 profile text NOT NULL DEFAULT 'Supporting task' CHECK(profile IN ('Supporting task','Compilation review','Service deliverable','Tax filing')),
 stage text NOT NULL DEFAULT 'Pending preparer' CHECK(stage IN ('Pending preparer','Pending client documents','Pending supervisor review','Awaiting client approval','Ready to file','Ready to deliver','Filed - pending payment','Delivered - pending closure','Closed')),
 case_id uuid REFERENCES erp_private.tax_cases,reviewer_id uuid REFERENCES erp_private.staff_members,prepared_by uuid REFERENCES erp_private.staff_members,
 contact_id uuid REFERENCES erp_private.client_contacts,details jsonb NOT NULL DEFAULT '{}',
 approval_document_id uuid REFERENCES erp_private.documents,filing_document_id uuid REFERENCES erp_private.documents,payment_document_id uuid REFERENCES erp_private.documents,deliverable_document_id uuid REFERENCES erp_private.documents,
 closed_by uuid REFERENCES erp_private.staff_members,closed_at timestamptz,revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX task_procedure_case_idx ON erp_private.task_procedures(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX task_procedure_project_idx ON erp_private.task_procedures(project_id,stage);
CREATE INDEX task_procedure_reviewer_idx ON erp_private.task_procedures(reviewer_id);
CREATE INDEX task_procedure_preparer_idx ON erp_private.task_procedures(prepared_by);
CREATE INDEX task_procedure_contact_idx ON erp_private.task_procedures(contact_id);
CREATE INDEX task_procedure_closed_by_idx ON erp_private.task_procedures(closed_by);
CREATE INDEX task_procedure_approval_doc_idx ON erp_private.task_procedures(approval_document_id);
CREATE INDEX task_procedure_filing_doc_idx ON erp_private.task_procedures(filing_document_id);
CREATE INDEX task_procedure_payment_doc_idx ON erp_private.task_procedures(payment_document_id);
CREATE INDEX task_procedure_deliverable_doc_idx ON erp_private.task_procedures(deliverable_document_id);
CREATE TABLE erp_private.procedure_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES erp_private.tasks,actor_id uuid REFERENCES erp_private.staff_members,
 action text NOT NULL,from_stage text,to_stage text,message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX procedure_event_task_idx ON erp_private.procedure_events(task_id,created_at);
CREATE INDEX procedure_event_actor_idx ON erp_private.procedure_events(actor_id);
ALTER TABLE erp_private.task_procedures ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.task_procedures FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.procedure_events ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.procedure_events FORCE ROW LEVEL SECURITY;
CREATE POLICY procedure_read ON erp_private.task_procedures FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=task_procedures.task_id));
CREATE POLICY procedure_insert ON erp_private.task_procedures FOR INSERT TO erp_api WITH CHECK(EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=task_procedures.task_id AND t.project_id=task_procedures.project_id));
CREATE POLICY procedure_update ON erp_private.task_procedures FOR UPDATE TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=task_procedures.task_id AND (t.assigned_to=(erp_private.actor()).staff_id OR erp_private.project_editor()))) WITH CHECK(EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=task_procedures.task_id AND t.project_id=task_procedures.project_id));
CREATE POLICY procedure_event_read ON erp_private.procedure_events FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=procedure_events.task_id));
CREATE POLICY procedure_event_insert ON erp_private.procedure_events FOR INSERT TO erp_api WITH CHECK(actor_id=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=procedure_events.task_id));
GRANT SELECT,INSERT,UPDATE ON erp_private.task_procedures TO erp_api;GRANT SELECT,INSERT ON erp_private.procedure_events TO erp_api;
REVOKE ALL ON erp_private.task_procedures,erp_private.procedure_events FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO erp_private.task_procedures(task_id,project_id,profile,stage,prepared_by,details)
 SELECT t.task_id,t.project_id,CASE WHEN template_key IN('monthly-vat','monthly-paye','monthly-tot') THEN 'Tax filing' WHEN template_key IN('weekly-review','monthly-review','annual-review') THEN 'Compilation review' ELSE 'Supporting task' END,
 CASE WHEN status IN('Completed','Cancelled') THEN 'Closed' ELSE 'Pending preparer' END,assigned_to,jsonb_build_object('legacy_completion',status IN('Completed','Cancelled')) FROM erp_private.tasks t;
CREATE FUNCTION erp_private.init_task_procedure() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO erp_private.task_procedures(task_id,project_id,profile,prepared_by,reviewer_id)
 VALUES(NEW.task_id,NEW.project_id,CASE WHEN NEW.template_key IN('monthly-vat','monthly-paye','monthly-tot') THEN 'Tax filing' WHEN NEW.template_key IN('weekly-review','monthly-review','annual-review') THEN 'Compilation review' ELSE 'Supporting task' END,NEW.assigned_to,(SELECT reviewer_id FROM erp_private.project_schedules WHERE project_id=NEW.project_id));
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(NEW.assigned_to,NEW.task_id,'New task: '||NEW.task_name,'new-task:'||NEW.task_id) ON CONFLICT DO NOTHING;RETURN NEW;
END;$$;
CREATE TRIGGER task_procedure_init AFTER INSERT ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.init_task_procedure();
CREATE FUNCTION erp_private.task_procedure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t erp_private.tasks;c erp_private.tax_cases;d uuid;target_client uuid;
BEGIN
 SELECT * INTO t FROM erp_private.tasks WHERE task_id=NEW.task_id;
 IF t.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'Procedure project mismatch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.stage='Closed' THEN RAISE EXCEPTION 'Closed work is immutable; record a separate correction' USING ERRCODE='23514';END IF;
  IF (NEW.task_id,NEW.project_id) IS DISTINCT FROM (OLD.task_id,OLD.project_id) THEN RAISE EXCEPTION 'Procedure identity is fixed' USING ERRCODE='23514';END IF;
  IF OLD.stage NOT IN('Pending preparer','Pending client documents') AND (NEW.profile,NEW.case_id,NEW.reviewer_id,NEW.contact_id) IS DISTINCT FROM (OLD.profile,OLD.case_id,OLD.reviewer_id,OLD.contact_id) AND NEW.stage<>'Pending preparer' THEN RAISE EXCEPTION 'Return work before changing setup' USING ERRCODE='23514';END IF;
  IF OLD.approval_document_id IS NOT NULL AND OLD.details->'approval' IS NOT NULL AND (NEW.approval_document_id,NEW.details->'approval') IS DISTINCT FROM (OLD.approval_document_id,OLD.details->'approval') THEN RAISE EXCEPTION 'Written approval is immutable' USING ERRCODE='23514';END IF;
 END IF;
 IF t.template_key IN('monthly-vat','monthly-paye','monthly-tot') AND NEW.profile<>'Tax filing' THEN RAISE EXCEPTION 'Statutory filing gates cannot be disabled' USING ERRCODE='23514';END IF;
 IF NEW.case_id IS NOT NULL THEN
  SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.case_id;
  IF c.project_id IS DISTINCT FROM NEW.project_id OR NEW.profile<>'Tax filing' THEN RAISE EXCEPTION 'Tax case must match this filing project' USING ERRCODE='23514';END IF;
  IF t.template_key IN('monthly-vat','monthly-paye','monthly-tot') AND (c.starts_on IS DISTINCT FROM t.period_start OR c.ends_on IS DISTINCT FROM t.period_end OR lower(c.kind) IS DISTINCT FROM replace(t.template_key,'monthly-','')) THEN RAISE EXCEPTION 'Tax type and return period must match the generated filing task' USING ERRCODE='23514';END IF;
 END IF;
 SELECT client_id INTO target_client FROM erp_private.projects WHERE project_id=NEW.project_id;
 IF NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_contacts WHERE contact_id=NEW.contact_id AND client_id=target_client AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Use this client representative' USING ERRCODE='23514';END IF;
 FOREACH d IN ARRAY ARRAY[NEW.approval_document_id,NEW.filing_document_id,NEW.payment_document_id,NEW.deliverable_document_id] LOOP
  IF d IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=d AND project_id=NEW.project_id AND deleted_at IS NULL AND is_locked) THEN RAISE EXCEPTION 'Evidence must be locked within the same project' USING ERRCODE='23514';END IF;
 END LOOP;
 IF NEW.stage IN('Ready to file','Ready to deliver','Filed - pending payment') AND (NEW.approval_document_id IS NULL OR NEW.contact_id IS NULL OR NEW.details->'approval' IS NULL) THEN RAISE EXCEPTION 'Written client approval required' USING ERRCODE='23514';END IF;
 IF NEW.stage='Ready to file' AND (NEW.case_id IS NULL OR c.status<>'Locked') THEN RAISE EXCEPTION 'Reviewed locked tax case required' USING ERRCODE='23514';END IF;
 IF NEW.stage='Filed - pending payment' AND (c.status IS DISTINCT FROM 'Filed' OR NEW.filing_document_id IS NULL) THEN RAISE EXCEPTION 'Filing and acknowledgment required' USING ERRCODE='23514';END IF;
 IF NEW.stage='Closed' AND NEW.profile<>'Supporting task' AND (NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') OR NEW.closed_by=NEW.prepared_by) THEN RAISE EXCEPTION 'Independent Manager closure required' USING ERRCODE='42501';END IF;
 IF NEW.stage='Closed' AND NEW.profile='Tax filing' AND (NEW.filing_document_id IS NULL OR c.status IS DISTINCT FROM 'Filed' OR (NEW.payment_document_id IS NULL AND coalesce(NEW.details->>'payment_outcome','')<>'Not payable')) THEN RAISE EXCEPTION 'Verify filing and payment or a documented nil liability' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER procedure_guard BEFORE INSERT OR UPDATE ON erp_private.task_procedures FOR EACH ROW EXECUTE FUNCTION erp_private.task_procedure_guard();
CREATE TRIGGER procedure_revision BEFORE UPDATE ON erp_private.task_procedures FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER procedure_audit AFTER INSERT OR UPDATE ON erp_private.task_procedures FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('task_id');
CREATE TRIGGER procedure_no_delete BEFORE DELETE ON erp_private.task_procedures FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER procedure_event_no_update BEFORE UPDATE OR DELETE ON erp_private.procedure_events FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.procedural_task_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w erp_private.task_procedures;
BEGIN SELECT * INTO w FROM erp_private.task_procedures WHERE task_id=OLD.task_id;
 IF w.stage='Closed' AND OLD.status='Completed' AND NOT coalesce((w.details->>'legacy_completion')::boolean,false) THEN RAISE EXCEPTION 'Closed task is audit locked' USING ERRCODE='23514';END IF;
 IF NEW.status='Completed' AND w.profile<>'Supporting task' AND w.stage<>'Closed' THEN RAISE EXCEPTION 'Use the procedure review and closure steps' USING ERRCODE='23514';END IF;
 IF w.stage IN('Pending supervisor review','Awaiting client approval','Ready to file','Ready to deliver','Filed - pending payment','Delivered - pending closure') AND NEW.status NOT IN('In Review','Completed') THEN RAISE EXCEPTION 'Use the review workflow to return or advance the task' USING ERRCODE='23514';END IF;
 RETURN NEW;END;$$;
CREATE TRIGGER task_procedural_guard BEFORE UPDATE ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.procedural_task_guard();
CREATE FUNCTION erp_private.tax_filing_approval_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF NEW.status='Filed' AND OLD.status<>'Filed' AND NOT EXISTS(SELECT 1 FROM erp_private.task_procedures w WHERE w.case_id=NEW.case_id AND w.profile='Tax filing' AND w.stage='Ready to file' AND w.approval_document_id IS NOT NULL AND w.filing_document_id IS NOT NULL AND w.details->'approval' IS NOT NULL) THEN RAISE EXCEPTION 'Written approval and filing evidence required through the task workspace' USING ERRCODE='23514';END IF;RETURN NEW;END;$$;
CREATE TRIGGER tax_case_client_approval BEFORE UPDATE ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.tax_filing_approval_gate();
REVOKE ALL ON FUNCTION erp_private.init_task_procedure(),erp_private.task_procedure_guard(),erp_private.procedural_task_guard(),erp_private.tax_filing_approval_gate() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.init_task_procedure(),erp_private.task_procedure_guard(),erp_private.procedural_task_guard(),erp_private.tax_filing_approval_gate() TO erp_api;

-- Tax weekly release is Monday 03:00 EAT; monthly internal target dates remain unchanged.
CREATE OR REPLACE FUNCTION erp_private.schedule_occurrences(freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH periods AS (
 SELECT 'Weekly'::text kind,d::date first_day,(d+interval '6 days')::date last_day FROM generate_series(date_trunc('week',starts::timestamp),ends::timestamp,interval '7 days') d
 WHERE freq IN ('Weekly','Weekly + Monthly','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Monthly',d::date,(d+interval '1 month -1 day')::date FROM generate_series(date_trunc('month',starts::timestamp),ends::timestamp,interval '1 month') d
 WHERE freq IN ('Monthly','Weekly + Monthly','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Quarterly',d::date,(d+interval '3 months -1 day')::date FROM generate_series(date_trunc('quarter',starts::timestamp),ends::timestamp,interval '3 months') d WHERE freq='Quarterly'
 UNION ALL SELECT 'Annually',d::date,(d+interval '1 year -1 day')::date FROM generate_series(date_trunc('year',starts::timestamp),ends::timestamp,interval '1 year') d WHERE freq IN ('Annually','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Once-off',starts,ends WHERE freq='Once-off'
 ), templates(key,label,kind,release_day,due_day,doc,review,obligation) AS (VALUES
 ('weekly-sales','Upload weekly sales','Weekly',0,6,true,false,''),
 ('weekly-purchases','Upload weekly purchases','Weekly',0,6,true,false,''),
 ('weekly-bank','Upload bank transactions','Weekly',0,6,true,false,''),
 ('weekly-mapping','Map purchases and reconcile bank','Weekly',0,6,false,false,''),
 ('weekly-review','Review weekly tax compilation','Weekly',0,6,false,true,''),
 ('weekly-report','Prepare weekly client report','Weekly',0,6,false,false,''),
 ('monthly-compile','Compile monthly tax schedules','Monthly',1,5,false,false,''),
 ('monthly-review','Review monthly tax compilation','Monthly',1,6,false,true,''),
 ('monthly-report','Prepare monthly client report','Monthly',1,7,false,false,''),
 ('monthly-paye','File PAYE return','Monthly',6,7,false,false,'PAYE'),
 ('monthly-vat','File VAT return','Monthly',15,18,false,false,'VAT'),
 ('monthly-tot','File TOT return','Monthly',15,18,false,false,'TOT'),
 ('annual-compile','Prepare annual tax schedules','Annually',1,365,false,false,''),
 ('annual-review','Review annual tax compilation','Annually',335,365,false,true,''),
 ('annual-report','Prepare annual client report','Annually',349,365,false,false,''),
 ('monthly-payroll','Prepare payroll','Monthly',22,25,false,false,'Payroll')),
 occurrences AS (
 SELECT t.key,t.label,p.first_day,p.last_day,
 CASE WHEN p.kind='Annually' THEN p.first_day::timestamp+(t.release_day-1)*interval '1 day'+interval '1 minute' WHEN p.kind='Weekly' THEN p.first_day::timestamp+interval '3 hours'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.release_day-1)*interval '1 day'+interval '1 minute' END rel,
 CASE WHEN p.kind='Annually' THEN p.last_day::timestamp+interval '23 hours 59 minutes' WHEN p.kind='Weekly' THEN p.last_day::timestamp+interval '23 hours 59 minutes'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.due_day-1)*interval '1 day'+interval '23 hours 59 minutes' END due,
 t.doc,t.review FROM periods p JOIN templates t ON t.kind=p.kind
 WHERE pack_name='Tax Compilation' AND (t.obligation='' OR t.obligation=ANY(obligations))
 UNION ALL
 SELECT 'general-'||lower(p.kind),'Complete '||lower(p.kind)||' project work',p.first_day,p.last_day,
 greatest(p.first_day,starts)::timestamp+interval '1 minute',least(p.last_day,ends)::timestamp+interval '23 hours 59 minutes',false,false
 FROM periods p WHERE pack_name='General' OR p.kind IN ('Once-off','Quarterly')
 ) SELECT key,label,first_day,last_day,
 greatest(rel,starts::timestamp+interval '1 minute',CASE WHEN key LIKE 'annual-%' THEN effective::timestamp+interval '1 minute' ELSE rel END) AT TIME ZONE 'Africa/Nairobi',due AT TIME ZONE 'Africa/Nairobi',doc,review
 FROM occurrences WHERE last_day>=starts AND first_day<=ends AND (effective<=starts OR first_day>=effective OR (key LIKE 'annual-%' AND last_day>=effective))
 AND (key NOT LIKE 'annual-%' OR rel<ends::timestamp+interval '1 day')
 AND (greatest(rel,starts::timestamp+interval '1 minute',CASE WHEN key LIKE 'annual-%' THEN effective::timestamp+interval '1 minute' ELSE rel END) AT TIME ZONE 'Africa/Nairobi')<=through_at
 ORDER BY rel,key
$$;


-- Evidence may only be locked through this application role; no file metadata rewrite privilege.
GRANT UPDATE(is_locked) ON erp_private.documents TO erp_api;
CREATE POLICY procedure_evidence_lock ON erp_private.documents FOR UPDATE TO erp_api
 USING(erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false))
 WITH CHECK(is_locked AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false));

-- Unonboarded drafts remain available for manual isolated testing.
CREATE OR REPLACE FUNCTION erp_private.run_workspace_scheduler() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE scheduled_project record;pending_task record;generated_count integer:=0;escalated integer:=0;
BEGIN
 FOR scheduled_project IN SELECT ps.project_id FROM erp_private.project_schedules ps JOIN erp_private.projects pr USING(project_id) JOIN erp_private.clients cl USING(client_id) WHERE ps.enabled AND ps.deleted_at IS NULL AND pr.deleted_at IS NULL AND pr.status='Active' AND cl.deleted_at IS NULL LOOP
 generated_count:=generated_count+erp_private.generate_project_tasks(scheduled_project.project_id);END LOOP;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 SELECT DISTINCT r.staff_id,t.task_id,'Overdue task: '||t.task_name,'overdue:'||t.task_id::text||':'||r.staff_id::text
 FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id
 LEFT JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 CROSS JOIN LATERAL(SELECT t.assigned_to staff_id UNION SELECT s.reviewer_id) r
 WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status<>'Archived' AND t.due_at<now()-interval '5 minutes'
 AND t.status NOT IN ('Completed','Cancelled') AND r.staff_id IS NOT NULL ON CONFLICT(event_key) DO NOTHING;
 FOR pending_task IN SELECT t.*,s.reviewer_id,p.handling_firm_id,r.category_code FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 JOIN erp_private.staff_members r ON r.staff_id=s.reviewer_id
 JOIN erp_private.staff_firm_access fa ON fa.staff_id=r.staff_id AND fa.firm_id=p.handling_firm_id AND fa.deleted_at IS NULL
 WHERE t.requires_document AND t.status IN ('Pending','In Progress','Blocked') AND t.due_at<now() AND t.deleted_at IS NULL
 AND p.deleted_at IS NULL AND p.status<>'Archived' AND s.enabled AND s.deleted_at IS NULL AND r.access_status='Active' AND r.deleted_at IS NULL
 AND r.category_code IN ('PARTNER','MANAGER','SUPERVISOR') AND t.assigned_to<>s.reviewer_id
 AND (r.contract_end_date IS NULL OR r.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.task_id=t.task_id AND d.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM erp_private.notifications n WHERE n.event_key='missing-document:'||t.task_id::text)
 LOOP
 UPDATE erp_private.tasks SET assigned_to=pending_task.reviewer_id,blocked_reason='Escalated automatically: required client document is overdue.' WHERE task_id=pending_task.task_id;
 INSERT INTO erp_private.task_events(task_id,event_type,from_staff_id,to_staff_id,reason) VALUES(pending_task.task_id,'Missing documents',pending_task.assigned_to,pending_task.reviewer_id,'Required upload is overdue.');
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(pending_task.reviewer_id,pending_task.task_id,'Missing document: '||pending_task.task_name,'missing-document:'||pending_task.task_id::text);
 escalated:=escalated+1;
 END LOOP;
 RETURN jsonb_build_object('generated',generated_count,'escalated',escalated);
END; $$;
;
