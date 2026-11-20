-- Audit build S8: assembly lock, late changes and milestones with compare.
--
--  1. Milestones: a saved, append-only picture of the file at a point in time (a fingerprint of every record on it, with a label for each
--     record). Two milestones, or a milestone and the file as it is now, can be compared to show what was added, removed or changed.
--     The file takes one itself when it is sent for review, approved, completed or archived. A Manager or Partner can take others.
--  2. Assembly: a Partner records that assembly of the file is complete (file in Completion, report date set). That seals the file:
--     the records on it can no longer be changed.
--  3. The deadline lock: after the assembly deadline (days and anchor from the firm policy) an unsealed file locks too, but ONLY when a
--     Partner has confirmed the lock days and anchor AND has switched the deadline lock on. Nothing is enforced by default.
--  4. Late changes: a Partner opens a late change with a reason; the file unlocks and a milestone is taken. A Manager or Partner other
--     than the person who opened it closes it with a note; a milestone is taken and the differences are saved with the change.
--  5. Archiving by a person needs assembly recorded as complete and no late change open.
-- No retention period is set or enforced here. That is a Partner decision.

-- ---- Policy: the deadline lock is off until a Partner turns it on -------------------------------------------------------------------------
ALTER TABLE erp_private.system_settings ADD CONSTRAINT system_settings_deadline_lock CHECK(key<>'AUDIT_DEADLINE_LOCK_ENFORCED' OR value IN('true','false'));
INSERT INTO erp_private.system_settings(key,value,note) VALUES
 ('AUDIT_DEADLINE_LOCK_ENFORCED','false','Default: off. When a Partner turns it on, and has confirmed the lock days and anchor, a file locks the day after its assembly deadline.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION erp_private.audit_policy_save(p_key text,p_value text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can set firm audit policy' USING ERRCODE='42501'; END IF;
 IF p_key NOT IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT','AUDIT_DEADLINE_LOCK_ENFORCED') THEN RAISE EXCEPTION 'Unknown policy setting' USING ERRCODE='22023'; END IF;
 IF p_key='AUDIT_FILE_LOCK_DAYS' AND NOT (btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' AND CASE WHEN btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' THEN btrim(p_value)::integer BETWEEN 1 AND 365 ELSE false END) THEN RAISE EXCEPTION 'Enter the number of days, from 1 to 365' USING ERRCODE='23514'; END IF;
 IF p_key='AUDIT_FILE_LOCK_ANCHOR' AND btrim(COALESCE(p_value,'')) NOT IN('REPORT_DATE','YEAR_END') THEN RAISE EXCEPTION 'Choose the audit report date or the financial year end' USING ERRCODE='23514'; END IF;
 IF p_key IN('SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT','AUDIT_DEADLINE_LOCK_ENFORCED') AND btrim(COALESCE(p_value,'')) NOT IN('true','false') THEN RAISE EXCEPTION 'Choose yes or no' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.system_settings SET value=btrim(p_value),note=btrim(p_note),updated_by=a.staff_id WHERE key=p_key;
 RETURN jsonb_build_object('ok',true);
END $$;

-- ---- Tables --------------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.audit_milestones (
 milestone_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq>0),
 kind text NOT NULL CHECK(kind IN('Planning complete','Fieldwork complete','Draft report issued','Other','Sent for review','Approved','Completion','Assembly complete','Before late change','After late change','Archived')),
 label text NOT NULL CHECK(length(btrim(label))>=3),
 note text NOT NULL DEFAULT '',
 file_status text NOT NULL,
 components jsonb NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 taken_by uuid NOT NULL REFERENCES erp_private.staff_members,
 taken_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(audit_file_id,seq),
 UNIQUE(milestone_id,audit_file_id),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_milestones_taken_by_idx ON erp_private.audit_milestones(taken_by);
CREATE INDEX audit_milestones_scope_idx ON erp_private.audit_milestones(audit_file_id,project_id,handling_firm_id);

CREATE TABLE erp_private.audit_assembly_seals (
 audit_file_id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 milestone_id uuid NOT NULL,
 note text NOT NULL CHECK(length(btrim(note))>=10),
 sealed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 sealed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(milestone_id,audit_file_id) REFERENCES erp_private.audit_milestones(milestone_id,audit_file_id),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_assembly_seals_by_idx ON erp_private.audit_assembly_seals(sealed_by);
CREATE INDEX audit_assembly_seals_milestone_idx ON erp_private.audit_assembly_seals(milestone_id,audit_file_id);
CREATE INDEX audit_assembly_seals_scope_idx ON erp_private.audit_assembly_seals(audit_file_id,project_id,handling_firm_id);

CREATE TABLE erp_private.audit_amendments (
 amendment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq>0),
 reason text NOT NULL CHECK(length(btrim(reason))>=20),
 opened_by uuid NOT NULL REFERENCES erp_private.staff_members,
 opened_at timestamptz NOT NULL DEFAULT now(),
 open_milestone_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Closed')),
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 close_note text NOT NULL DEFAULT '',
 close_milestone_id uuid,
 changes jsonb,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(audit_file_id,seq),
 CHECK((status='Open' AND closed_by IS NULL AND closed_at IS NULL AND close_milestone_id IS NULL AND changes IS NULL)
    OR (status='Closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND close_milestone_id IS NOT NULL AND changes IS NOT NULL AND length(btrim(close_note))>=20)),
 CHECK(closed_by IS NULL OR closed_by<>opened_by),
 FOREIGN KEY(open_milestone_id,audit_file_id) REFERENCES erp_private.audit_milestones(milestone_id,audit_file_id),
 FOREIGN KEY(close_milestone_id,audit_file_id) REFERENCES erp_private.audit_milestones(milestone_id,audit_file_id),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE UNIQUE INDEX audit_amendments_one_open_idx ON erp_private.audit_amendments(audit_file_id) WHERE status='Open';
CREATE INDEX audit_amendments_opened_by_idx ON erp_private.audit_amendments(opened_by);
CREATE INDEX audit_amendments_closed_by_idx ON erp_private.audit_amendments(closed_by);
CREATE INDEX audit_amendments_open_ms_idx ON erp_private.audit_amendments(open_milestone_id,audit_file_id);
CREATE INDEX audit_amendments_close_ms_idx ON erp_private.audit_amendments(close_milestone_id,audit_file_id);
CREATE INDEX audit_amendments_scope_idx ON erp_private.audit_amendments(audit_file_id,project_id,handling_firm_id);

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_milestones','audit_assembly_seals','audit_amendments'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
 END LOOP;
END $$;
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.audit_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('amendment_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.audit_assembly_seals FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_file_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.audit_milestones FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('milestone_id');

-- A milestone and a seal never change. A late change changes once, when it is closed.
CREATE FUNCTION erp_private.audit_assembly_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_TABLE_NAME='audit_amendments' THEN
  IF OLD.status='Closed' THEN RAISE EXCEPTION 'A closed late change cannot be changed' USING ERRCODE='23514'; END IF;
  IF NEW.status='Open' OR (NEW.audit_file_id,NEW.seq,NEW.reason,NEW.opened_by,NEW.opened_at,NEW.open_milestone_id) IS DISTINCT FROM (OLD.audit_file_id,OLD.seq,OLD.reason,OLD.opened_by,OLD.opened_at,OLD.open_milestone_id) THEN
   RAISE EXCEPTION 'A late change can only be closed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'A milestone or seal cannot be changed' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.audit_milestones FOR EACH ROW EXECUTE FUNCTION erp_private.audit_assembly_immutable();
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.audit_assembly_seals FOR EACH ROW EXECUTE FUNCTION erp_private.audit_assembly_immutable();
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.audit_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.audit_assembly_immutable();

-- ---- Fingerprint: every record kept on the file, with a short label for each --------------------------------------------------------
-- For each kind of record: how many there are, a hash of all of them, and (for the ones people name) a label and hash per record.
CREATE FUNCTION erp_private.audit_fingerprint(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;res jsonb:='{}'::jsonb;c jsonb;
BEGIN
 FOR r IN SELECT * FROM (VALUES
   (1,'tb_imports','Trial balance imports','audit_tb_imports','x.audit_tb_import_id::text','x.period_kind||'' ''||x.status||'' ''||left(x.import_signature,8)',true),
   (2,'tb_lines','Trial balance lines','audit_tb_lines','x.audit_tb_line_id::text','x.source_row::text',false),
   (3,'materiality','Materiality','audit_materiality','x.materiality_id::text','''Version ''||x.version_number||'' ''||x.status',true),
   (4,'risks','Risks','audit_risks','x.risk_id::text','x.risk_ref',true),
   (5,'workpapers','Working papers','audit_workpapers','x.audit_workpaper_id::text','x.workpaper_ref',true),
   (6,'workpaper_versions','Working paper versions','audit_workpaper_versions','x.audit_workpaper_version_id::text','x.version_number::text',false),
   (7,'workpaper_risks','Working paper and risk links','audit_workpaper_risks','x.audit_workpaper_id::text||x.risk_id::text','x.risk_id::text',false),
   (8,'adjustments','Audit entries','audit_adjustments','x.adjustment_id::text','x.adj_ref',true),
   (9,'adjustment_lines','Audit entry lines','audit_adjustment_lines','x.line_id::text','x.line_no::text',false),
   (10,'misstatement','Misstatement conclusions','audit_misstatement_conclusions','x.conclusion_id::text','''Conclusion''',true),
   (11,'populations','Populations','audit_populations','x.population_id::text','x.pop_ref',true),
   (12,'analytics','Analytics alerts','audit_analytic_alerts','x.alert_id::text','x.title',true),
   (13,'completion','Completion controls','audit_completion_items','x.audit_completion_item_id::text','x.item_key',true),
   (14,'mgmt_points','Management letter points','audit_management_points','x.point_id::text','x.point_ref',true),
   (15,'reports','Reports','audit_reports','x.report_id::text','x.kind||'' version ''||x.version_number||'' ''||x.status',true),
   (16,'sacco_moves','SACCO equity movements','sacco_equity_moves','x.move_id::text','x.line_code||'' ''||x.kind',true),
   (17,'sacco_values','SACCO statistics','sacco_file_values','x.value_id::text','x.line_code',true),
   (18,'sacco_checks','SACCO section 10 matters','sacco_file_checks','x.check_id::text','x.line_code',true),
   (19,'sasra_figures','SASRA figures','sasra_file_figures','x.figure_id::text','x.line_code',true),
   (20,'pack_steps','Audit programme steps','audit_file_steps','x.file_step_id::text','x.step_code',true),
   (21,'pack_compliance','Compliance items','audit_file_compliance','x.compliance_id::text','x.compliance_id::text',false),
   (22,'pack_matters','Matters communicated','audit_tcwg_matters','x.matter_id::text','x.matter_ref',true),
   (23,'pack_kam','Key audit matter decisions','audit_kam_decisions','x.matter_id::text','x.heading',true)
  ) v(ord,key,title,tbl,pk,lbl,detail) ORDER BY ord LOOP
  EXECUTE format('SELECT jsonb_build_object(''ord'',%s,''title'',%L,''count'',count(*),''hash'',COALESCE(md5(string_agg(md5(x::text),'''' ORDER BY md5(x::text))),''''),''items'',%s) FROM erp_private.%I x WHERE x.audit_file_id=$1',
    r.ord,r.title,
    CASE WHEN r.detail THEN format('COALESCE(jsonb_object_agg(%s,jsonb_build_object(''l'',%s,''h'',md5(x::text))),''{}''::jsonb)',r.pk,r.lbl) ELSE '''{}''::jsonb' END,
    r.tbl) INTO c USING p_file;
  res:=res||jsonb_build_object(r.key,c);
 END LOOP;
 RETURN res;
END $$;

CREATE FUNCTION erp_private.audit_components_hash(p_components jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT encode(sha256(convert_to(COALESCE((SELECT jsonb_object_agg(k,jsonb_build_object('c',v->'count','h',v->'hash')) FROM jsonb_each(p_components) e(k,v)),'{}'::jsonb)::text,'UTF8')),'hex');
$$;

-- What differs between two sets of components. Labels are capped so the answer stays small.
CREATE FUNCTION erp_private.audit_components_compare(p_a jsonb,p_b jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE v_k text;ca jsonb;cb jsonb;v_rows jsonb:='[]'::jsonb;v_added jsonb;v_removed jsonb;v_changed jsonb;n_added integer;n_removed integer;n_changed integer;v_ord integer;v_title text;
BEGIN
 FOR v_k,v_ord,v_title IN SELECT u.k,COALESCE((COALESCE(p_b->u.k,p_a->u.k)->>'ord')::integer,999),COALESCE(p_b->u.k->>'title',p_a->u.k->>'title',u.k) FROM (SELECT jsonb_object_keys(p_a) k UNION SELECT jsonb_object_keys(p_b)) u ORDER BY 2,1 LOOP
  ca:=COALESCE(p_a->v_k,jsonb_build_object('count',0,'hash','','items','{}'::jsonb));
  cb:=COALESCE(p_b->v_k,jsonb_build_object('count',0,'hash','','items','{}'::jsonb));
  SELECT count(*),COALESCE(jsonb_agg(l) FILTER (WHERE rn<=30),'[]'::jsonb) INTO n_added,v_added FROM (SELECT (cb->'items'->i.key)->>'l' l,row_number() OVER (ORDER BY (cb->'items'->i.key)->>'l') rn FROM jsonb_each(cb->'items') i(key,value) WHERE NOT (ca->'items') ? i.key) s;
  SELECT count(*),COALESCE(jsonb_agg(l) FILTER (WHERE rn<=30),'[]'::jsonb) INTO n_removed,v_removed FROM (SELECT (ca->'items'->i.key)->>'l' l,row_number() OVER (ORDER BY (ca->'items'->i.key)->>'l') rn FROM jsonb_each(ca->'items') i(key,value) WHERE NOT (cb->'items') ? i.key) s;
  SELECT count(*),COALESCE(jsonb_agg(l) FILTER (WHERE rn<=30),'[]'::jsonb) INTO n_changed,v_changed FROM (SELECT (cb->'items'->i.key)->>'l' l,row_number() OVER (ORDER BY (cb->'items'->i.key)->>'l') rn FROM jsonb_each(cb->'items') i(key,value) WHERE (ca->'items') ? i.key AND (ca->'items'->i.key)->>'h' IS DISTINCT FROM (cb->'items'->i.key)->>'h') s;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('key',v_k,'title',v_title,'before',(ca->>'count')::integer,'after',(cb->>'count')::integer,'changed',ca->>'hash' IS DISTINCT FROM cb->>'hash',
    'added',v_added,'removed',v_removed,'edited',v_changed,'n_added',n_added,'n_removed',n_removed,'n_edited',n_changed));
 END LOOP;
 RETURN v_rows;
END $$;

-- ---- Taking a milestone ------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.audit_milestone_insert(p_file uuid,p_kind text,p_label text,p_note text,p_by uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;comps jsonb;id uuid;sq integer;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 comps:=erp_private.audit_fingerprint(p_file);
 SELECT COALESCE(max(seq),0)+1 INTO sq FROM erp_private.audit_milestones WHERE audit_file_id=p_file;
 INSERT INTO erp_private.audit_milestones(audit_file_id,project_id,handling_firm_id,seq,kind,label,note,file_status,components,fingerprint,taken_by)
  VALUES(p_file,f.project_id,f.handling_firm_id,sq,p_kind,btrim(p_label),COALESCE(btrim(p_note),''),f.file_status,comps,erp_private.audit_components_hash(comps),p_by) RETURNING milestone_id INTO id;
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_milestone_take(p_file uuid,p_kind text,p_label text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;id uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner takes a milestone' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN('Planning complete','Fieldwork complete','Draft report issued','Other') THEN RAISE EXCEPTION 'Choose a milestone' USING ERRCODE='22023'; END IF;
 IF length(btrim(COALESCE(p_label,'')))<3 THEN RAISE EXCEPTION 'Name the milestone' USING ERRCODE='23514'; END IF;
 id:=erp_private.audit_milestone_insert(p_file,p_kind,p_label,p_note,a.staff_id);
 RETURN jsonb_build_object('ok',true,'milestone_id',id);
END $$;

-- The file takes a milestone itself at each stage.
CREATE FUNCTION erp_private.audit_milestone_auto() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_by uuid;v_kind text;v_label text;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status THEN RETURN NEW; END IF;
 v_kind:=CASE NEW.file_status WHEN 'In Review' THEN 'Sent for review' WHEN 'Approved' THEN 'Approved' WHEN 'Completion' THEN 'Completion' WHEN 'Archived' THEN 'Archived' ELSE NULL END;
 IF v_kind IS NULL THEN RETURN NEW; END IF;
 v_label:=CASE v_kind WHEN 'Sent for review' THEN 'File sent for review' WHEN 'Approved' THEN 'File approved' WHEN 'Completion' THEN 'File moved to completion' ELSE 'File archived' END;
 v_by:=COALESCE((erp_private.actor()).staff_id,NEW.created_by);
 IF v_by IS NULL THEN RETURN NEW; END IF;
 PERFORM erp_private.audit_milestone_insert(NEW.audit_file_id,v_kind,v_label,'Taken automatically.',v_by);
 RETURN NEW;
END $$;
CREATE TRIGGER milestone_auto AFTER UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_milestone_auto();

-- ---- Compare ---------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.audit_milestone_compare(p_file uuid,p_a uuid,p_b uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;ma erp_private.audit_milestones;mb erp_private.audit_milestones;ca jsonb;cb jsonb;v_rows jsonb;nm text;ja jsonb;jb jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO ma FROM erp_private.audit_milestones WHERE milestone_id=p_a AND audit_file_id=p_file;
 IF ma.milestone_id IS NULL THEN RAISE EXCEPTION 'Choose a milestone to compare from' USING ERRCODE='22023'; END IF;
 ca:=ma.components;
 SELECT full_name INTO nm FROM erp_private.staff_members WHERE staff_id=ma.taken_by;
 ja:=jsonb_build_object('milestone_id',ma.milestone_id,'seq',ma.seq,'kind',ma.kind,'label',ma.label,'taken_at',ma.taken_at,'taken_by_name',nm,'file_status',ma.file_status);
 IF p_b IS NULL THEN
  cb:=erp_private.audit_fingerprint(p_file);
  jb:=jsonb_build_object('milestone_id',NULL,'label','The file as it is now','file_status',f.file_status,'taken_at',now());
 ELSE
  SELECT * INTO mb FROM erp_private.audit_milestones WHERE milestone_id=p_b AND audit_file_id=p_file;
  IF mb.milestone_id IS NULL THEN RAISE EXCEPTION 'Choose a milestone to compare with' USING ERRCODE='22023'; END IF;
  cb:=mb.components;
  SELECT full_name INTO nm FROM erp_private.staff_members WHERE staff_id=mb.taken_by;
  jb:=jsonb_build_object('milestone_id',mb.milestone_id,'seq',mb.seq,'kind',mb.kind,'label',mb.label,'taken_at',mb.taken_at,'taken_by_name',nm,'file_status',mb.file_status);
 END IF;
 v_rows:=erp_private.audit_components_compare(ca,cb);
 RETURN jsonb_build_object('a',ja,'b',jb,'same',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_rows) x WHERE (x->>'changed')::boolean),'components',v_rows);
END $$;

-- ---- The lock ----------------------------------------------------------------------------------------------------------------------------
-- locked = (sealed, or past the deadline with the deadline lock switched on and confirmed) and no late change open.
CREATE FUNCTION erp_private.audit_lock_info(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;days integer;anchor text;dconf boolean;aconf boolean;enf boolean;enf_conf boolean;anchor_date date;dl date;today date;sealed boolean;opn boolean;enforced boolean;past boolean;why text:='';
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 SELECT value::integer,updated_by IS NOT NULL INTO days,dconf FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_DAYS';
 SELECT value,updated_by IS NOT NULL INTO anchor,aconf FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_ANCHOR';
 SELECT value='true',updated_by IS NOT NULL INTO enf,enf_conf FROM erp_private.system_settings WHERE key='AUDIT_DEADLINE_LOCK_ENFORCED';
 anchor_date:=CASE anchor WHEN 'YEAR_END' THEN f.ends_on ELSE f.audit_report_date END;
 dl:=CASE WHEN anchor_date IS NULL THEN NULL ELSE anchor_date+days END;
 sealed:=EXISTS(SELECT 1 FROM erp_private.audit_assembly_seals WHERE audit_file_id=p_file);
 opn:=EXISTS(SELECT 1 FROM erp_private.audit_amendments WHERE audit_file_id=p_file AND status='Open');
 IF NOT COALESCE(enf,false) THEN why:='The deadline lock is switched off.';
 ELSIF NOT COALESCE(enf_conf,false) THEN why:='A Partner has not confirmed the deadline lock setting.';
 ELSIF NOT COALESCE(dconf,false) THEN why:='A Partner has not confirmed the number of lock days.';
 ELSIF NOT COALESCE(aconf,false) THEN why:='A Partner has not confirmed what the lock days run from.';
 ELSIF dl IS NULL THEN why:='The audit report date is not set.';
 END IF;
 enforced:=why='';
 past:=enforced AND today>dl;
 RETURN jsonb_build_object('sealed',sealed,'amendment_open',opn,'enforced',enforced,'not_enforced_because',why,'deadline',dl,'anchor',anchor,'anchor_date',anchor_date,'days',days,
  'past_deadline',past,'locked',(sealed OR past) AND NOT opn,'locked_by',CASE WHEN opn THEN NULL WHEN sealed THEN 'Assembly complete' WHEN past THEN 'Assembly deadline' ELSE NULL END);
END $$;

CREATE FUNCTION erp_private.audit_file_locked(p_file uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF p_file IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_assembly_seals WHERE audit_file_id=p_file)
    AND NOT COALESCE((SELECT value='true' FROM erp_private.system_settings WHERE key='AUDIT_DEADLINE_LOCK_ENFORCED'),false) THEN RETURN false; END IF;
 RETURN COALESCE((erp_private.audit_lock_info(p_file)->>'locked')::boolean,false);
END $$;

CREATE FUNCTION erp_private.audit_lock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE fid uuid;
BEGIN
 fid:=CASE WHEN TG_OP='DELETE' THEN OLD.audit_file_id ELSE NEW.audit_file_id END;
 IF erp_private.audit_file_locked(fid) THEN
  RAISE EXCEPTION 'The audit file is locked after assembly. A Partner must open a late change before anything on it can change' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_tb_imports','audit_tb_lines','audit_materiality','audit_risks','audit_workpapers','audit_workpaper_versions','audit_workpaper_risks','audit_adjustments','audit_adjustment_lines',
   'audit_misstatement_conclusions','audit_populations','audit_analytic_runs','audit_analytic_alerts','audit_completion_items','audit_management_points','audit_reports','sacco_equity_moves','sacco_file_values',
   'sacco_file_checks','sasra_file_figures','audit_file_steps','audit_file_compliance','audit_tcwg_matters','audit_kam_decisions'] LOOP
  EXECUTE format('CREATE TRIGGER a_assembly_lock BEFORE INSERT OR UPDATE OR DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.audit_lock_guard()',t);
 END LOOP;
END $$;

-- The dates that set the deadline do not move once the file is locked.
CREATE FUNCTION erp_private.audit_file_lock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF (NEW.audit_report_date,NEW.starts_on,NEW.ends_on,NEW.reporting_framework) IS DISTINCT FROM (OLD.audit_report_date,OLD.starts_on,OLD.ends_on,OLD.reporting_framework) AND erp_private.audit_file_locked(OLD.audit_file_id) THEN
  RAISE EXCEPTION 'The audit file is locked after assembly. A Partner must open a late change before its dates or framework can change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_assembly_lock BEFORE UPDATE ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_lock_guard();

-- ---- Assembly complete, late changes, archive ----------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.audit_archive_issues(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE res jsonb:='[]'::jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_assembly_seals WHERE audit_file_id=p_file) THEN res:=res||to_jsonb('A Partner has not recorded that assembly of the file is complete.'::text); END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_amendments WHERE audit_file_id=p_file AND status='Open') THEN res:=res||to_jsonb('A late change is still open and has not been reviewed.'::text); END IF;
 RETURN res;
END $$;

-- A person archiving a file needs assembly recorded as complete. (A direct database change with no signed-in person is not affected.)
CREATE FUNCTION erp_private.audit_archive_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE iss jsonb;
BEGIN
 IF NEW.file_status='Archived' AND OLD.file_status IS DISTINCT FROM 'Archived' AND (erp_private.actor()).staff_id IS NOT NULL THEN
  iss:=erp_private.audit_archive_issues(NEW.audit_file_id);
  IF jsonb_array_length(iss)>0 THEN RAISE EXCEPTION '%',iss->>0 USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER archive_gate BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_archive_gate();

CREATE FUNCTION erp_private.audit_assembly_seal(p_file uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;mid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner records that assembly is complete' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status<>'Completion' THEN RAISE EXCEPTION 'The file must be in completion before assembly is recorded as complete' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_assembly_seals WHERE audit_file_id=p_file) THEN RAISE EXCEPTION 'Assembly is already recorded as complete' USING ERRCODE='23514'; END IF;
 IF f.audit_report_date IS NULL THEN RAISE EXCEPTION 'Set the audit report date before recording assembly as complete' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what you checked, in at least 10 characters' USING ERRCODE='23514'; END IF;
 mid:=erp_private.audit_milestone_insert(p_file,'Assembly complete','Assembly recorded as complete',p_note,a.staff_id);
 INSERT INTO erp_private.audit_assembly_seals(audit_file_id,project_id,handling_firm_id,milestone_id,note,sealed_by) VALUES(p_file,f.project_id,f.handling_firm_id,mid,btrim(p_note),a.staff_id);
 RETURN jsonb_build_object('ok',true,'milestone_id',mid);
END $$;

CREATE FUNCTION erp_private.audit_amend_open(p_file uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;mid uuid;sq integer;aid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner opens a late change' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status='Archived' THEN RAISE EXCEPTION 'The audit file is archived' USING ERRCODE='23514'; END IF;
 IF NOT erp_private.audit_file_locked(p_file) THEN RAISE EXCEPTION 'The file is not locked, so there is nothing to open' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<20 THEN RAISE EXCEPTION 'Record why the file must change, in at least 20 characters' USING ERRCODE='23514'; END IF;
 mid:=erp_private.audit_milestone_insert(p_file,'Before late change','Before a late change',p_reason,a.staff_id);
 SELECT COALESCE(max(seq),0)+1 INTO sq FROM erp_private.audit_amendments WHERE audit_file_id=p_file;
 INSERT INTO erp_private.audit_amendments(audit_file_id,project_id,handling_firm_id,seq,reason,opened_by,open_milestone_id) VALUES(p_file,f.project_id,f.handling_firm_id,sq,btrim(p_reason),a.staff_id,mid) RETURNING amendment_id INTO aid;
 RETURN jsonb_build_object('ok',true,'amendment_id',aid);
END $$;

CREATE FUNCTION erp_private.audit_amend_close(p_file uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;am erp_private.audit_amendments;mid uuid;v_before jsonb;v_after jsonb;ch jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner reviews and closes a late change' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO am FROM erp_private.audit_amendments WHERE audit_file_id=p_file AND status='Open' FOR UPDATE;
 IF am.amendment_id IS NULL THEN RAISE EXCEPTION 'There is no open late change' USING ERRCODE='23514'; END IF;
 IF am.opened_by=a.staff_id THEN RAISE EXCEPTION 'The person who opened the late change cannot review and close it' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<20 THEN RAISE EXCEPTION 'Record what you reviewed and concluded, in at least 20 characters' USING ERRCODE='23514'; END IF;
 mid:=erp_private.audit_milestone_insert(p_file,'After late change','After a late change',p_note,a.staff_id);
 SELECT components INTO v_before FROM erp_private.audit_milestones WHERE milestone_id=am.open_milestone_id;
 SELECT components INTO v_after FROM erp_private.audit_milestones WHERE milestone_id=mid;
 SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO ch FROM jsonb_array_elements(erp_private.audit_components_compare(v_before,v_after)) x WHERE (x->>'changed')::boolean;
 UPDATE erp_private.audit_amendments SET status='Closed',closed_by=a.staff_id,closed_at=now(),close_note=btrim(p_note),close_milestone_id=mid,changes=ch WHERE amendment_id=am.amendment_id;
 RETURN jsonb_build_object('ok',true,'milestone_id',mid,'changed',jsonb_array_length(ch));
END $$;

-- ---- Everything the Assembly tab shows -----------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.audit_assembly_workspace(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;sl erp_private.audit_assembly_seals;seal jsonb:=NULL;chk jsonb:=NULL;cur jsonb;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code='INTERN' THEN RETURN NULL; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO sl FROM erp_private.audit_assembly_seals WHERE audit_file_id=p_file;
 IF sl.audit_file_id IS NOT NULL THEN
  seal:=jsonb_build_object('sealed_at',sl.sealed_at,'sealed_by',sl.sealed_by,'sealed_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=sl.sealed_by),'note',sl.note,'milestone_id',sl.milestone_id);
  cur:=erp_private.audit_fingerprint(p_file);
  chk:=(SELECT jsonb_build_object('same',NOT EXISTS(SELECT 1 FROM jsonb_array_elements(x) e WHERE (e->>'changed')::boolean),
    'changed',COALESCE((SELECT jsonb_agg(e->>'title') FROM jsonb_array_elements(x) e WHERE (e->>'changed')::boolean),'[]'::jsonb))
    FROM (SELECT erp_private.audit_components_compare((SELECT components FROM erp_private.audit_milestones WHERE milestone_id=sl.milestone_id),cur) x) s);
 END IF;
 RETURN jsonb_build_object('lock',erp_private.audit_lock_info(p_file),'seal',seal,'seal_check',chk,'archive_issues',erp_private.audit_archive_issues(p_file),
  'policy',(SELECT COALESCE(jsonb_agg(jsonb_build_object('key',s.key,'value',s.value,'note',s.note,'confirmed',s.updated_by IS NOT NULL,'confirmed_by_name',m.full_name) ORDER BY s.key),'[]'::jsonb)
    FROM erp_private.system_settings s LEFT JOIN erp_private.staff_members m ON m.staff_id=s.updated_by WHERE s.key IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','AUDIT_DEADLINE_LOCK_ENFORCED')),
  'milestones',COALESCE((SELECT jsonb_agg(jsonb_build_object('milestone_id',m.milestone_id,'seq',m.seq,'kind',m.kind,'label',m.label,'note',m.note,'file_status',m.file_status,'fingerprint',left(m.fingerprint,12),'taken_at',m.taken_at,'taken_by_name',s.full_name) ORDER BY m.seq)
    FROM erp_private.audit_milestones m JOIN erp_private.staff_members s ON s.staff_id=m.taken_by WHERE m.audit_file_id=p_file),'[]'::jsonb),
  'amendments',COALESCE((SELECT jsonb_agg(jsonb_build_object('amendment_id',x.amendment_id,'seq',x.seq,'reason',x.reason,'status',x.status,'opened_by',x.opened_by,'opened_by_name',o.full_name,'opened_at',x.opened_at,
      'closed_by_name',c.full_name,'closed_at',x.closed_at,'close_note',x.close_note,'changes',x.changes,'open_milestone_id',x.open_milestone_id,'close_milestone_id',x.close_milestone_id) ORDER BY x.seq)
    FROM erp_private.audit_amendments x JOIN erp_private.staff_members o ON o.staff_id=x.opened_by LEFT JOIN erp_private.staff_members c ON c.staff_id=x.closed_by WHERE x.audit_file_id=p_file),'[]'::jsonb));
END $$;

-- ---- A late change lets the existing screens work again on a closed file -------------------------------------------------------------------
-- Many functions refuse work once a file is Approved or Completion. While a Partner has a late change open on the file, those same functions
-- work as they would on an open file. An archived file is never reopened. (Two checks written another way, deciding management points and
-- clearing analytics alerts, stay closed.)
CREATE FUNCTION erp_private.audit_amendment_open(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.audit_amendments WHERE audit_file_id=p_file AND status='Open');
$$;

DO $$ DECLARE r record;def text;nd text;n integer:=0;
BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname='erp_private' AND p.prosrc LIKE '%f.file_status IN(''Approved'',''Completion'',''Archived'')%' LOOP
  def:=pg_get_functiondef(r.oid);
  nd:=replace(def,'f.file_status IN(''Approved'',''Completion'',''Archived'')','(f.file_status=''Archived'' OR (f.file_status IN(''Approved'',''Completion'') AND NOT erp_private.audit_amendment_open(f.audit_file_id)))');
  IF nd<>def THEN EXECUTE nd; n:=n+1; END IF;
 END LOOP;
 IF n<10 THEN RAISE EXCEPTION 'Expected to update the closed-file checks in at least 10 functions, updated %',n; END IF;
END $$;

-- ---- Permissions ---------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION erp_private.audit_assembly_immutable(),erp_private.audit_fingerprint(uuid),erp_private.audit_components_hash(jsonb),erp_private.audit_components_compare(jsonb,jsonb),
 erp_private.audit_milestone_insert(uuid,text,text,text,uuid),erp_private.audit_milestone_auto(),erp_private.audit_lock_info(uuid),erp_private.audit_file_locked(uuid),erp_private.audit_lock_guard(),
 erp_private.audit_file_lock_guard(),erp_private.audit_archive_issues(uuid),erp_private.audit_archive_gate(),erp_private.audit_amendment_open(uuid)
 FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_milestone_take(uuid,text,text,text),erp_private.audit_milestone_compare(uuid,uuid,uuid),erp_private.audit_assembly_seal(uuid,text),
 erp_private.audit_amend_open(uuid,text),erp_private.audit_amend_close(uuid,text),erp_private.audit_assembly_workspace(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_milestone_take(uuid,text,text,text),erp_private.audit_milestone_compare(uuid,uuid,uuid),erp_private.audit_assembly_seal(uuid,text),
 erp_private.audit_amend_open(uuid,text),erp_private.audit_amend_close(uuid,text),erp_private.audit_assembly_workspace(uuid) TO erp_api;
