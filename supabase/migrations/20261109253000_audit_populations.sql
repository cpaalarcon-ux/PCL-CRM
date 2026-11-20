-- Audit build S5: populations and reconciliations.
-- A population is the listing the audit tests are drawn from (a loan ledger, a deposit ledger, an inventory listing and so on).
-- The file records where it came from, which report and parameters produced it, when, who prepared it, how many rows it has and its control total.
-- The control total is reconciled live to the adjusted trial balance of its audit area. A population that does not reconcile blocks the lead
-- schedule of that area and the approval of the audit file. The rows themselves are not stored here; only the summary and the evidence file.

-- ---- Firm policy: which areas must have a population ------------------------------------------------------------------------------
-- Starts empty (no area required). A Partner lists the areas. Areas are separated by a vertical bar because some names contain commas.
INSERT INTO erp_private.system_settings(key,value,note) VALUES
 ('AUDIT_POPULATION_AREAS','','Default: no audit area is required to have a population. A Partner lists the areas that must have an approved, reconciled population.')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION erp_private.audit_population_required(p_file uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT string_to_array(NULLIF(btrim(value),''),'|') FROM erp_private.system_settings WHERE key='AUDIT_POPULATION_AREAS'),ARRAY[]::text[]);
$$;

CREATE FUNCTION erp_private.audit_population_policy() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;s record;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RETURN NULL; END IF;
 SELECT st.value,st.note,st.updated_by,st.updated_at,m.full_name INTO s FROM erp_private.system_settings st LEFT JOIN erp_private.staff_members m ON m.staff_id=st.updated_by WHERE st.key='AUDIT_POPULATION_AREAS';
 RETURN jsonb_build_object('areas',to_jsonb(COALESCE(string_to_array(NULLIF(btrim(s.value),''),'|'),ARRAY[]::text[])),'confirmed',s.updated_by IS NOT NULL,'note',s.note,'confirmed_by_name',s.full_name,'updated_at',s.updated_at);
END $$;

CREATE FUNCTION erp_private.audit_population_policy_save(p_areas text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;known text[]:=ARRAY['Cash and bank','Trade receivables','Inventories','Property, plant and equipment','Trade payables','Borrowings','Taxation','Revenue','Payroll and expenses','Equity','Commitments and contingencies'];
 item text;chosen text[]:=ARRAY[]::text[];
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can set which audit areas need a population' USING ERRCODE='42501'; END IF;
 FOR item IN SELECT btrim(v) FROM unnest(string_to_array(COALESCE(p_areas,''),'|')) v WHERE btrim(v)<>'' LOOP
  IF NOT (item=ANY(known)) THEN RAISE EXCEPTION 'Unknown audit area: %',item USING ERRCODE='22023'; END IF;
  IF NOT (item=ANY(chosen)) THEN chosen:=array_append(chosen,item); END IF;
 END LOOP;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.system_settings SET value=array_to_string(chosen,'|'),note=btrim(p_note),updated_by=a.staff_id WHERE key='AUDIT_POPULATION_AREAS';
 RETURN jsonb_build_object('ok',true);
END $$;

-- ---- The register ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.audit_populations (
 population_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 pop_seq integer NOT NULL CHECK(pop_seq>0),
 pop_ref text NOT NULL,
 audit_area text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title))>=5),
 source_system text NOT NULL CHECK(length(btrim(source_system))>=3),
 report_name text NOT NULL CHECK(length(btrim(report_name))>=3),
 parameters text NOT NULL CHECK(length(btrim(parameters))>=3),
 as_at date NOT NULL,
 report_run_on date NOT NULL,
 row_count integer NOT NULL CHECK(row_count>=0),
 control_total numeric(30,2) NOT NULL CHECK(control_total>=0),
 balance_nature text NOT NULL CHECK(balance_nature IN('Debit','Credit')),
 reconciling_amount numeric(30,2) NOT NULL DEFAULT 0,
 reconciling_note text NOT NULL DEFAULT '',
 ipe_check text NOT NULL DEFAULT '',
 evidence_document_id uuid,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Submitted','Returned','Approved','Withdrawn')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 submitted_at timestamptz,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 FOREIGN KEY(evidence_document_id,project_id) REFERENCES erp_private.documents(document_id,project_id),
 UNIQUE(audit_file_id,pop_seq),
 UNIQUE(audit_file_id,pop_ref),
 CHECK(report_run_on>=as_at),
 CHECK(status NOT IN('Submitted','Approved') OR submitted_at IS NOT NULL),
 CHECK(status<>'Approved' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by AND length(btrim(review_note))>=10))
);
-- One live population per audit area on a file.
CREATE UNIQUE INDEX audit_populations_one_live ON erp_private.audit_populations(audit_file_id,audit_area) WHERE status<>'Withdrawn';
CREATE INDEX audit_populations_prepared_idx ON erp_private.audit_populations(prepared_by);
CREATE INDEX audit_populations_reviewer_idx ON erp_private.audit_populations(reviewer_id);
CREATE INDEX audit_populations_evidence_idx ON erp_private.audit_populations(evidence_document_id,project_id);
CREATE INDEX audit_populations_project_idx ON erp_private.audit_populations(project_id,audit_file_id,handling_firm_id);

