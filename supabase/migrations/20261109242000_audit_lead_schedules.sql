-- Audit build C: lead schedules built from the mapped trial balance, with a tie-out check on approval.
-- A lead working paper states the balance it supports. It cannot be approved while that differs from the adjusted trial balance
-- for its audit area, unless a reconciling note explains the difference.
ALTER TABLE erp_private.audit_workpapers
 ADD COLUMN is_lead boolean NOT NULL DEFAULT false,
 ADD COLUMN supported_balance numeric(30,2),
 ADD COLUMN reconciling_note text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX audit_workpapers_one_lead ON erp_private.audit_workpapers(audit_file_id,audit_area) WHERE is_lead;

-- Adjusted trial balance without the caller check, for gates and triggers. The public function below keeps the check.
CREATE FUNCTION erp_private.audit_adjusted_tb_calc(p_file uuid) RETURNS TABLE(audit_account_id uuid,account_code text,account_name text,audit_area text,financial_statement_line text,tb_net numeric,adjustment_net numeric,adjusted_net numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH cur AS (SELECT l.audit_account_id aid,sum(l.source_debit-l.source_credit) net FROM erp_private.audit_tb_lines l JOIN erp_private.audit_tb_imports i ON i.audit_tb_import_id=l.audit_tb_import_id WHERE i.audit_file_id=p_file AND i.period_kind='Current' AND i.status='Confirmed' AND l.audit_account_id IS NOT NULL GROUP BY 1),
 adj AS (SELECT al.audit_account_id aid,sum(al.debit-al.credit) net FROM erp_private.audit_adjustment_lines al JOIN erp_private.audit_adjustments a ON a.adjustment_id=al.adjustment_id WHERE a.audit_file_id=p_file AND a.kind='Adjusting' AND a.status='Approved' GROUP BY 1)
 SELECT m.audit_account_id,m.legacy_account_code,m.legacy_account_name,m.audit_area,m.financial_statement_line,COALESCE(cur.net,0),COALESCE(adj.net,0),COALESCE(cur.net,0)+COALESCE(adj.net,0)
 FROM erp_private.audit_account_mappings m LEFT JOIN cur ON cur.aid=m.audit_account_id LEFT JOIN adj ON adj.aid=m.audit_account_id
 WHERE cur.aid IS NOT NULL OR adj.aid IS NOT NULL ORDER BY m.legacy_account_code;
$$;
CREATE OR REPLACE FUNCTION erp_private.audit_adjusted_tb(p_file uuid) RETURNS TABLE(audit_account_id uuid,account_code text,account_name text,audit_area text,financial_statement_line text,tb_net numeric,adjustment_net numeric,adjusted_net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN; END IF;
 RETURN QUERY SELECT * FROM erp_private.audit_adjusted_tb_calc(p_file);
END $$;
REVOKE ALL ON FUNCTION erp_private.audit_adjusted_tb_calc(uuid) FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- How a lead working paper stands against its area.
CREATE FUNCTION erp_private.audit_lead_status(p_supported numeric,p_balance numeric,p_note text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_supported IS NULL THEN 'Not stated'
  WHEN round(p_supported,2)=round(p_balance,2) THEN 'Ties'
  WHEN length(btrim(COALESCE(p_note,'')))>=20 THEN 'Reconciled with note'
  ELSE 'Difference' END;
$$;

CREATE FUNCTION erp_private.audit_lead_schedule_calc(p_file uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH t AS (SELECT * FROM erp_private.audit_adjusted_tb_calc(p_file) WHERE audit_area IS NOT NULL),
 a AS (SELECT audit_area,round(sum(tb_net),2) tb_net,round(sum(adjustment_net),2) adjustment_net,round(sum(adjusted_net),2) adjusted_net,count(*)::int accounts,
   bool_or(tb_net<>0 OR adjustment_net<>0) active,
   jsonb_agg(jsonb_build_object('account_code',account_code,'account_name',account_name,'financial_statement_line',financial_statement_line,'tb_net',round(tb_net,2),'adjustment_net',round(adjustment_net,2),'adjusted_net',round(adjusted_net,2)) ORDER BY account_code) detail
  FROM t GROUP BY audit_area)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('audit_area',a.audit_area,'accounts',a.accounts,'tb_net',a.tb_net,'adjustment_net',a.adjustment_net,'adjusted_net',a.adjusted_net,'active',a.active,'detail',a.detail,
   'lead',CASE WHEN w.audit_workpaper_id IS NULL THEN NULL ELSE jsonb_build_object('audit_workpaper_id',w.audit_workpaper_id,'workpaper_ref',w.workpaper_ref,'status',w.status,'supported_balance',w.supported_balance,'reconciling_note',w.reconciling_note,'revision',w.revision,
     'tie',erp_private.audit_lead_status(w.supported_balance,a.adjusted_net,w.reconciling_note),'difference',CASE WHEN w.supported_balance IS NULL THEN NULL ELSE round(w.supported_balance-a.adjusted_net,2) END) END) ORDER BY a.audit_area),'[]'::jsonb)
 FROM a LEFT JOIN erp_private.audit_workpapers w ON w.audit_file_id=p_file AND w.audit_area=a.audit_area AND w.is_lead;
$$;
CREATE FUNCTION erp_private.audit_lead_schedule(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN '[]'::jsonb; END IF;
 RETURN erp_private.audit_lead_schedule_calc(p_file);
END $$;

CREATE FUNCTION erp_private.audit_lead_create(p_file uuid,p_area text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;id uuid;n integer;bal jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed' USING ERRCODE='23514'; END IF;
 SELECT x INTO bal FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(p_file)) x WHERE x->>'audit_area'=p_area;
 IF bal IS NULL THEN RAISE EXCEPTION 'No mapped trial-balance accounts belong to %',p_area USING ERRCODE='22023'; END IF;
 IF bal->'lead' IS NOT NULL AND bal->'lead'<>'null'::jsonb THEN RETURN (bal->'lead'->>'audit_workpaper_id')::uuid; END IF;
 SELECT count(*)+1 INTO n FROM erp_private.audit_workpapers WHERE audit_file_id=p_file AND is_lead;
 INSERT INTO erp_private.audit_workpapers(audit_file_id,project_id,handling_firm_id,workpaper_ref,audit_area,objective,assertion,linked_risk,standard_reference,planned_procedure,responsible_staff_id,prepared_by,is_lead)
  VALUES(p_file,f.project_id,f.handling_firm_id,'LS-'||lpad(n::text,2,'0'),p_area,
   'Agree the '||p_area||' balance in the financial statements to the adjusted trial balance and support it with audit evidence.',
   'Existence, completeness, accuracy and presentation','See the risk register for risks in this area','ISA 500, ISA 230',
   'Agree the adjusted trial balance for '||p_area||' to the lead schedule, state the balance supported by your evidence, and explain any difference.',a.staff_id,a.staff_id,true)
  RETURNING audit_workpaper_id INTO id;
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_lead_tieout_save(p_workpaper uuid,p_supported numeric,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;w erp_private.audit_workpapers;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO w FROM erp_private.audit_workpapers WHERE audit_workpaper_id=p_workpaper AND is_lead AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF w.audit_workpaper_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Lead schedule unavailable' USING ERRCODE='42501'; END IF;
 IF w.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'The tie-out can only change while the working paper is a draft or returned' USING ERRCODE='23514'; END IF;
 IF w.prepared_by<>a.staff_id AND a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Supervisor or above can record the tie-out' USING ERRCODE='42501'; END IF;
 IF p_supported IS NULL THEN RAISE EXCEPTION 'Enter the balance your evidence supports' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_workpapers SET supported_balance=round(p_supported,2),reconciling_note=btrim(COALESCE(p_note,'')) WHERE audit_workpaper_id=p_workpaper;
 RETURN jsonb_build_object('ok',true);
END $$;

-- A lead working paper cannot be approved while it does not tie.
CREATE FUNCTION erp_private.audit_lead_approval_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE x jsonb;st text;
BEGIN
 IF NOT NEW.is_lead OR NEW.status<>'Approved' OR OLD.status='Approved' THEN RETURN NEW; END IF;
 SELECT e INTO x FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(NEW.audit_file_id)) e WHERE e->>'audit_area'=NEW.audit_area;
 IF x IS NULL THEN RETURN NEW; END IF;
 st:=erp_private.audit_lead_status(NEW.supported_balance,(x->>'adjusted_net')::numeric,NEW.reconciling_note);
 IF st='Not stated' THEN RAISE EXCEPTION 'Record the balance this lead schedule supports before it can be approved' USING ERRCODE='23514'; END IF;
 IF st='Difference' THEN RAISE EXCEPTION 'The balance supported (%) differs from the adjusted trial balance (%). Record a reconciling note of at least 20 characters',NEW.supported_balance,(x->>'adjusted_net')::numeric USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_approval_guard BEFORE UPDATE OF status ON erp_private.audit_workpapers FOR EACH ROW EXECUTE FUNCTION erp_private.audit_lead_approval_guard();
-- Lead working paper fields cannot change once submitted.
CREATE FUNCTION erp_private.audit_lead_lock_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status IN('Submitted','Approved') AND (NEW.supported_balance IS DISTINCT FROM OLD.supported_balance OR NEW.reconciling_note IS DISTINCT FROM OLD.reconciling_note OR NEW.is_lead IS DISTINCT FROM OLD.is_lead) THEN
  RAISE EXCEPTION 'The tie-out cannot change after the working paper is submitted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_lock_guard BEFORE UPDATE ON erp_private.audit_workpapers FOR EACH ROW EXECUTE FUNCTION erp_private.audit_lead_lock_guard();

-- File gates: every active area needs a lead schedule before review, and every lead schedule must still tie at approval.
CREATE FUNCTION erp_private.audit_file_lead_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE missing text;bad text;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status OR NEW.file_status NOT IN('In Review','Approved') THEN RETURN NEW; END IF;
 SELECT string_agg(e->>'audit_area',', ' ORDER BY e->>'audit_area') INTO missing FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(NEW.audit_file_id)) e WHERE (e->>'active')::boolean AND (e->'lead' IS NULL OR e->'lead'='null'::jsonb);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Create a lead schedule for each trial-balance area. Missing: %',missing USING ERRCODE='23514'; END IF;
 IF NEW.file_status='Approved' THEN
  SELECT string_agg(e->>'audit_area',', ' ORDER BY e->>'audit_area') INTO bad FROM jsonb_array_elements(erp_private.audit_lead_schedule_calc(NEW.audit_file_id)) e WHERE e->'lead' IS NOT NULL AND e->'lead'<>'null'::jsonb AND e->'lead'->>'tie' IN ('Not stated','Difference');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'These lead schedules no longer tie to the adjusted trial balance: %',bad USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_guard BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_lead_guard();

REVOKE ALL ON FUNCTION erp_private.audit_lead_status(numeric,numeric,text),erp_private.audit_lead_schedule_calc(uuid),erp_private.audit_lead_approval_guard(),erp_private.audit_lead_lock_guard(),erp_private.audit_file_lead_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_lead_schedule(uuid),erp_private.audit_lead_create(uuid,text),erp_private.audit_lead_tieout_save(uuid,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_lead_schedule(uuid),erp_private.audit_lead_create(uuid,text),erp_private.audit_lead_tieout_save(uuid,numeric,text) TO erp_api;
