-- Audit build F: links from the audit file to the rest of the firm.
-- 1. Audit hours are ordinary timesheets on the audit project, so they already reach WIP. The file now shows them with budget and WIP.
-- 2. Approving an audit file raises a DRAFT invoice for the unbilled agreed fee. A Partner posts it. Nothing is posted automatically.
-- 3. A sign-off deadline on the file, and firm tiles for Partners and Managers: deadlines, workpapers reviewed before sign-off, files stuck by stage.

ALTER TABLE erp_private.audit_files ADD COLUMN signoff_due_on date;

CREATE FUNCTION erp_private.audit_deadline_save(p_file uuid,p_due date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner sets the sign-off deadline' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed' USING ERRCODE='23514'; END IF;
 IF p_due IS NOT NULL AND p_due<f.ends_on THEN RAISE EXCEPTION 'The deadline cannot be before the end of the audit period' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_files SET signoff_due_on=p_due WHERE audit_file_id=p_file;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Hours, budget and WIP for the audit project. Money values are shown to Managers and Partners only.
CREATE FUNCTION erp_private.audit_time_summary(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;res jsonb;money boolean;bud record;std numeric;billed numeric;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RETURN NULL; END IF;
 money:=a.category_code IN('MANAGER','PARTNER');
 SELECT agreed_fee,budgeted_hours INTO bud FROM erp_private.project_budgets WHERE project_id=f.project_id AND effective_from<=current_date ORDER BY effective_from DESC LIMIT 1;
 SELECT COALESCE(sum(t.hours*r.billable_rate),0) INTO std FROM erp_private.timesheets t
  JOIN LATERAL(SELECT x.billable_rate FROM erp_private.staff_rates x WHERE x.staff_id=t.staff_id AND t.work_date BETWEEN x.effective_from AND x.effective_to ORDER BY x.effective_from DESC LIMIT 1) r ON true
  WHERE t.project_id=f.project_id AND t.status='Approved' AND t.billable AND t.deleted_at IS NULL;
 SELECT COALESCE(sum((l->>'net')::numeric),0) INTO billed FROM erp_private.invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) l WHERE i.project_id=f.project_id AND i.status='Posted' AND i.deleted_at IS NULL AND COALESCE(l->>'line_type','Fee')<>'Disbursement';
 SELECT jsonb_build_object(
   'approved_hours',COALESCE(sum(hours) FILTER(WHERE status='Approved'),0),'submitted_hours',COALESCE(sum(hours) FILTER(WHERE status='Submitted'),0),'draft_hours',COALESCE(sum(hours) FILTER(WHERE status='Draft'),0),
   'budgeted_hours',bud.budgeted_hours,
   'hours_without_rate',(SELECT COALESCE(sum(t.hours),0) FROM erp_private.timesheets t WHERE t.project_id=f.project_id AND t.status='Approved' AND t.billable AND t.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM erp_private.staff_rates x WHERE x.staff_id=t.staff_id AND t.work_date BETWEEN x.effective_from AND x.effective_to)),
   'by_staff',(SELECT COALESCE(jsonb_agg(jsonb_build_object('staff_name',q.full_name,'approved',q.ap,'submitted',q.su,'draft',q.dr) ORDER BY q.full_name),'[]'::jsonb) FROM (SELECT s.full_name,sum(t.hours) FILTER(WHERE t.status='Approved') ap,sum(t.hours) FILTER(WHERE t.status='Submitted') su,sum(t.hours) FILTER(WHERE t.status='Draft') dr FROM erp_private.timesheets t JOIN erp_private.staff_members s ON s.staff_id=t.staff_id WHERE t.project_id=f.project_id AND t.deleted_at IS NULL AND t.status IN('Approved','Submitted','Draft') GROUP BY s.staff_id,s.full_name) q),
   'money_visible',money,
   'agreed_fee',CASE WHEN money THEN bud.agreed_fee END,
   'standard_value',CASE WHEN money THEN round(std,2) END,
   'billed_net',CASE WHEN money THEN billed END,
   'wip_unbilled',CASE WHEN money THEN round(greatest(0,std-billed),2) END,
   'draft_invoices',(SELECT count(*)::int FROM erp_private.invoices WHERE project_id=f.project_id AND status='Draft' AND deleted_at IS NULL))
 INTO res FROM erp_private.timesheets t WHERE t.project_id=f.project_id AND t.deleted_at IS NULL;
 RETURN COALESCE(res,'{}'::jsonb);