ALTER TABLE erp_private.audit_populations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.audit_populations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.audit_populations TO erp_api;
CREATE POLICY audit_populations_read ON erp_private.audit_populations FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.audit_populations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.audit_populations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_populations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('population_id');

-- An approved population changes only when it is reopened (Approved to Returned with the data untouched). A withdrawn one never changes.
CREATE FUNCTION erp_private.audit_population_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status='Withdrawn' THEN RAISE EXCEPTION 'A withdrawn population cannot be changed' USING ERRCODE='23514'; END IF;
 IF NEW.audit_file_id<>OLD.audit_file_id OR NEW.pop_ref<>OLD.pop_ref OR NEW.prepared_by<>OLD.prepared_by THEN RAISE EXCEPTION 'The file, reference and preparer of a population cannot change' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('Submitted','Approved') AND NEW.status IN('Submitted','Approved','Returned') AND
    ROW(NEW.audit_area,NEW.title,NEW.source_system,NEW.report_name,NEW.parameters,NEW.as_at,NEW.report_run_on,NEW.row_count,NEW.control_total,NEW.balance_nature,NEW.reconciling_amount,NEW.reconciling_note,NEW.ipe_check,NEW.evidence_document_id)
    IS DISTINCT FROM ROW(OLD.audit_area,OLD.title,OLD.source_system,OLD.report_name,OLD.parameters,OLD.as_at,OLD.report_run_on,OLD.row_count,OLD.control_total,OLD.balance_nature,OLD.reconciling_amount,OLD.reconciling_note,OLD.ipe_check,OLD.evidence_document_id) THEN
  RAISE EXCEPTION 'A submitted or approved population cannot be edited. Return or reopen it first' USING ERRCODE='23514'; END IF;
 IF OLD.status='Approved' AND NEW.status NOT IN('Approved','Returned') THEN RAISE EXCEPTION 'An approved population can only be reopened' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER population_guard BEFORE UPDATE ON erp_private.audit_populations FOR EACH ROW EXECUTE FUNCTION erp_private.audit_population_guard();

