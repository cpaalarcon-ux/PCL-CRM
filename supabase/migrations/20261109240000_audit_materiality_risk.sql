-- Audit build A: materiality with Partner approval, a risk register tied to working papers, and database gates on the audit file.
-- A file cannot be marked Prepared without an approved materiality, and cannot go to review while an open risk has no working paper,
-- or while no fraud risk has been recorded (management override is always a risk, ISA 240).
CREATE TABLE erp_private.audit_materiality (
 materiality_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0),
 benchmark text NOT NULL CHECK(benchmark IN('Revenue','Total assets','Profit before tax','Total expenses','Equity','Other')),
 benchmark_other text NOT NULL DEFAULT '',
 base_amount numeric(20,2) NOT NULL CHECK(base_amount>0),
 overall_pct numeric(7,4) NOT NULL CHECK(overall_pct>0 AND overall_pct<=100),
 performance_pct numeric(7,4) NOT NULL CHECK(performance_pct>0 AND performance_pct<=100),
 trivial_pct numeric(7,4) NOT NULL CHECK(trivial_pct>0 AND trivial_pct<=100),
 overall_amount numeric(20,2) NOT NULL,
 performance_amount numeric(20,2) NOT NULL,
 trivial_amount numeric(20,2) NOT NULL,
 rationale text NOT NULL CHECK(length(btrim(rationale))>=30),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Superseded')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,version_number),
 CHECK(trivial_amount<=performance_amount AND performance_amount<=overall_amount),
 CHECK(benchmark<>'Other' OR length(btrim(benchmark_other))>=3),
 CHECK(status<>'Approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by<>prepared_by))
);
CREATE UNIQUE INDEX audit_materiality_one_approved ON erp_private.audit_materiality(audit_file_id) WHERE status='Approved';

CREATE TABLE erp_private.audit_risks (
 risk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 risk_seq integer NOT NULL CHECK(risk_seq>0),
 risk_ref text NOT NULL,
 description text NOT NULL CHECK(length(btrim(description))>=10),
 audit_area text NOT NULL,
 assertion text NOT NULL CHECK(length(btrim(assertion))>=3),
 risk_level text NOT NULL CHECK(risk_level IN('Low','Medium','High')),
 significant boolean NOT NULL DEFAULT false,
 fraud_risk boolean NOT NULL DEFAULT false,
 planned_response text NOT NULL CHECK(length(btrim(planned_response))>=10),
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Closed')),
 closed_note text NOT NULL DEFAULT '',
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,risk_seq),
 UNIQUE(audit_file_id,risk_ref),
 UNIQUE(risk_id,audit_file_id,project_id,handling_firm_id),
 CHECK(NOT fraud_risk OR significant),
 CHECK(status='Open' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND length(btrim(closed_note))>=10 AND closed_by<>created_by))
);