END $$;

-- The draft invoice raised when a file is approved.
CREATE TABLE erp_private.audit_billing_links (
 audit_file_id uuid PRIMARY KEY REFERENCES erp_private.audit_files,
 project_id uuid NOT NULL,
 invoice_id uuid REFERENCES erp_private.invoices,
 outcome text NOT NULL CHECK(outcome IN('Draft invoice raised','No agreed fee on record','Agreed fee already invoiced')),
 amount_net numeric(16,2),
 note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_billing_links_invoice_idx ON erp_private.audit_billing_links(invoice_id);
CREATE INDEX audit_billing_links_by_idx ON erp_private.audit_billing_links(created_by);
CREATE INDEX audit_billing_links_project_idx ON erp_private.audit_billing_links(project_id);
ALTER TABLE erp_private.audit_billing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.audit_billing_links FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.audit_billing_links TO erp_api;
CREATE POLICY audit_billing_links_read ON erp_private.audit_billing_links FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('MANAGER','PARTNER'));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.audit_billing_links FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_update BEFORE UPDATE ON erp_private.audit_billing_links FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

CREATE FUNCTION erp_private.audit_file_billing() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE act uuid;agreed numeric;billed numeric;remaining numeric;vr numeric;net numeric;vat numeric;inv uuid;outcome text;note text:='';cname text;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.audit_billing_links WHERE audit_file_id=NEW.audit_file_id) THEN RETURN NEW; END IF;
 act:=COALESCE((erp_private.actor()).staff_id,NEW.created_by);
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=NEW.client_id;
 SELECT agreed_fee INTO agreed FROM erp_private.project_budgets WHERE project_id=NEW.project_id AND effective_from<=today ORDER BY effective_from DESC LIMIT 1;
 SELECT COALESCE(sum((l->>'net')::numeric),0) INTO billed FROM erp_private.invoices i CROSS JOIN LATERAL jsonb_array_elements(i.lines) l WHERE i.project_id=NEW.project_id AND i.status<>'Void' AND i.deleted_at IS NULL AND COALESCE(l->>'line_type','Fee')<>'Disbursement';
 IF agreed IS NULL OR agreed<=0 THEN outcome:='No agreed fee on record'; note:='No draft invoice was raised because the project has no agreed fee. Raise the invoice manually.';
 ELSIF agreed-billed<=0 THEN outcome:='Agreed fee already invoiced'; note:='The agreed fee has already been invoiced, so no draft was raised.';
 ELSE
  remaining:=agreed-billed;net:=round(remaining,2);
  vr:=16;vat:=round(net*vr/100,2);
  INSERT INTO erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,created_by)
   VALUES(md5('audit-file-invoice:'||NEW.audit_file_id)::uuid,NEW.project_id,NEW.client_id,NEW.handling_firm_id,'Statutory audit for the period ended '||NEW.ends_on,today,today+30,
    jsonb_build_array(jsonb_build_object('description','Audit fee: remaining agreed fee for the period '||NEW.starts_on||' to '||NEW.ends_on,'line_type','Fee','quantity',1,'unit_price',net,'vat_rate',vr,'net',net,'vat',vat,'total',net+vat)),net,vat,act) RETURNING invoice_id INTO inv;
  outcome:='Draft invoice raised';note:='VAT at the firm rate of 16%. Disbursements already invoiced are not counted against the agreed fee. Check the amount, then a Partner posts it or voids it.';
 END IF;
 INSERT INTO erp_private.audit_billing_links(audit_file_id,project_id,invoice_id,outcome,amount_net,note,created_by) VALUES(NEW.audit_file_id,NEW.project_id,inv,outcome,net,note,act);
 PERFORM erp_private.alert_partners('audit-billing:'||NEW.audit_file_id::text,'Audit file for '||COALESCE(cname,'a client')||' was approved. '||CASE WHEN inv IS NOT NULL THEN 'A draft invoice of KES '||net||' (before VAT) is waiting for a Partner to post.' ELSE note END);
 RETURN NEW;
