-- Audit build D: draft financial statements, management letter points and letter, representation letter, completion memorandum.
-- Reports are built on the server from the adjusted trial balance and the file's own records, saved as versions, and reviewed by a different person.
-- An approved report is out of date once the figures behind it change. The audit file cannot be approved until the required reports are approved and current.

CREATE TABLE erp_private.audit_management_points (
 point_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 point_seq integer NOT NULL CHECK(point_seq>0),
 point_ref text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title))>=5),
 observation text NOT NULL CHECK(length(btrim(observation))>=10),
 implication text NOT NULL DEFAULT '',
 recommendation text NOT NULL DEFAULT '',
 rating text NOT NULL DEFAULT 'Medium' CHECK(rating IN('Low','Medium','High')),
 management_response text NOT NULL DEFAULT '',
 source_kind text NOT NULL DEFAULT 'Manual' CHECK(source_kind IN('Manual','Misstatement','Adjustment','Lead schedule','Workpaper deviation')),
 source_id uuid,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Included','Dropped')),
 decision_note text NOT NULL DEFAULT '',
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(audit_file_id,point_seq),
 CHECK(status='Open' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
 CHECK(status<>'Dropped' OR length(btrim(decision_note))>=10),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE UNIQUE INDEX audit_mgmt_points_source ON erp_private.audit_management_points(audit_file_id,source_kind,source_id) WHERE source_id IS NOT NULL;
CREATE INDEX audit_mgmt_points_file_idx ON erp_private.audit_management_points(audit_file_id,status);

CREATE TABLE erp_private.audit_reports (
 report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('Financial statements','Management letter','Representation letter','Completion memorandum')),
 version_number integer NOT NULL CHECK(version_number>0),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Submitted','Returned','Approved','Superseded')),
 params jsonb NOT NULL DEFAULT '{}'::jsonb,
 body jsonb NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256 ~ '^[a-f0-9]{64}$'),
 basis_sha256 text NOT NULL CHECK(basis_sha256 ~ '^[a-f0-9]{64}$'),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 submitted_at timestamptz,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(audit_file_id,kind,version_number),
 CHECK(status NOT IN('Submitted','Approved') OR submitted_at IS NOT NULL),
 CHECK(status<>'Approved' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by)),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_reports_file_idx ON erp_private.audit_reports(audit_file_id,kind,status);
CREATE INDEX audit_reports_prepared_idx ON erp_private.audit_reports(prepared_by);

DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_management_points','audit_reports'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
  EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',t);
 END LOOP;