CREATE TABLE erp_private.audit_workpaper_risks (
 audit_workpaper_id uuid NOT NULL,
 risk_id uuid NOT NULL,
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 linked_by uuid NOT NULL REFERENCES erp_private.staff_members,
 linked_at timestamptz NOT NULL DEFAULT now(),
 unlinked_by uuid REFERENCES erp_private.staff_members,
 unlinked_at timestamptz,
 PRIMARY KEY(audit_workpaper_id,risk_id),
 FOREIGN KEY(audit_workpaper_id,audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_workpapers(audit_workpaper_id,audit_file_id,project_id,handling_firm_id),
 FOREIGN KEY(risk_id,audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_risks(risk_id,audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_workpaper_risks_risk_idx ON erp_private.audit_workpaper_risks(risk_id);
CREATE INDEX audit_materiality_file_idx ON erp_private.audit_materiality(audit_file_id,status);
CREATE INDEX audit_risks_file_idx ON erp_private.audit_risks(audit_file_id,status);

CREATE FUNCTION erp_private.audit_link_update_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.audit_workpaper_id<>OLD.audit_workpaper_id OR NEW.risk_id<>OLD.risk_id OR NEW.audit_file_id<>OLD.audit_file_id THEN RAISE EXCEPTION 'A risk link cannot be moved' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_materiality','audit_risks','audit_workpaper_risks'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
 END LOOP;
END $do$;
CREATE TRIGGER link_guard BEFORE UPDATE ON erp_private.audit_workpaper_risks FOR EACH ROW EXECUTE FUNCTION erp_private.audit_link_update_guard();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.audit_materiality FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.audit_risks FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_materiality FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('materiality_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_risks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('risk_id');

-- Where the file stands on its planning controls. Used by the screen, the API and the database gate below.
CREATE FUNCTION erp_private.audit_planning_gate(p_file uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'materiality_approved',EXISTS(SELECT 1 FROM erp_private.audit_materiality m WHERE m.audit_file_id=p_file AND m.status='Approved'),
  'risks_total',(SELECT count(*) FROM erp_private.audit_risks r WHERE r.audit_file_id=p_file),
  'risks_open',(SELECT count(*) FROM erp_private.audit_risks r WHERE r.audit_file_id=p_file AND r.status='Open'),
  'fraud_risk_recorded',EXISTS(SELECT 1 FROM erp_private.audit_risks r WHERE r.audit_file_id=p_file AND r.fraud_risk AND r.status='Open'),
  'uncovered',COALESCE((SELECT jsonb_agg(r.risk_ref ORDER BY r.risk_seq) FROM erp_private.audit_risks r WHERE r.audit_file_id=p_file AND r.status='Open' AND NOT EXISTS(SELECT 1 FROM erp_private.audit_workpaper_risks l WHERE l.risk_id=r.risk_id AND l.unlinked_at IS NULL)),'[]'::jsonb));
$$;

CREATE FUNCTION erp_private.audit_file_planning_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE g jsonb;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status THEN RETURN NEW; END IF;
 IF NEW.file_status='Prepared' OR NEW.file_status='In Review' THEN
  g:=erp_private.audit_planning_gate(NEW.audit_file_id);
  IF NOT (g->>'materiality_approved')::boolean THEN RAISE EXCEPTION 'The Partner must approve materiality before the file can move on' USING ERRCODE='23514'; END IF;
  IF NEW.file_status='In Review' THEN
   IF (g->>'risks_open')::int=0 THEN RAISE EXCEPTION 'Record the assessed risks before the file goes to review' USING ERRCODE='23514'; END IF;
   IF NOT (g->>'fraud_risk_recorded')::boolean THEN RAISE EXCEPTION 'Record at least one fraud risk (management override of controls) before review' USING ERRCODE='23514'; END IF;
   IF jsonb_array_length(g->'uncovered')>0 THEN RAISE EXCEPTION 'Every open risk needs a working paper. Not covered yet: %',(SELECT string_agg(x,', ') FROM jsonb_array_elements_text(g->'uncovered') x) USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER planning_guard BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_planning_guard();

CREATE FUNCTION erp_private.audit_materiality_save(p_file uuid,p_benchmark text,p_other text,p_base numeric,p_overall numeric,p_performance numeric,p_trivial numeric,p_rationale text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;v integer;ov numeric;pf numeric;tv numeric;id uuid;cl text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner prepares materiality' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to planning changes' USING ERRCODE='23514'; END IF;
 IF p_base IS NULL OR p_base<=0 THEN RAISE EXCEPTION 'Enter the benchmark amount' USING ERRCODE='23514'; END IF;
 IF p_overall IS NULL OR p_overall<=0 OR p_overall>100 OR p_performance IS NULL OR p_performance<=0 OR p_performance>100 OR p_trivial IS NULL OR p_trivial<=0 OR p_trivial>100 THEN RAISE EXCEPTION 'Percentages must be above 0 and not above 100' USING ERRCODE='23514'; END IF;
 cl:=btrim(COALESCE(p_rationale,''));
 IF length(cl)<30 THEN RAISE EXCEPTION 'Explain why this benchmark and percentage suit the client, in at least 30 characters' USING ERRCODE='23514'; END IF;
 ov:=round(p_base*p_overall/100,2);pf:=round(ov*p_performance/100,2);tv:=round(ov*p_trivial/100,2);
 IF tv>pf THEN RAISE EXCEPTION 'Clearly trivial must not be more than performance materiality' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_materiality SET status='Superseded' WHERE audit_file_id=p_file AND status='Draft';
 SELECT COALESCE(max(version_number),0)+1 INTO v FROM erp_private.audit_materiality WHERE audit_file_id=p_file;
 INSERT INTO erp_private.audit_materiality(audit_file_id,project_id,handling_firm_id,version_number,benchmark,benchmark_other,base_amount,overall_pct,performance_pct,trivial_pct,overall_amount,performance_amount,trivial_amount,rationale,prepared_by)
  VALUES(p_file,f.project_id,f.handling_firm_id,v,p_benchmark,COALESCE(btrim(p_other),''),p_base,p_overall,p_performance,p_trivial,ov,pf,tv,cl,a.staff_id) RETURNING materiality_id INTO id;
 PERFORM erp_private.alert_partners('audit-materiality:'||id::text,'Materiality is waiting for Partner approval on an audit file.');
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_materiality_approve(p_materiality uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;m erp_private.audit_materiality;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can approve materiality' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM erp_private.audit_materiality WHERE materiality_id=p_materiality AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF m.materiality_id IS NULL THEN RAISE EXCEPTION 'Materiality unavailable' USING ERRCODE='42501'; END IF;
 IF m.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft can be approved' USING ERRCODE='23514'; END IF;
 IF m.prepared_by=a.staff_id THEN RAISE EXCEPTION 'Another Partner must approve materiality you prepared' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.audit_materiality SET status='Superseded' WHERE audit_file_id=m.audit_file_id AND status='Approved';
 UPDATE erp_private.audit_materiality SET status='Approved',approved_by=a.staff_id,approved_at=now() WHERE materiality_id=p_materiality;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(m.prepared_by,a.full_name||' approved the materiality you prepared.','audit-materiality-ok:'||p_materiality::text) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_risk_save(p_file uuid,p_risk uuid,p_description text,p_area text,p_assertion text,p_level text,p_significant boolean,p_fraud boolean,p_response text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;n integer;id uuid:=p_risk;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner records assessed risks' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to planning changes' USING ERRCODE='23514'; END IF;
 IF COALESCE(p_fraud,false) AND NOT COALESCE(p_significant,false) THEN RAISE EXCEPTION 'A fraud risk is always a significant risk' USING ERRCODE='23514'; END IF;
 IF id IS NULL THEN
  SELECT COALESCE(max(risk_seq),0)+1 INTO n FROM erp_private.audit_risks WHERE audit_file_id=p_file;
  INSERT INTO erp_private.audit_risks(audit_file_id,project_id,handling_firm_id,risk_seq,risk_ref,description,audit_area,assertion,risk_level,significant,fraud_risk,planned_response,created_by)
   VALUES(p_file,f.project_id,f.handling_firm_id,n,'R-'||lpad(n::text,3,'0'),btrim(p_description),p_area,btrim(p_assertion),p_level,COALESCE(p_significant,false),COALESCE(p_fraud,false),btrim(p_response),a.staff_id) RETURNING risk_id INTO id;
 ELSE
  UPDATE erp_private.audit_risks SET description=btrim(p_description),audit_area=p_area,assertion=btrim(p_assertion),risk_level=p_level,significant=COALESCE(p_significant,false),fraud_risk=COALESCE(p_fraud,false),planned_response=btrim(p_response)
   WHERE risk_id=id AND audit_file_id=p_file AND status='Open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an open risk on this file can be changed' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_risk_close(p_risk uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.audit_risks;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner closes a risk' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM erp_private.audit_risks WHERE risk_id=p_risk AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF r.risk_id IS NULL THEN RAISE EXCEPTION 'Risk unavailable' USING ERRCODE='42501'; END IF;
 IF r.status<>'Open' THEN RAISE EXCEPTION 'That risk is already closed' USING ERRCODE='23514'; END IF;
 IF r.created_by=a.staff_id THEN RAISE EXCEPTION 'Someone other than the person who recorded the risk must close it' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Say why the risk no longer applies, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_risks SET status='Closed',closed_note=btrim(p_note),closed_by=a.staff_id,closed_at=now() WHERE risk_id=p_risk;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_risk_link(p_workpaper uuid,p_risk uuid,p_link boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;w erp_private.audit_workpapers;r erp_private.audit_risks;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM erp_private.audit_workpapers WHERE audit_workpaper_id=p_workpaper AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF w.audit_workpaper_id IS NULL THEN RAISE EXCEPTION 'Working paper unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM erp_private.audit_risks WHERE risk_id=p_risk AND audit_file_id=w.audit_file_id;
 IF r.risk_id IS NULL THEN RAISE EXCEPTION 'That risk is not on this audit file' USING ERRCODE='22023'; END IF;
 IF w.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Risks can only be linked while the working paper is a draft or returned' USING ERRCODE='23514'; END IF;
 IF w.prepared_by<>a.staff_id AND a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Supervisor or above can link risks' USING ERRCODE='42501'; END IF;
 IF COALESCE(p_link,true) THEN
  IF r.status<>'Open' THEN RAISE EXCEPTION 'Only an open risk can be linked' USING ERRCODE='23514'; END IF;
  INSERT INTO erp_private.audit_workpaper_risks(audit_workpaper_id,risk_id,audit_file_id,project_id,handling_firm_id,linked_by) VALUES(w.audit_workpaper_id,r.risk_id,w.audit_file_id,w.project_id,w.handling_firm_id,a.staff_id)
   ON CONFLICT(audit_workpaper_id,risk_id) DO UPDATE SET unlinked_at=NULL,unlinked_by=NULL,linked_by=EXCLUDED.linked_by,linked_at=now();
 ELSE
  -- A link is never deleted. Unlinking keeps who did it and when, and only a draft working paper can be changed.
  UPDATE erp_private.audit_workpaper_risks SET unlinked_at=now(),unlinked_by=a.staff_id WHERE audit_workpaper_id=w.audit_workpaper_id AND risk_id=r.risk_id AND unlinked_at IS NULL;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION erp_private.audit_planning_gate(uuid),erp_private.audit_materiality_save(uuid,text,text,numeric,numeric,numeric,numeric,text),erp_private.audit_materiality_approve(uuid),erp_private.audit_risk_save(uuid,uuid,text,text,text,text,boolean,boolean,text),erp_private.audit_risk_close(uuid,text),erp_private.audit_risk_link(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_planning_gate(uuid),erp_private.audit_materiality_save(uuid,text,text,numeric,numeric,numeric,numeric,text),erp_private.audit_materiality_approve(uuid),erp_private.audit_risk_save(uuid,uuid,text,text,text,text,boolean,boolean,text),erp_private.audit_risk_close(uuid,text),erp_private.audit_risk_link(uuid,uuid,boolean) TO erp_api;