-- ---- The live reconciliation --------------------------------------------------------------------------------------------------------
-- The balance of the area is the adjusted trial balance (debit positive). A credit-nature population is compared with the balance turned over.
-- control total + reconciling items must equal that balance. Reconciling items need a note of at least 20 characters.
CREATE FUNCTION erp_private.audit_population_calc(p_file uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH l AS (SELECT e->>'audit_area' area,(e->>'adjusted_net')::numeric adj FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(p_file)) e),
 x AS (SELECT p.*,COALESCE((SELECT CASE WHEN p.balance_nature='Credit' THEN -l.adj ELSE l.adj END FROM l WHERE l.area=p.audit_area),0) gl
  FROM erp_private.audit_populations p WHERE p.audit_file_id=p_file),
 y AS (SELECT x.*,round(x.control_total+x.reconciling_amount-x.gl,2) residual FROM x)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('population_id',y.population_id,'pop_ref',y.pop_ref,'pop_seq',y.pop_seq,'audit_area',y.audit_area,'title',y.title,'source_system',y.source_system,'report_name',y.report_name,'parameters',y.parameters,
   'as_at',y.as_at,'report_run_on',y.report_run_on,'row_count',y.row_count,'control_total',y.control_total,'balance_nature',y.balance_nature,'reconciling_amount',y.reconciling_amount,'reconciling_note',y.reconciling_note,
   'ipe_check',y.ipe_check,'evidence_document_id',y.evidence_document_id,'evidence_file_name',(SELECT d.file_name FROM erp_private.documents d WHERE d.document_id=y.evidence_document_id),
   'status',y.status,'prepared_by',y.prepared_by,'prepared_by_name',(SELECT s.full_name FROM erp_private.staff_members s WHERE s.staff_id=y.prepared_by),'submitted_at',y.submitted_at,
   'reviewer_id',y.reviewer_id,'reviewer_name',(SELECT s.full_name FROM erp_private.staff_members s WHERE s.staff_id=y.reviewer_id),'reviewed_at',y.reviewed_at,'review_note',y.review_note,'revision',y.revision,
   'gl_balance',round(y.gl,2),'residual',y.residual,
   'state',CASE WHEN y.status='Withdrawn' THEN 'Withdrawn' WHEN y.residual<>0 THEN 'Difference' WHEN y.reconciling_amount=0 THEN 'Ties'
      WHEN length(btrim(y.reconciling_note))>=20 THEN 'Reconciled with note' ELSE 'Needs note' END) ORDER BY y.pop_seq),'[]'::jsonb)
 FROM y;
$$;