END $$;
CREATE TRIGGER zz_billing_link AFTER UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW WHEN (NEW.file_status='Approved' AND OLD.file_status IS DISTINCT FROM 'Approved') EXECUTE FUNCTION erp_private.audit_file_billing();

-- Firm tiles for Managers and Partners, within the files they can see.
CREATE FUNCTION erp_private.audit_firm_tiles(p_stuck_days integer DEFAULT 14) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;res jsonb;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;d integer:=LEAST(GREATEST(COALESCE(p_stuck_days,14),3),180);
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RETURN NULL; END IF;
 WITH vis AS (SELECT f.audit_file_id,f.project_id,f.file_status,f.ends_on,f.signoff_due_on,c.company_name,greatest(f.updated_at,COALESCE((SELECT max(w.updated_at) FROM erp_private.audit_workpapers w WHERE w.audit_file_id=f.audit_file_id),f.updated_at),COALESCE((SELECT max(x.updated_at) FROM erp_private.audit_adjustments x WHERE x.audit_file_id=f.audit_file_id),f.updated_at)) last_activity
   FROM erp_private.audit_files f JOIN erp_private.clients c ON c.client_id=f.client_id WHERE erp_private.project_allowed(f.project_id)),
 opn AS (SELECT * FROM vis WHERE file_status NOT IN('Approved','Completion','Archived')),
 wp AS (SELECT w.status FROM erp_private.audit_workpapers w JOIN vis ON vis.audit_file_id=w.audit_file_id WHERE vis.file_status IN('In Review','Approved','Completion','Archived') AND w.status<>'Draft')
 SELECT jsonb_build_object(
  'open_files',(SELECT count(*)::int FROM opn),
  'deadlines',jsonb_build_object('overdue',(SELECT count(*)::int FROM opn WHERE signoff_due_on<today),'due_14_days',(SELECT count(*)::int FROM opn WHERE signoff_due_on BETWEEN today AND today+14),'later',(SELECT count(*)::int FROM opn WHERE signoff_due_on>today+14),'not_set',(SELECT count(*)::int FROM opn WHERE signoff_due_on IS NULL),
   'next',(SELECT COALESCE(jsonb_agg(jsonb_build_object('audit_file_id',audit_file_id,'project_id',project_id,'client',company_name,'due',signoff_due_on,'status',file_status,'days',signoff_due_on-today) ORDER BY signoff_due_on),'[]'::jsonb) FROM (SELECT * FROM opn WHERE signoff_due_on IS NOT NULL ORDER BY signoff_due_on LIMIT 8) n)),
  'review_rate',jsonb_build_object('reviewed',(SELECT count(*)::int FROM wp WHERE status='Approved'),'sent_for_review',(SELECT count(*)::int FROM wp),'pct',(SELECT CASE WHEN count(*)>0 THEN round(100.0*count(*) FILTER(WHERE status='Approved')/count(*),1) END FROM wp),
   'note','Working papers approved by a reviewer, out of those submitted, on files at review or later.'),
  'stuck',jsonb_build_object('days',d,'by_stage',(SELECT COALESCE(jsonb_object_agg(file_status,n),'{}'::jsonb) FROM (SELECT file_status,count(*)::int n FROM opn WHERE last_activity<now()-make_interval(days=>d) GROUP BY 1) s),
   'files',(SELECT COALESCE(jsonb_agg(jsonb_build_object('audit_file_id',audit_file_id,'project_id',project_id,'client',company_name,'status',file_status,'idle_days',(now()::date-last_activity::date)) ORDER BY last_activity),'[]'::jsonb) FROM (SELECT * FROM opn WHERE last_activity<now()-make_interval(days=>d) ORDER BY last_activity LIMIT 8) s)),
  'draft_invoices_waiting',(SELECT count(*)::int FROM erp_private.audit_billing_links l JOIN erp_private.invoices i ON i.invoice_id=l.invoice_id WHERE i.status='Draft' AND erp_private.project_allowed(l.project_id)))
 INTO res;
 RETURN res;
END $$;

REVOKE ALL ON FUNCTION erp_private.audit_file_billing() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_deadline_save(uuid,date),erp_private.audit_time_summary(uuid),erp_private.audit_firm_tiles(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_deadline_save(uuid,date),erp_private.audit_time_summary(uuid),erp_private.audit_firm_tiles(integer) TO erp_api;