END $do$;
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_management_points FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('point_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_reports FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('report_id');

-- A saved report never changes its content. Only its status and review fields move.
CREATE FUNCTION erp_private.audit_report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.body IS DISTINCT FROM OLD.body OR NEW.body_sha256<>OLD.body_sha256 OR NEW.basis_sha256<>OLD.basis_sha256 OR NEW.kind<>OLD.kind OR NEW.prepared_by<>OLD.prepared_by OR NEW.params IS DISTINCT FROM OLD.params OR NEW.version_number<>OLD.version_number THEN
  RAISE EXCEPTION 'A saved report cannot be edited; draft a new version' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('Approved','Superseded') AND NEW.status<>OLD.status AND NOT(OLD.status='Approved' AND NEW.status='Superseded') THEN
  RAISE EXCEPTION 'An approved report can only be superseded by a newer approved version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_lock BEFORE UPDATE ON erp_private.audit_reports FOR EACH ROW EXECUTE FUNCTION erp_private.audit_report_guard();

-- Financial statements from the adjusted trial balance. Debit-normal lines (assets, expenses) are shown as debit minus credit; credit-normal lines the reverse.
CREATE FUNCTION erp_private.audit_fs_calc(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;res jsonb;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 WITH cur AS (SELECT account_code,account_name,financial_statement_line fl,adjusted_net net,audit_account_id aid FROM erp_private.audit_adjusted_tb_calc(p_file)),
 cmp AS (SELECT l.audit_account_id aid,sum(l.source_debit-l.source_credit) net FROM erp_private.audit_tb_lines l JOIN erp_private.audit_tb_imports i ON i.audit_tb_import_id=l.audit_tb_import_id WHERE i.audit_file_id=p_file AND i.period_kind='Comparative' AND i.status='Confirmed' AND l.audit_account_id IS NOT NULL GROUP BY 1),
 allacc AS (SELECT c.aid,c.account_code,c.account_name,c.fl,c.net cur_net,cmp.net cmp_net FROM cur c LEFT JOIN cmp ON cmp.aid=c.aid),
 sg AS (SELECT *,CASE WHEN fl IN('Liabilities','Equity','Revenue') THEN -1 ELSE 1 END sgn FROM allacc),
 lines AS (SELECT fl,jsonb_agg(jsonb_build_object('account_code',account_code,'account_name',account_name,'current',round(cur_net*sgn,2),'comparative',CASE WHEN cmp_net IS NULL THEN NULL ELSE round(cmp_net*sgn,2) END) ORDER BY account_code) items,
   round(sum(cur_net*sgn),2) cur_total,CASE WHEN bool_or(cmp_net IS NOT NULL) THEN round(sum(COALESCE(cmp_net,0)*sgn),2) END cmp_total FROM sg GROUP BY fl),
 t AS (SELECT COALESCE(max(cur_total) FILTER(WHERE fl='Assets'),0) assets,COALESCE(max(cur_total) FILTER(WHERE fl='Liabilities'),0) liabilities,COALESCE(max(cur_total) FILTER(WHERE fl='Equity'),0) equity,
   COALESCE(max(cur_total) FILTER(WHERE fl='Revenue'),0) revenue,COALESCE(max(cur_total) FILTER(WHERE fl='Cost of sales'),0) cos,COALESCE(max(cur_total) FILTER(WHERE fl='Operating expenses'),0) opex,
   COALESCE(max(cur_total) FILTER(WHERE fl='Finance costs'),0) fin,COALESCE(max(cur_total) FILTER(WHERE fl='Tax expense'),0) tax,
   count(*) FILTER(WHERE fl IN('Cash flows','Disclosure only','Not applicable')) excluded_lines FROM lines)
 SELECT jsonb_build_object('statement','Financial statements','framework',f.reporting_framework,'framework_status',f.framework_status,'period_start',f.starts_on,'period_end',f.ends_on,
   'comparative_available',EXISTS(SELECT 1 FROM erp_private.audit_tb_imports i WHERE i.audit_file_id=p_file AND i.period_kind='Comparative' AND i.status='Confirmed'),
   'sections',COALESCE((SELECT jsonb_agg(jsonb_build_object('line',fl,'total',cur_total,'comparative_total',cmp_total,'items',items) ORDER BY array_position(ARRAY['Assets','Liabilities','Equity','Revenue','Cost of sales','Operating expenses','Finance costs','Tax expense','Cash flows','Disclosure only','Not applicable'],fl)) FROM lines),'[]'::jsonb),
   'totals',jsonb_build_object('revenue',t.revenue,'cost_of_sales',t.cos,'gross_profit',t.revenue-t.cos,'operating_expenses',t.opex,'finance_costs',t.fin,'profit_before_tax',t.revenue-t.cos-t.opex-t.fin,'tax_expense',t.tax,'profit_for_the_year',t.revenue-t.cos-t.opex-t.fin-t.tax,
     'total_assets',t.assets,'total_liabilities',t.liabilities,'total_equity',t.equity,'equity_including_profit',t.equity+(t.revenue-t.cos-t.opex-t.fin-t.tax),
     'difference',round(t.assets-t.liabilities-t.equity-(t.revenue-t.cos-t.opex-t.fin-t.tax),2),'excluded_sections',t.excluded_lines),
   'balances',round(t.assets-t.liabilities-t.equity-(t.revenue-t.cos-t.opex-t.fin-t.tax),2)=0,
   'unmapped_tb_lines',(SELECT count(*)::int FROM erp_private.audit_tb_lines l JOIN erp_private.audit_tb_imports i ON i.audit_tb_import_id=l.audit_tb_import_id WHERE i.audit_file_id=p_file AND i.period_kind='Current' AND i.status='Confirmed' AND l.audit_account_id IS NULL),
   'note','Draft prepared from the adjusted trial balance. A Partner must confirm the presentation and disclosures for the stated framework before issue.') INTO res FROM t;
 RETURN res;
END $$;

-- What a report is built on. If this changes, an approved report is out of date.
CREATE FUNCTION erp_private.audit_report_basis(p_file uuid,p_kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s text;
BEGIN
 s:=COALESCE((SELECT jsonb_agg(jsonb_build_array(account_code,round(adjusted_net,2)) ORDER BY account_code)::text FROM erp_private.audit_adjusted_tb_calc(p_file)),'[]')
  ||'|'||COALESCE((SELECT (erp_private.audit_misstatement_calc(p_file)->'gross_profit_effect')::text),'')
  ||'|'||COALESCE((SELECT count(*)::text FROM erp_private.audit_adjustments WHERE audit_file_id=p_file AND status='Approved'),'0');
 IF p_kind='Management letter' THEN
  s:=s||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(point_id,title,observation,implication,recommendation,rating,management_response) ORDER BY point_seq)::text FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Included'),'[]');
 END IF;
 RETURN encode(sha256(convert_to(s,'UTF8')),'hex');
END $$;

-- Suggested management-letter points from what the file already records. Each source becomes a point once.
CREATE FUNCTION erp_private.audit_mgmt_points_suggest(p_file uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;n integer:=0;r record;m erp_private.audit_materiality;seq integer;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status='Archived' THEN RAISE EXCEPTION 'The audit file is archived' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM erp_private.audit_materiality WHERE audit_file_id=p_file AND status='Approved';
 FOR r IN
  SELECT 'Misstatement' k,a2.adjustment_id sid,'Uncorrected misstatement '||a2.adj_ref title,a2.description obs,
    'Profit before tax would be '||CASE WHEN e.profit_effect>=0 THEN 'higher' ELSE 'lower' END||' by '||abs(e.profit_effect)::text||' if corrected.' imp,
    'Correct the item in the books, or record why management accepts it.' rec,
    CASE WHEN m.materiality_id IS NOT NULL AND abs(e.profit_effect)>=m.performance_amount THEN 'High' ELSE 'Medium' END rating,a2.management_response resp
   FROM erp_private.audit_adjustments a2 CROSS JOIN LATERAL erp_private.audit_entry_effects(a2.adjustment_id) e
   WHERE a2.audit_file_id=p_file AND a2.kind='Unadjusted' AND a2.status='Approved' AND NOT(m.materiality_id IS NOT NULL AND greatest(abs(e.profit_effect),abs(e.net_assets_effect))<=m.trivial_amount)
  UNION ALL
  SELECT 'Adjustment',a2.adjustment_id,'Error corrected by audit adjustment '||a2.adj_ref,a2.description,
    'The draft accounts were changed by '||abs(e.profit_effect)::text||' on profit before tax.','Strengthen the year-end review so that this is found before the audit.',
    CASE WHEN m.materiality_id IS NOT NULL AND abs(e.profit_effect)>=m.performance_amount THEN 'Medium' ELSE 'Low' END,''
   FROM erp_private.audit_adjustments a2 CROSS JOIN LATERAL erp_private.audit_entry_effects(a2.adjustment_id) e WHERE a2.audit_file_id=p_file AND a2.kind='Adjusting' AND a2.status='Approved'
  UNION ALL
  SELECT 'Lead schedule',(x->'lead'->>'audit_workpaper_id')::uuid,'Reconciling difference in '||(x->>'audit_area'),
    'The balance supported by evidence differs from the ledger by '||(x->'lead'->>'difference')||'. '||(x->'lead'->>'reconciling_note'),'The balance in the books was not fully supported by evidence.','Management should clear or correct the difference in the records.','Medium',''
   FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(p_file)) x WHERE x->'lead'->>'tie'='Reconciled with note'
  UNION ALL
  SELECT 'Workpaper deviation',w.audit_workpaper_id,'Deviation noted in '||w.workpaper_ref||' ('||w.audit_area||')',w.deviations,'The control or process behind it may not work as intended.','Management should consider the control or process behind the deviation.','Medium',''
   FROM erp_private.audit_workpapers w WHERE w.audit_file_id=p_file AND length(btrim(w.deviations))>=10 AND NOT w.is_lead
 LOOP
  IF EXISTS(SELECT 1 FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND source_kind=r.k AND source_id=r.sid) THEN CONTINUE; END IF;
  SELECT COALESCE(max(point_seq),0)+1 INTO seq FROM erp_private.audit_management_points WHERE audit_file_id=p_file;
  INSERT INTO erp_private.audit_management_points(audit_file_id,project_id,handling_firm_id,point_seq,point_ref,title,observation,implication,recommendation,rating,management_response,source_kind,source_id,created_by)
   VALUES(p_file,f.project_id,f.handling_firm_id,seq,'MP-'||lpad(seq::text,3,'0'),left(r.title,200),left(r.obs,2000),left(r.imp,1000),r.rec,r.rating,COALESCE(r.resp,''),r.k,r.sid,a.staff_id);
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

CREATE FUNCTION erp_private.audit_mgmt_point_save(p_file uuid,p_point uuid,p_title text,p_obs text,p_implication text,p_recommendation text,p_rating text,p_response text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;seq integer;id uuid;pt erp_private.audit_management_points;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to new management points' USING ERRCODE='23514'; END IF;
 IF p_rating NOT IN('Low','Medium','High') THEN RAISE EXCEPTION 'Choose a rating' USING ERRCODE='22023'; END IF;
 IF p_point IS NULL THEN
  SELECT COALESCE(max(point_seq),0)+1 INTO seq FROM erp_private.audit_management_points WHERE audit_file_id=p_file;
  INSERT INTO erp_private.audit_management_points(audit_file_id,project_id,handling_firm_id,point_seq,point_ref,title,observation,implication,recommendation,rating,management_response,created_by)
   VALUES(p_file,f.project_id,f.handling_firm_id,seq,'MP-'||lpad(seq::text,3,'0'),btrim(p_title),btrim(p_obs),btrim(COALESCE(p_implication,'')),btrim(COALESCE(p_recommendation,'')),p_rating,btrim(COALESCE(p_response,'')),a.staff_id) RETURNING point_id INTO id;
  RETURN id;
 END IF;
 SELECT * INTO pt FROM erp_private.audit_management_points WHERE point_id=p_point AND audit_file_id=p_file FOR UPDATE;
 IF pt.point_id IS NULL THEN RAISE EXCEPTION 'Point unavailable' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.audit_management_points SET title=btrim(p_title),observation=btrim(p_obs),implication=btrim(COALESCE(p_implication,'')),recommendation=btrim(COALESCE(p_recommendation,'')),rating=p_rating,management_response=btrim(COALESCE(p_response,'')) WHERE point_id=p_point;
 RETURN p_point;
END $$;

CREATE FUNCTION erp_private.audit_mgmt_point_decide(p_point uuid,p_decision text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;pt erp_private.audit_management_points;st text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner decides which points go in the management letter' USING ERRCODE='42501'; END IF;
 SELECT * INTO pt FROM erp_private.audit_management_points WHERE point_id=p_point AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF pt.point_id IS NULL THEN RAISE EXCEPTION 'Point unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_files WHERE audit_file_id=pt.audit_file_id AND file_status IN('Approved','Completion','Archived')) THEN RAISE EXCEPTION 'The audit file is closed to changes in management points' USING ERRCODE='23514'; END IF;
 st:=CASE p_decision WHEN 'Include' THEN 'Included' WHEN 'Drop' THEN 'Dropped' WHEN 'Reopen' THEN 'Open' ELSE NULL END;
 IF st IS NULL THEN RAISE EXCEPTION 'Choose include, drop or reopen' USING ERRCODE='22023'; END IF;
 IF st='Dropped' AND length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why the point is dropped (at least 10 characters)' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_management_points SET status=st,decision_note=btrim(COALESCE(p_note,'')),decided_by=CASE WHEN st='Open' THEN NULL ELSE a.staff_id END,decided_at=CASE WHEN st='Open' THEN NULL ELSE now() END WHERE point_id=p_point;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Builds the body of a report. No caller check: used by the checked draft function.
CREATE FUNCTION erp_private.audit_report_build(p_file uuid,p_kind text,p_params jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;c erp_private.clients;fm erp_private.firms;m erp_private.audit_materiality;ms jsonb;res jsonb;flagged jsonb:='[]'::jsonb;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 SELECT * INTO c FROM erp_private.clients WHERE client_id=f.client_id;
 SELECT * INTO fm FROM erp_private.firms WHERE firm_id=f.handling_firm_id;
 SELECT * INTO m FROM erp_private.audit_materiality WHERE audit_file_id=p_file AND status='Approved';
 ms:=erp_private.audit_misstatement_calc(p_file);
 IF p_kind='Financial statements' THEN
  RETURN erp_private.audit_fs_calc(p_file)||jsonb_build_object('entity',c.company_name);
 ELSIF p_kind='Management letter' THEN
  RETURN jsonb_build_object('entity',c.company_name,'firm',fm.legal_name,'period_end',f.ends_on,'addressee',COALESCE(NULLIF(btrim(p_params->>'addressee'),''),'The Directors, '||c.company_name),
   'introduction','We have completed our audit of the financial statements of '||c.company_name||' for the period ended '||f.ends_on::text||'. This letter sets out matters that came to our attention during the audit and our recommendations. It is not a complete list of every weakness in your systems.',
   'points',COALESCE((SELECT jsonb_agg(jsonb_build_object('ref',point_ref,'title',title,'observation',observation,'implication',implication,'recommendation',recommendation,'rating',rating,'management_response',management_response) ORDER BY CASE rating WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,point_seq) FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Included'),'[]'::jsonb));
 ELSIF p_kind='Representation letter' THEN
  RETURN jsonb_build_object('entity',c.company_name,'firm',fm.legal_name,'framework',f.reporting_framework,'period_end',f.ends_on,
   'addressee',COALESCE(NULLIF(btrim(p_params->>'addressee'),''),fm.legal_name),'signatory_name',btrim(p_params->>'signatory_name'),'signatory_title',btrim(p_params->>'signatory_title'),'letter_date',p_params->>'letter_date',
   'paragraphs',jsonb_build_array(
    'We confirm that we have fulfilled our responsibility for the preparation of the financial statements of '||c.company_name||' for the period ended '||f.ends_on::text||' in accordance with '||f.reporting_framework||', and that the statements give a true and fair view.',
    'We have given you all the information and access you asked for, and all transactions have been recorded and are reflected in the financial statements.',
    'We have told you about all known or suspected fraud involving management, employees with significant roles in internal control, or others where fraud could have a material effect on the statements, and about any allegations of fraud.',
    'We have told you about all identified or suspected non-compliance with laws and regulations whose effects should be considered when preparing the financial statements.',
    'We have told you the identity of related parties and all related-party relationships and transactions of which we are aware, and they are properly accounted for and disclosed.',
    'All events after the date of the financial statements that need adjustment or disclosure have been adjusted or disclosed.',
    'We have assessed the entity''s ability to continue as a going concern and have told you of everything relevant to that assessment.',
    CASE WHEN jsonb_array_length(ms->'items')=0 THEN 'We are not aware of any uncorrected misstatements.'
     ELSE 'The effects of the uncorrected misstatements listed below are, individually and in total, immaterial to the financial statements as a whole.' END),
   'uncorrected_misstatements',COALESCE((SELECT jsonb_agg(jsonb_build_object('ref',i->>'adj_ref','description',i->>'description','profit_effect',i->'profit_effect')) FROM jsonb_array_elements(ms->'items') i WHERE i->>'status'='Approved' AND NOT (i->>'trivial')::boolean),'[]'::jsonb),
   'accumulated_profit_effect',ms->'gross_profit_effect');
 ELSIF p_kind='Completion memorandum' THEN
  SELECT jsonb_agg(jsonb_build_object('ref',r.risk_ref,'description',r.description,'level',r.risk_level,'status',r.status,'covered',EXISTS(SELECT 1 FROM erp_private.audit_workpaper_risks l WHERE l.risk_id=r.risk_id AND l.unlinked_at IS NULL)) ORDER BY r.risk_seq) INTO res FROM erp_private.audit_risks r WHERE r.audit_file_id=p_file;
  flagged:=COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT 'Open risk '||r.risk_ref||': '||left(r.description,120) x FROM erp_private.audit_risks r WHERE r.audit_file_id=p_file AND r.status='Open' AND r.risk_level='High'
    UNION ALL SELECT 'Workpaper '||w.workpaper_ref||' records deviations: '||left(w.deviations,120) FROM erp_private.audit_workpapers w WHERE w.audit_file_id=p_file AND length(btrim(w.deviations))>=10 AND NOT w.is_lead
    UNION ALL SELECT 'Lead schedule for '||(e->>'audit_area')||' reconciled with a note: '||left(e->'lead'->>'reconciling_note',120) FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(p_file)) e WHERE e->'lead'->>'tie'='Reconciled with note'
    UNION ALL SELECT 'Completion item not reviewed: '||label FROM erp_private.audit_completion_items WHERE audit_file_id=p_file AND status<>'Reviewed' AND item_key IN('going-concern','subsequent-events','unadjusted','overall-conclusion')
    UNION ALL SELECT 'Unadjusted misstatements accumulate to '||(ms->>'gross_profit_effect')||(CASE WHEN (ms->>'exceeds_overall')::boolean THEN ', above overall materiality' WHEN (ms->>'exceeds_performance')::boolean THEN ', above performance materiality' ELSE '' END)||'.' WHERE (ms->>'gross_profit_effect')::numeric<>0
   ) q),'[]'::jsonb);
  RETURN jsonb_build_object('entity',c.company_name,'firm',fm.legal_name,'framework',f.reporting_framework,'period_start',f.starts_on,'period_end',f.ends_on,'file_type',f.file_type,
   'materiality',CASE WHEN m.materiality_id IS NULL THEN NULL ELSE jsonb_build_object('benchmark',m.benchmark,'base_amount',m.base_amount,'overall',m.overall_amount,'performance',m.performance_amount,'trivial',m.trivial_amount,'rationale',m.rationale) END,
   'risks',COALESCE(res,'[]'::jsonb),
   'workpapers',(SELECT COALESCE(jsonb_object_agg(status,n),'{}'::jsonb) FROM (SELECT status,count(*)::int n FROM erp_private.audit_workpapers WHERE audit_file_id=p_file GROUP BY status) s),
   'audit_adjustments',jsonb_build_object('approved',(SELECT count(*)::int FROM erp_private.audit_adjustments WHERE audit_file_id=p_file AND kind='Adjusting' AND status='Approved'),
     'net_profit_effect',(SELECT COALESCE(sum(e.profit_effect),0) FROM erp_private.audit_adjustments a2 CROSS JOIN LATERAL erp_private.audit_entry_effects(a2.adjustment_id) e WHERE a2.audit_file_id=p_file AND a2.kind='Adjusting' AND a2.status='Approved')),
   'misstatements',jsonb_build_object('accumulated',ms->'gross_profit_effect','exceeds_overall',ms->'exceeds_overall','exceeds_performance',ms->'exceeds_performance','conclusion',ms->'conclusion'),
   'lead_schedules',(SELECT COALESCE(jsonb_agg(jsonb_build_object('area',e->>'audit_area','adjusted_balance',e->'adjusted_net','status',e->'lead'->>'status','tie',e->'lead'->>'tie')),'[]'::jsonb) FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(p_file)) e WHERE (e->>'active')::boolean),
   'completion_items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('key',item_key,'label',label,'status',status,'note',note) ORDER BY item_key),'[]'::jsonb) FROM erp_private.audit_completion_items WHERE audit_file_id=p_file),
   'flagged_matters',flagged,'overall_conclusion',btrim(COALESCE(p_params->>'overall_conclusion','')));
 END IF;
 RAISE EXCEPTION 'Unknown report' USING ERRCODE='22023';
END $$;

CREATE FUNCTION erp_private.audit_report_draft(p_file uuid,p_kind text,p_params jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;body jsonb;v integer;id uuid;prm jsonb:=COALESCE(p_params,'{}'::jsonb);
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to new report versions' USING ERRCODE='23514'; END IF;
 IF p_kind NOT IN('Financial statements','Management letter','Representation letter','Completion memorandum') THEN RAISE EXCEPTION 'Choose a report' USING ERRCODE='22023'; END IF;
 IF p_kind='Representation letter' AND (length(btrim(COALESCE(prm->>'signatory_name','')))<3 OR length(btrim(COALESCE(prm->>'signatory_title','')))<3) THEN RAISE EXCEPTION 'Enter the name and title of the person signing for management' USING ERRCODE='23514'; END IF;
 IF p_kind='Management letter' AND EXISTS(SELECT 1 FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Open') THEN RAISE EXCEPTION 'Decide every management-letter point (include or drop) before drafting the letter' USING ERRCODE='23514'; END IF;
 IF p_kind='Financial statements' AND NOT EXISTS(SELECT 1 FROM erp_private.audit_tb_imports WHERE audit_file_id=p_file AND period_kind='Current' AND status='Confirmed') THEN RAISE EXCEPTION 'Confirm the current-year trial balance first' USING ERRCODE='23514'; END IF;
 body:=erp_private.audit_report_build(p_file,p_kind,prm);
 UPDATE erp_private.audit_reports SET status='Superseded' WHERE audit_file_id=p_file AND kind=p_kind AND status IN('Draft','Returned');
 SELECT COALESCE(max(version_number),0)+1 INTO v FROM erp_private.audit_reports WHERE audit_file_id=p_file AND kind=p_kind;
 INSERT INTO erp_private.audit_reports(audit_file_id,project_id,handling_firm_id,kind,version_number,params,body,body_sha256,basis_sha256,prepared_by)
  VALUES(p_file,f.project_id,f.handling_firm_id,p_kind,v,prm,body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),erp_private.audit_report_basis(p_file,p_kind),a.staff_id) RETURNING report_id INTO id;
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_report_submit(p_report uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.audit_reports;cid uuid;s record;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO r FROM erp_private.audit_reports WHERE report_id=p_report AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF r.report_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Report unavailable' USING ERRCODE='42501'; END IF;
 IF r.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned report can be submitted' USING ERRCODE='23514'; END IF;
 IF r.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can submit this report' USING ERRCODE='42501'; END IF;
 IF r.basis_sha256<>erp_private.audit_report_basis(r.audit_file_id,r.kind) THEN RAISE EXCEPTION 'The figures behind this report have changed. Draft it again before submitting' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_reports SET status='Submitted',submitted_at=now(),review_note='',reviewer_id=NULL,reviewed_at=NULL WHERE report_id=p_report;
 SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=r.audit_file_id;
 FOR s IN SELECT staff_id FROM erp_private.review_candidates(cid) WHERE staff_id<>a.staff_id AND (category_code='PARTNER' OR r.kind IN('Management letter','Completion memorandum')) LOOP
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(s.staff_id,'Audit report waiting for review: '||r.kind||' version '||r.version_number,'audit-report:'||p_report::text) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $$;

-- The financial statements and the representation letter are decided by a Partner. The management letter and completion memorandum by a Manager or Partner.
CREATE FUNCTION erp_private.audit_report_review(p_report uuid,p_decision text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.audit_reports;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner reviews audit reports' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM erp_private.audit_reports WHERE report_id=p_report AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF r.report_id IS NULL THEN RAISE EXCEPTION 'Report unavailable' USING ERRCODE='42501'; END IF;
 IF r.kind IN('Financial statements','Representation letter') AND a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner approves the % ',lower(r.kind) USING ERRCODE='42501'; END IF;
 IF r.status<>'Submitted' THEN RAISE EXCEPTION 'Only a submitted report can be reviewed' USING ERRCODE='23514'; END IF;
 IF r.prepared_by=a.staff_id THEN RAISE EXCEPTION 'You cannot review a report you prepared' USING ERRCODE='42501'; END IF;
 IF p_decision NOT IN('Approve','Return') THEN RAISE EXCEPTION 'Choose approve or return' USING ERRCODE='22023'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record a review note of at least 10 characters' USING ERRCODE='23514'; END IF;
 IF p_decision='Approve' THEN
  IF r.basis_sha256<>erp_private.audit_report_basis(r.audit_file_id,r.kind) THEN RAISE EXCEPTION 'The figures behind this report have changed. Return it so it can be drafted again' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.audit_reports SET status='Superseded' WHERE audit_file_id=r.audit_file_id AND kind=r.kind AND status='Approved';
  UPDATE erp_private.audit_reports SET status='Approved',reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(p_note) WHERE report_id=p_report;
 ELSE
  UPDATE erp_private.audit_reports SET status='Returned',reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(p_note) WHERE report_id=p_report;
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.prepared_by,'Your '||lower(r.kind)||' was returned: '||left(btrim(p_note),150),'audit-report-return:'||p_report::text) ON CONFLICT DO NOTHING;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Status of each report kind for the file, as the workspace shows it and as the approval gate reads it.
CREATE FUNCTION erp_private.audit_report_status_calc(p_file uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',k,'required',CASE WHEN k='Management letter' THEN EXISTS(SELECT 1 FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Included') ELSE true END,
   'approved_report_id',ar.report_id,'approved_version',ar.version_number,'current',ar.report_id IS NOT NULL AND ar.basis_sha256=erp_private.audit_report_basis(p_file,k),
   'open_points',CASE WHEN k='Management letter' THEN (SELECT count(*)::int FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Open') END) ORDER BY ord),'[]'::jsonb)
 FROM (VALUES(1,'Financial statements'),(2,'Management letter'),(3,'Representation letter'),(4,'Completion memorandum')) v(ord,k)
 LEFT JOIN LATERAL (SELECT r.report_id,r.version_number,r.basis_sha256 FROM erp_private.audit_reports r WHERE r.audit_file_id=p_file AND r.kind=v.k AND r.status='Approved' ORDER BY r.version_number DESC LIMIT 1) ar ON true;
$$;
CREATE FUNCTION erp_private.audit_report_status(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN '[]'::jsonb; END IF;
 RETURN erp_private.audit_report_status_calc(p_file);
END $$;

-- What each kind of report would be built on now, for the workspace to compare with the saved versions.
CREATE FUNCTION erp_private.audit_report_bases(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('Financial statements',erp_private.audit_report_basis(p_file,'Financial statements'),'Management letter',erp_private.audit_report_basis(p_file,'Management letter'),
  'Representation letter',erp_private.audit_report_basis(p_file,'Representation letter'),'Completion memorandum',erp_private.audit_report_basis(p_file,'Completion memorandum'));
END $$;

-- The audit file cannot be approved until the required reports are approved and still current.
CREATE FUNCTION erp_private.audit_file_report_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE x jsonb;missing text;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status OR NEW.file_status<>'Approved' THEN RETURN NEW; END IF;
 SELECT string_agg(lower(e->>'kind'),', ') INTO missing FROM jsonb_array_elements(erp_private.audit_report_status_calc(NEW.audit_file_id)) e WHERE (e->>'required')::boolean AND NOT COALESCE((e->>'current')::boolean,false);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Approve a current version of: %',missing USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_management_points WHERE audit_file_id=NEW.audit_file_id AND status='Open') THEN RAISE EXCEPTION 'Decide every management-letter point (include or drop) before approving the file' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER report_guard BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_report_guard();

REVOKE ALL ON FUNCTION erp_private.audit_report_guard(),erp_private.audit_fs_calc(uuid),erp_private.audit_report_basis(uuid,text),erp_private.audit_report_build(uuid,text,jsonb),erp_private.audit_report_status_calc(uuid),erp_private.audit_file_report_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_mgmt_points_suggest(uuid),erp_private.audit_mgmt_point_save(uuid,uuid,text,text,text,text,text,text),erp_private.audit_mgmt_point_decide(uuid,text,text),erp_private.audit_report_draft(uuid,text,jsonb),erp_private.audit_report_submit(uuid),erp_private.audit_report_review(uuid,text,text),erp_private.audit_report_status(uuid),erp_private.audit_report_bases(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_mgmt_points_suggest(uuid),erp_private.audit_mgmt_point_save(uuid,uuid,text,text,text,text,text,text),erp_private.audit_mgmt_point_decide(uuid,text,text),erp_private.audit_report_draft(uuid,text,jsonb),erp_private.audit_report_submit(uuid),erp_private.audit_report_review(uuid,text,text),erp_private.audit_report_status(uuid),erp_private.audit_report_bases(uuid) TO erp_api;