CREATE FUNCTION erp_private.audit_population_list(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code='INTERN' THEN RETURN '[]'::jsonb; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN '[]'::jsonb; END IF;
 RETURN erp_private.audit_population_calc(p_file);
END $$;

-- Plain description of what is wrong with a population, or NULL when it reconciles.
CREATE FUNCTION erp_private.audit_population_problem(p_pop jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE p_pop->>'state'
  WHEN 'Difference' THEN (p_pop->>'pop_ref')||' for '||(p_pop->>'audit_area')||' differs from the adjusted trial balance by '||(p_pop->>'residual')||' after reconciling items'
  WHEN 'Needs note' THEN (p_pop->>'pop_ref')||' for '||(p_pop->>'audit_area')||' has reconciling items without a note of at least 20 characters'
  ELSE NULL END;
$$;

-- ---- Save, submit, review, withdraw, reopen ------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.audit_population_save(p_file uuid,p_population uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;e erp_private.audit_populations;id uuid:=p_population;n integer;
 v_area text;v_title text;v_src text;v_rep text;v_par text;v_asat date;v_run date;v_rows integer;v_total numeric;v_nature text;v_recon numeric;v_note text;v_ipe text;v_doc uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to populations' USING ERRCODE='23514'; END IF;
 BEGIN
  v_area:=btrim(COALESCE(p_data->>'audit_area',''));v_title:=btrim(COALESCE(p_data->>'title',''));v_src:=btrim(COALESCE(p_data->>'source_system',''));
  v_rep:=btrim(COALESCE(p_data->>'report_name',''));v_par:=btrim(COALESCE(p_data->>'parameters',''));
  v_asat:=(p_data->>'as_at')::date;v_run:=(p_data->>'report_run_on')::date;v_rows:=(p_data->>'row_count')::integer;
  v_total:=round(replace(COALESCE(p_data->>'control_total',''),',','')::numeric,2);v_nature:=COALESCE(p_data->>'balance_nature','');
  v_recon:=round(COALESCE(NULLIF(replace(COALESCE(p_data->>'reconciling_amount',''),',',''),''),'0')::numeric,2);
  v_note:=btrim(COALESCE(p_data->>'reconciling_note',''));v_ipe:=btrim(COALESCE(p_data->>'ipe_check',''));v_doc:=NULLIF(p_data->>'evidence_document_id','')::uuid;
 EXCEPTION WHEN others THEN RAISE EXCEPTION 'Check the dates and amounts: they must be real dates and plain numbers' USING ERRCODE='22023'; END;
 IF length(v_title)<5 OR length(v_src)<3 OR length(v_rep)<3 OR length(v_par)<3 THEN RAISE EXCEPTION 'Name the population, its source system, the report used and the parameters it was run with' USING ERRCODE='23514'; END IF;
 IF v_rows IS NULL OR v_rows<0 THEN RAISE EXCEPTION 'Enter the number of rows in the report' USING ERRCODE='23514'; END IF;
 IF v_total IS NULL OR v_total<0 THEN RAISE EXCEPTION 'Enter the control total as a positive amount and choose whether it is a debit or credit balance' USING ERRCODE='23514'; END IF;
 IF v_nature NOT IN('Debit','Credit') THEN RAISE EXCEPTION 'Choose whether the control total is a debit or a credit balance' USING ERRCODE='23514'; END IF;
 IF v_asat IS DISTINCT FROM f.ends_on THEN RAISE EXCEPTION 'The population must be as at the financial year end (%). It is reconciled to the year-end trial balance',f.ends_on USING ERRCODE='23514'; END IF;
 IF v_run IS NULL OR v_run<v_asat OR v_run>current_date THEN RAISE EXCEPTION 'The date the report was run cannot be before the balance date or in the future' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(p_file)) x WHERE x->>'audit_area'=v_area) THEN RAISE EXCEPTION 'No mapped trial-balance accounts belong to %. Import and map the trial balance first',v_area USING ERRCODE='22023'; END IF;
 IF id IS NULL THEN
  SELECT COALESCE(max(pop_seq),0)+1 INTO n FROM erp_private.audit_populations WHERE audit_file_id=p_file;
  IF EXISTS(SELECT 1 FROM erp_private.audit_populations WHERE audit_file_id=p_file AND audit_area=v_area AND status<>'Withdrawn') THEN RAISE EXCEPTION 'There is already a population for %. Edit it, or withdraw it first',v_area USING ERRCODE='23505'; END IF;
  INSERT INTO erp_private.audit_populations(audit_file_id,project_id,handling_firm_id,pop_seq,pop_ref,audit_area,title,source_system,report_name,parameters,as_at,report_run_on,row_count,control_total,balance_nature,reconciling_amount,reconciling_note,ipe_check,evidence_document_id,prepared_by)
   VALUES(p_file,f.project_id,f.handling_firm_id,n,'POP-'||lpad(n::text,3,'0'),v_area,v_title,v_src,v_rep,v_par,v_asat,v_run,v_rows,v_total,v_nature,v_recon,v_note,v_ipe,v_doc,a.staff_id) RETURNING population_id INTO id;
 ELSE
  SELECT * INTO e FROM erp_private.audit_populations WHERE population_id=id AND audit_file_id=p_file FOR UPDATE;
  IF e.population_id IS NULL THEN RAISE EXCEPTION 'Population unavailable' USING ERRCODE='42501'; END IF;
  IF e.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned population can be edited' USING ERRCODE='23514'; END IF;
  IF e.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can edit this population' USING ERRCODE='42501'; END IF;
  IF e.audit_area<>v_area THEN RAISE EXCEPTION 'The audit area of a population cannot change. Withdraw it and record a new one' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.audit_populations SET title=v_title,source_system=v_src,report_name=v_rep,parameters=v_par,as_at=v_asat,report_run_on=v_run,row_count=v_rows,control_total=v_total,balance_nature=v_nature,
   reconciling_amount=v_recon,reconciling_note=v_note,ipe_check=v_ipe,evidence_document_id=v_doc,status='Draft' WHERE population_id=id;
 END IF;
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_population_submit(p_population uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_populations;x jsonb;prob text;cid uuid;r record;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO e FROM erp_private.audit_populations WHERE population_id=p_population AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.population_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Population unavailable' USING ERRCODE='42501'; END IF;
 IF e.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned population can be submitted' USING ERRCODE='23514'; END IF;
 IF e.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can submit this population' USING ERRCODE='42501'; END IF;
 IF length(btrim(e.ipe_check))<20 THEN RAISE EXCEPTION 'Record how you checked that the report is complete and accurate (at least 20 characters)' USING ERRCODE='23514'; END IF;
 SELECT p INTO x FROM jsonb_array_elements(erp_private.audit_population_calc(e.audit_file_id)) p WHERE p->>'population_id'=p_population::text;
 prob:=erp_private.audit_population_problem(x);
 IF prob IS NOT NULL THEN RAISE EXCEPTION '%',prob USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_populations SET status='Submitted',submitted_at=now(),review_note='',reviewer_id=NULL,reviewed_at=NULL WHERE population_id=p_population;
 SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=e.audit_file_id;
 FOR r IN SELECT staff_id FROM erp_private.review_candidates(cid) WHERE staff_id<>a.staff_id LOOP
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.staff_id,'Population '||e.pop_ref||' ('||e.audit_area||') is waiting for review: '||left(e.title,150),'audit-population:'||p_population::text||':'||e.revision::text||':'||r.staff_id::text) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_population_review(p_population uuid,p_decision text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_populations;x jsonb;prob text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner reviews populations' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM erp_private.audit_populations WHERE population_id=p_population AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.population_id IS NULL THEN RAISE EXCEPTION 'Population unavailable' USING ERRCODE='42501'; END IF;
 IF e.status<>'Submitted' THEN RAISE EXCEPTION 'Only a submitted population can be reviewed' USING ERRCODE='23514'; END IF;
 IF e.prepared_by=a.staff_id THEN RAISE EXCEPTION 'You cannot review a population you prepared' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Write a review note of at least 10 characters' USING ERRCODE='23514'; END IF;
 IF p_decision='Approve' THEN
  SELECT p INTO x FROM jsonb_array_elements(erp_private.audit_population_calc(e.audit_file_id)) p WHERE p->>'population_id'=p_population::text;
  prob:=erp_private.audit_population_problem(x);
  IF prob IS NOT NULL THEN RAISE EXCEPTION '%. Return it to the preparer',prob USING ERRCODE='23514'; END IF;
  UPDATE erp_private.audit_populations SET status='Approved',reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(p_note) WHERE population_id=p_population;
 ELSIF p_decision='Return' THEN
  UPDATE erp_private.audit_populations SET status='Returned',reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(p_note) WHERE population_id=p_population;
 ELSE RAISE EXCEPTION 'Choose Approve or Return' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(e.prepared_by,a.full_name||CASE WHEN p_decision='Approve' THEN ' approved ' ELSE ' returned ' END||'population '||e.pop_ref||': '||left(btrim(p_note),200),'audit-population-done:'||p_population::text||':'||e.revision::text) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_population_withdraw(p_population uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_populations;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO e FROM erp_private.audit_populations WHERE population_id=p_population AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.population_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Population unavailable' USING ERRCODE='42501'; END IF;
 IF e.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned population can be withdrawn' USING ERRCODE='23514'; END IF;
 IF e.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can withdraw this population' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why it is withdrawn, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_populations SET status='Withdrawn',review_note=btrim(p_reason) WHERE population_id=p_population;
 RETURN jsonb_build_object('ok',true);
END $$;

-- When the trial balance moves after approval, the preparer needs to update the reconciling items. A Manager or Partner reopens the approved population.
CREATE FUNCTION erp_private.audit_population_reopen(p_population uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_populations;f erp_private.audit_files;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner reopens an approved population' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM erp_private.audit_populations WHERE population_id=p_population AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.population_id IS NULL THEN RAISE EXCEPTION 'Population unavailable' USING ERRCODE='42501'; END IF;
 IF e.status<>'Approved' THEN RAISE EXCEPTION 'Only an approved population can be reopened' USING ERRCODE='23514'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=e.audit_file_id;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why it is reopened, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_populations SET status='Returned',review_note='Reopened: '||btrim(p_reason),reviewer_id=a.staff_id,reviewed_at=now() WHERE population_id=p_population;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(e.prepared_by,a.full_name||' reopened population '||e.pop_ref||': '||left(btrim(p_reason),200),'audit-population-reopen:'||p_population::text||':'||e.revision::text) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true);
END $$;

-- ---- Gates ----------------------------------------------------------------------------------------------------------------------------
-- A lead schedule cannot be approved while its area's population is unapproved or does not reconcile, or when the firm requires one and none exists.
CREATE FUNCTION erp_private.audit_lead_population_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE x jsonb;prob text;has_pop boolean:=false;
BEGIN
 IF NOT NEW.is_lead OR NEW.status<>'Approved' OR OLD.status='Approved' THEN RETURN NEW; END IF;
 FOR x IN SELECT p FROM jsonb_array_elements(erp_private.audit_population_calc(NEW.audit_file_id)) p WHERE p->>'audit_area'=NEW.audit_area AND p->>'status'<>'Withdrawn' LOOP
  has_pop:=true;
  IF x->>'status'<>'Approved' THEN RAISE EXCEPTION 'Population % for % is not approved yet (%). The lead schedule cannot be approved until it is',x->>'pop_ref',NEW.audit_area,lower(x->>'status') USING ERRCODE='23514'; END IF;
  prob:=erp_private.audit_population_problem(x);
  IF prob IS NOT NULL THEN RAISE EXCEPTION '%. The lead schedule cannot be approved until it reconciles',prob USING ERRCODE='23514'; END IF;
 END LOOP;
 IF NOT has_pop AND NEW.audit_area=ANY(erp_private.audit_population_required(NEW.audit_file_id)) THEN
  RAISE EXCEPTION 'The firm requires an approved, reconciled population for %. Record it before approving this lead schedule',NEW.audit_area USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_population_guard BEFORE UPDATE OF status ON erp_private.audit_workpapers FOR EACH ROW EXECUTE FUNCTION erp_private.audit_lead_population_guard();

-- File gates: review needs no draft or returned populations. Approval needs every population decided and reconciling, and every required area covered.
CREATE FUNCTION erp_private.audit_file_population_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE n integer;x jsonb;prob text;req text;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status OR NEW.file_status NOT IN('In Review','Approved') THEN RETURN NEW; END IF;
 SELECT count(*) INTO n FROM erp_private.audit_populations WHERE audit_file_id=NEW.audit_file_id AND status IN('Draft','Returned');
 IF n>0 THEN RAISE EXCEPTION 'Submit or withdraw every draft and returned population first (% open)',n USING ERRCODE='23514'; END IF;
 IF NEW.file_status='Approved' THEN
  SELECT count(*) INTO n FROM erp_private.audit_populations WHERE audit_file_id=NEW.audit_file_id AND status='Submitted';
  IF n>0 THEN RAISE EXCEPTION 'Review every submitted population first (% waiting)',n USING ERRCODE='23514'; END IF;
  FOR x IN SELECT p FROM jsonb_array_elements(erp_private.audit_population_calc(NEW.audit_file_id)) p WHERE p->>'status'='Approved' LOOP
   prob:=erp_private.audit_population_problem(x);
   IF prob IS NOT NULL THEN RAISE EXCEPTION '%. Reopen it and update the reconciling items',prob USING ERRCODE='23514'; END IF;
  END LOOP;
  SELECT string_agg(r,', ' ORDER BY r) INTO req FROM unnest(erp_private.audit_population_required(NEW.audit_file_id)) r
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(NEW.audit_file_id)) e WHERE e->>'audit_area'=r AND (e->>'active')::boolean)
     AND NOT EXISTS(SELECT 1 FROM erp_private.audit_populations p WHERE p.audit_file_id=NEW.audit_file_id AND p.audit_area=r AND p.status='Approved');
  IF req IS NOT NULL THEN RAISE EXCEPTION 'The firm requires an approved population for: %',req USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER population_file_guard BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_population_guard();

REVOKE ALL ON FUNCTION erp_private.audit_population_required(uuid),erp_private.audit_population_calc(uuid),erp_private.audit_population_problem(jsonb),erp_private.audit_population_guard(),erp_private.audit_lead_population_guard(),erp_private.audit_file_population_guard()
 FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_population_policy(),erp_private.audit_population_policy_save(text,text),erp_private.audit_population_list(uuid),erp_private.audit_population_save(uuid,uuid,jsonb),erp_private.audit_population_submit(uuid),
 erp_private.audit_population_review(uuid,text,text),erp_private.audit_population_withdraw(uuid,text),erp_private.audit_population_reopen(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_population_policy(),erp_private.audit_population_policy_save(text,text),erp_private.audit_population_list(uuid),erp_private.audit_population_save(uuid,uuid,jsonb),erp_private.audit_population_submit(uuid),
 erp_private.audit_population_review(uuid,text,text),erp_private.audit_population_withdraw(uuid,text),erp_private.audit_population_reopen(uuid,text) TO erp_api;
