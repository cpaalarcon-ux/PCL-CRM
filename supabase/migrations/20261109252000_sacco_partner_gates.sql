-- S3: Partner gates for SACCO audits.
--  1. SASRA auditor eligibility: a Partner records it per client and financial year (with the proof document) before a SACCO statutory-audit
--     project or audit file can be created. The log is append-only; the latest record for the client, firm and year decides.
--  2. Engagement quality control review (EQCR): a deposit-taking SACCO file needs approval by a Partner who is not on the engagement,
--     before final sign-off. Whether the firm treats deposit-taking SACCOs as public-interest entities is a Partner setting.
--  3. SASRA ratio table: the Partner enters and activates each ratio (no ratio is hard-coded). The file's prudential figures are compared
--     with the active ratios; a breach must be acknowledged by a Partner before final sign-off.
--  4. Firm policy: file-lock days, what the lock period runs from, and the audit report date. These only set and show the assembly deadline.
--     Locking itself is a later build.
-- Nothing stores a SASRA figure. Every parameter starts as a default that is shown as "not yet confirmed by a Partner" until one saves it.

-- ---- Firm policy parameters ---------------------------------------------------------------------------------------------------------
ALTER TABLE erp_private.system_settings ADD CONSTRAINT system_settings_lock_days CHECK(key<>'AUDIT_FILE_LOCK_DAYS' OR CASE WHEN value ~ '^[0-9]{1,3}$' THEN value::integer BETWEEN 1 AND 365 ELSE false END);
ALTER TABLE erp_private.system_settings ADD CONSTRAINT system_settings_lock_anchor CHECK(key<>'AUDIT_FILE_LOCK_ANCHOR' OR value IN('REPORT_DATE','YEAR_END'));
ALTER TABLE erp_private.system_settings ADD CONSTRAINT system_settings_dt_eqcr CHECK(key<>'SACCO_DT_REQUIRES_EQCR' OR value IN('true','false'));
INSERT INTO erp_private.system_settings(key,value,note) VALUES
 ('AUDIT_FILE_LOCK_DAYS','60','Default. A Partner confirms or changes it.'),
 ('AUDIT_FILE_LOCK_ANCHOR','REPORT_DATE','Default. Days run from the audit report date. A Partner may choose the financial year end instead.'),
 ('SACCO_DT_REQUIRES_EQCR','true','Default. Deposit-taking SACCOs are treated as public-interest entities and need an EQCR. A Partner confirms.')
ON CONFLICT (key) DO NOTHING;

CREATE FUNCTION erp_private.audit_policy_save(p_key text,p_value text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can set firm audit policy' USING ERRCODE='42501'; END IF;
 IF p_key NOT IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','SACCO_DT_REQUIRES_EQCR') THEN RAISE EXCEPTION 'Unknown policy setting' USING ERRCODE='22023'; END IF;
 IF p_key='AUDIT_FILE_LOCK_DAYS' AND NOT (btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' AND CASE WHEN btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' THEN btrim(p_value)::integer BETWEEN 1 AND 365 ELSE false END) THEN RAISE EXCEPTION 'Enter the number of days, from 1 to 365' USING ERRCODE='23514'; END IF;
 IF p_key='AUDIT_FILE_LOCK_ANCHOR' AND btrim(COALESCE(p_value,'')) NOT IN('REPORT_DATE','YEAR_END') THEN RAISE EXCEPTION 'Choose the audit report date or the financial year end' USING ERRCODE='23514'; END IF;
 IF p_key='SACCO_DT_REQUIRES_EQCR' AND btrim(COALESCE(p_value,'')) NOT IN('true','false') THEN RAISE EXCEPTION 'Choose yes or no' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.system_settings SET value=btrim(p_value),note=btrim(p_note),updated_by=a.staff_id WHERE key=p_key;
 RETURN jsonb_build_object('ok',true);
END $$;

-- ---- Audit report date and the assembly deadline -----------------------------------------------------------------------------------
ALTER TABLE erp_private.audit_files ADD COLUMN audit_report_date date;
ALTER TABLE erp_private.audit_files ADD COLUMN audit_report_date_set_by uuid REFERENCES erp_private.staff_members;
ALTER TABLE erp_private.audit_files ADD COLUMN audit_report_date_set_at timestamptz;
CREATE INDEX audit_files_report_date_by_idx ON erp_private.audit_files(audit_report_date_set_by);

CREATE FUNCTION erp_private.audit_report_date_save(p_file uuid,p_date date,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner sets the audit report date' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status='Archived' THEN RAISE EXCEPTION 'The audit file is archived' USING ERRCODE='23514'; END IF;
 IF p_date IS NULL OR p_date<=f.ends_on THEN RAISE EXCEPTION 'The audit report date must be after the end of the audit period' USING ERRCODE='23514'; END IF;
 IF f.audit_report_date IS NOT NULL AND length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why the report date is changing, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_files SET audit_report_date=p_date,audit_report_date_set_by=a.staff_id,audit_report_date_set_at=now() WHERE audit_file_id=f.audit_file_id;
 INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
  VALUES(auth.uid(),current_user,'audit_files','REPORT_DATE_SET',f.audit_file_id::text,jsonb_build_object('audit_report_date',f.audit_report_date),jsonb_build_object('audit_report_date',p_date,'reason',btrim(COALESCE(p_note,'')),'by',a.staff_id));
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_assembly_deadline(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;days integer;anchor text;conf boolean;anchor_date date;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 SELECT value::integer,updated_by IS NOT NULL INTO days,conf FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_DAYS';
 SELECT value INTO anchor FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_ANCHOR';
 anchor_date:=CASE anchor WHEN 'YEAR_END' THEN f.ends_on ELSE f.audit_report_date END;
 RETURN jsonb_build_object('days',days,'anchor',anchor,'anchor_date',anchor_date,'deadline',CASE WHEN anchor_date IS NULL THEN NULL ELSE anchor_date+days END,
  'days_confirmed',COALESCE(conf,false),'anchor_confirmed',(SELECT updated_by IS NOT NULL FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_ANCHOR'),
  'waiting_for','' || CASE WHEN anchor_date IS NULL THEN 'the audit report date' ELSE '' END,'report_date',f.audit_report_date);
END $$;

-- ---- SASRA eligibility log ----------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.sasra_verification_logs(
 log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 firm_id uuid NOT NULL REFERENCES erp_private.firms,
 financial_year integer NOT NULL CHECK(financial_year BETWEEN 2000 AND 2100),
 is_approved boolean NOT NULL,
 listing_reference text NOT NULL CHECK(length(btrim(listing_reference))>=5),
 proof_document_id uuid REFERENCES erp_private.documents,
 appointment_reference text NOT NULL DEFAULT '',
 independence_note text NOT NULL CHECK(length(btrim(independence_note))>=10),
 confirmed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT is_approved OR proof_document_id IS NOT NULL),
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links(client_id,firm_id)
);
CREATE INDEX sasra_verification_logs_lookup_idx ON erp_private.sasra_verification_logs(client_id,firm_id,financial_year,confirmed_at DESC);
CREATE INDEX sasra_verification_logs_doc_idx ON erp_private.sasra_verification_logs(proof_document_id);
CREATE INDEX sasra_verification_logs_by_idx ON erp_private.sasra_verification_logs(confirmed_by);
CREATE INDEX sasra_verification_logs_firm_idx ON erp_private.sasra_verification_logs(firm_id);

CREATE FUNCTION erp_private.sasra_eligible(p_client uuid,p_firm uuid,p_year integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT l.is_approved FROM erp_private.sasra_verification_logs l WHERE l.client_id=p_client AND l.firm_id=p_firm AND l.financial_year=p_year ORDER BY l.confirmed_at DESC,l.log_id LIMIT 1),false)
$$;

CREATE FUNCTION erp_private.sasra_eligibility_record(p_client uuid,p_firm uuid,p_year integer,p_approved boolean,p_listing text,p_doc uuid,p_appointment text,p_independence text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_id uuid;d erp_private.documents;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can confirm SASRA auditor eligibility' USING ERRCODE='42501'; END IF;
 IF erp_private.client_sacco_type(p_client)='NOT_SACCO' THEN RAISE EXCEPTION 'This client is not classified as a SACCO' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.staff_firm_access s WHERE s.staff_id=a.staff_id AND s.firm_id=p_firm AND s.deleted_at IS NULL) THEN RAISE EXCEPTION 'You do not have access to that firm' USING ERRCODE='42501'; END IF;
 IF p_approved THEN
  SELECT * INTO d FROM erp_private.documents WHERE document_id=p_doc AND client_id=p_client AND handling_firm_id=p_firm AND deleted_at IS NULL;
  IF d.document_id IS NULL THEN RAISE EXCEPTION 'Attach the SASRA approved auditor list that was uploaded for this client' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO erp_private.sasra_verification_logs(client_id,firm_id,financial_year,is_approved,listing_reference,proof_document_id,appointment_reference,independence_note,confirmed_by)
 VALUES(p_client,p_firm,p_year,p_approved,btrim(COALESCE(p_listing,'')),CASE WHEN p_approved THEN p_doc END,btrim(COALESCE(p_appointment,'')),btrim(COALESCE(p_independence,'')),a.staff_id) RETURNING log_id INTO v_id;
 RETURN jsonb_build_object('ok',true,'log_id',v_id);
END $$;

-- A SACCO statutory-audit project, and its audit file, cannot be created without a current eligibility record.
CREATE FUNCTION erp_private.sasra_project_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE y integer:=EXTRACT(year FROM CURRENT_DATE)::integer;
BEGIN
 IF NEW.service_code='AUD-STAT' AND erp_private.client_sacco_type(NEW.client_id)<>'NOT_SACCO'
  AND NOT (erp_private.sasra_eligible(NEW.client_id,NEW.handling_firm_id,y) OR erp_private.sasra_eligible(NEW.client_id,NEW.handling_firm_id,y-1)) THEN
  RAISE EXCEPTION 'Partner must verify SASRA auditor eligibility first. A Partner records it for the client and financial year, with the approved auditor list, before a SACCO audit project is created.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sasra_project_gate BEFORE INSERT ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.sasra_project_gate();

CREATE FUNCTION erp_private.sasra_file_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.is_demonstration IS NOT TRUE AND EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.service_code='AUD-STAT')
  AND erp_private.client_sacco_type(NEW.client_id)<>'NOT_SACCO'
  AND NOT erp_private.sasra_eligible(NEW.client_id,NEW.handling_firm_id,EXTRACT(year FROM NEW.ends_on)::integer) THEN
  RAISE EXCEPTION 'Partner must verify SASRA auditor eligibility for financial year % first.',EXTRACT(year FROM NEW.ends_on)::integer USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sasra_file_gate BEFORE INSERT ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.sasra_file_gate();

-- ---- Quality logs and the EQCR -------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.audit_quality_logs(
 log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL REFERENCES erp_private.audit_files,
 kind text NOT NULL CHECK(kind IN('EQCR approved','EQCR returned','EQCR approval void','Breach acknowledged')),
 ratio_id uuid,
 value_seen text,
 note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind='EQCR approval void' OR (created_by IS NOT NULL AND length(btrim(note))>=20))
);
CREATE INDEX audit_quality_logs_file_idx ON erp_private.audit_quality_logs(audit_file_id,created_at DESC);
CREATE INDEX audit_quality_logs_by_idx ON erp_private.audit_quality_logs(created_by);

CREATE FUNCTION erp_private.audit_eqcr_required(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT (erp_private.client_sacco_type(f.client_id)='DT_SACCO' AND (SELECT value FROM erp_private.system_settings WHERE key='SACCO_DT_REQUIRES_EQCR')='true')
   OR COALESCE((SELECT e.eqr_required FROM erp_private.engagement_controls e WHERE e.project_id=f.project_id),false)
  FROM erp_private.audit_files f WHERE f.audit_file_id=p_file),false)
$$;

-- Why a Partner cannot be the EQCR Partner on a file: any real part in the engagement.
CREATE FUNCTION erp_private.audit_eqcr_conflicts(p_file uuid,p_staff uuid) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;r text[]:=ARRAY[]::text[];
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN ARRAY['unknown file']; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.project_assignments x WHERE x.project_id=f.project_id AND x.staff_id=p_staff AND x.deleted_at IS NULL) THEN r:=array_append(r,'assigned to the engagement'); END IF;
 IF f.created_by=p_staff OR f.framework_approved_by=p_staff THEN r:=array_append(r,'created the file or approved its reporting framework'); END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_workpapers w WHERE w.audit_file_id=f.audit_file_id AND p_staff IN(w.prepared_by,w.reviewer_id)) THEN r:=array_append(r,'prepared or reviewed a working paper'); END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_adjustments w WHERE w.audit_file_id=f.audit_file_id AND p_staff IN(w.prepared_by,w.reviewer_id)) THEN r:=array_append(r,'prepared or reviewed an adjustment'); END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_reports w WHERE w.audit_file_id=f.audit_file_id AND p_staff IN(w.prepared_by,w.reviewer_id)) THEN r:=array_append(r,'prepared or reviewed a report'); END IF;
 IF EXISTS(SELECT 1 FROM erp_private.timesheets t WHERE t.project_id=f.project_id AND t.staff_id=p_staff AND t.deleted_at IS NULL) THEN r:=array_append(r,'logged time on the engagement'); END IF;
 RETURN r;
END $$;

CREATE FUNCTION erp_private.audit_eqcr_status(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;req boolean;last record;elig integer;mine text[];
BEGIN
 a:=erp_private.actor();
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL OR a.staff_id IS NULL THEN RETURN NULL; END IF;
 req:=erp_private.audit_eqcr_required(p_file);
 SELECT q.kind,q.created_at,q.note,s.full_name INTO last FROM erp_private.audit_quality_logs q LEFT JOIN erp_private.staff_members s ON s.staff_id=q.created_by
  WHERE q.audit_file_id=p_file AND q.kind LIKE 'EQCR%' ORDER BY q.created_at DESC,q.log_id DESC LIMIT 1;
 SELECT count(*)::integer INTO elig FROM erp_private.staff_members m WHERE m.category_code='PARTNER' AND m.access_status='Active'
  AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access x WHERE x.staff_id=m.staff_id AND x.firm_id=f.handling_firm_id AND x.deleted_at IS NULL)
  AND cardinality(erp_private.audit_eqcr_conflicts(p_file,m.staff_id))=0;
 mine:=CASE WHEN a.category_code='PARTNER' THEN erp_private.audit_eqcr_conflicts(p_file,a.staff_id) ELSE NULL END;
 RETURN jsonb_build_object('required',req,'approved',COALESCE(last.kind='EQCR approved',false),'last_kind',last.kind,'last_at',last.created_at,'last_by',last.full_name,'last_note',last.note,
  'eligible_partners',elig,'can_act',a.category_code='PARTNER' AND cardinality(mine)=0 AND f.file_status='In Review','my_conflicts',to_jsonb(mine),'file_status',f.file_status);
END $$;

CREATE FUNCTION erp_private.audit_eqcr_decide(p_file uuid,p_approve boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;c text[];
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can act as the EQCR Partner' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.audit_eqcr_required(p_file) THEN RAISE EXCEPTION 'This file does not need an EQCR' USING ERRCODE='23514'; END IF;
 IF f.file_status<>'In Review' THEN RAISE EXCEPTION 'The EQCR is given while the file is In Review' USING ERRCODE='23514'; END IF;
 c:=erp_private.audit_eqcr_conflicts(p_file,a.staff_id);
 IF cardinality(c)>0 THEN RAISE EXCEPTION 'You cannot be the EQCR Partner on this file: you %', array_to_string(c,'; ') USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<20 THEN RAISE EXCEPTION 'Record what you reviewed, in at least 20 characters' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.audit_quality_logs(audit_file_id,kind,note,created_by) VALUES(p_file,CASE WHEN p_approve THEN 'EQCR approved' ELSE 'EQCR returned' END,btrim(p_note),a.staff_id);
 IF NOT p_approve THEN UPDATE erp_private.audit_files SET file_status='Returned' WHERE audit_file_id=p_file; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- An approval does not survive the file being returned for changes.
CREATE FUNCTION erp_private.audit_eqcr_void() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.file_status='Returned' AND OLD.file_status IS DISTINCT FROM 'Returned'
  AND COALESCE((SELECT q.kind FROM erp_private.audit_quality_logs q WHERE q.audit_file_id=NEW.audit_file_id AND q.kind LIKE 'EQCR%' ORDER BY q.created_at DESC,q.log_id DESC LIMIT 1),'')='EQCR approved' THEN
  INSERT INTO erp_private.audit_quality_logs(audit_file_id,kind,note) VALUES(NEW.audit_file_id,'EQCR approval void','The file was returned for changes after the EQCR was given.');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_eqcr_void AFTER UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_eqcr_void();

-- A deposit-taking SACCO audit always carries the EQR flag while the Partner setting is on.
CREATE FUNCTION erp_private.sacco_eqcr_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.service_code LIKE 'AUD-%' AND erp_private.client_sacco_type(p.client_id)='DT_SACCO')
  AND (SELECT value FROM erp_private.system_settings WHERE key='SACCO_DT_REQUIRES_EQCR')='true' THEN NEW.eqr_required:=true; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sacco_eqcr_required BEFORE INSERT OR UPDATE ON erp_private.engagement_controls FOR EACH ROW EXECUTE FUNCTION erp_private.sacco_eqcr_required();

-- ---- SASRA ratio table ---------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.sasra_figure_lines(
 line_code text PRIMARY KEY CHECK(line_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
 label text NOT NULL,
 definition text NOT NULL DEFAULT '',
 defined_by uuid REFERENCES erp_private.staff_members,
 defined_at timestamptz,
 sort_order integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((defined_by IS NULL AND defined_at IS NULL) OR (defined_by IS NOT NULL AND defined_at IS NOT NULL AND length(btrim(definition))>=10))
);
CREATE INDEX sasra_figure_lines_by_idx ON erp_private.sasra_figure_lines(defined_by);
INSERT INTO erp_private.sasra_figure_lines(line_code,label,sort_order) VALUES
 ('CORE_CAPITAL','Core capital',1),('INSTITUTIONAL_CAPITAL','Institutional capital',2),('TOTAL_ASSETS','Total assets',3),('TOTAL_DEPOSITS','Total deposits',4),
 ('LIQUID_ASSETS','Liquid assets',5),('SAVINGS_AND_SHORT_TERM_LIABILITIES','Savings deposits and short-term liabilities',6),('RETAINED_EARNINGS','Retained earnings',7),
 ('TOTAL_LOANS','Gross loan portfolio',8)
ON CONFLICT DO NOTHING;

CREATE TABLE erp_private.sasra_ratios(
 ratio_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ratio_code text NOT NULL CHECK(ratio_code ~ '^[A-Z][A-Z0-9_]{2,60}$'),
 label text NOT NULL CHECK(length(btrim(label))>=3),
 sacco_type text NOT NULL CHECK(sacco_type IN('DT_SACCO','NWDT_SACCO')),
 client_id uuid REFERENCES erp_private.clients,
 measure text NOT NULL CHECK(measure IN('Percentage','Amount KES')),
 comparator text NOT NULL CHECK(comparator IN('At least','At most')),
 threshold numeric(20,4) NOT NULL CHECK(threshold>=0),
 numerator_line text NOT NULL REFERENCES erp_private.sasra_figure_lines,
 denominator_line text REFERENCES erp_private.sasra_figure_lines,
 effective_from date NOT NULL,
 effective_to date,
 reference_id uuid REFERENCES erp_private.legal_references,
 proof_document_id uuid REFERENCES erp_private.documents,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Active','Superseded')),
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 confirmation_note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((measure='Percentage' AND denominator_line IS NOT NULL) OR (measure='Amount KES' AND denominator_line IS NULL)),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(status='Draft' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND reference_id IS NOT NULL AND length(btrim(confirmation_note))>=10))
);
CREATE INDEX sasra_ratios_ref_idx ON erp_private.sasra_ratios(reference_id);
CREATE INDEX sasra_ratios_doc_idx ON erp_private.sasra_ratios(proof_document_id);
CREATE INDEX sasra_ratios_client_idx ON erp_private.sasra_ratios(client_id);
CREATE INDEX sasra_ratios_num_idx ON erp_private.sasra_ratios(numerator_line);
CREATE INDEX sasra_ratios_den_idx ON erp_private.sasra_ratios(denominator_line);
CREATE INDEX sasra_ratios_conf_idx ON erp_private.sasra_ratios(confirmed_by);
CREATE INDEX sasra_ratios_created_idx ON erp_private.sasra_ratios(created_by);
CREATE UNIQUE INDEX sasra_ratios_active_uq ON erp_private.sasra_ratios(ratio_code,sacco_type,COALESCE(client_id,'00000000-0000-0000-0000-000000000000'::uuid),effective_from) WHERE status='Active';

CREATE TABLE erp_private.sasra_file_figures(
 figure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL REFERENCES erp_private.audit_files,
 line_code text NOT NULL REFERENCES erp_private.sasra_figure_lines,
 amount numeric(20,2) NOT NULL CHECK(amount>=0),
 source_note text NOT NULL CHECK(length(btrim(source_note))>=5),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members,
 entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sasra_file_figures_file_idx ON erp_private.sasra_file_figures(audit_file_id,line_code,entered_at DESC);
CREATE INDEX sasra_file_figures_line_idx ON erp_private.sasra_file_figures(line_code);
CREATE INDEX sasra_file_figures_by_idx ON erp_private.sasra_file_figures(entered_by);

DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['sasra_verification_logs','audit_quality_logs','sasra_figure_lines','sasra_ratios','sasra_file_figures'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['sasra_verification_logs','audit_quality_logs','sasra_file_figures'] LOOP
  EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change()',t);
  EXECUTE format('CREATE TRIGGER change_audit AFTER INSERT ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',t,CASE t WHEN 'sasra_file_figures' THEN 'figure_id' ELSE 'log_id' END);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['sasra_figure_lines','sasra_ratios'] LOOP
  EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',t);
  EXECUTE format('CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',t,CASE t WHEN 'sasra_figure_lines' THEN 'line_code' ELSE 'ratio_id' END);
 END LOOP;
END $do$;

CREATE FUNCTION erp_private.sasra_line_define(p_line text,p_definition text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner confirms what a SASRA figure means' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_definition,'')))<10 THEN RAISE EXCEPTION 'Write the definition, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.sasra_figure_lines SET definition=btrim(p_definition),defined_by=a.staff_id,defined_at=now() WHERE line_code=p_line;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown figure line' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sasra_ratio_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.sasra_ratios;v_id uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner prepares the SASRA ratio table' USING ERRCODE='42501'; END IF;
 IF NULLIF(p->>'ratio_id','') IS NULL THEN
  INSERT INTO erp_private.sasra_ratios(ratio_code,label,sacco_type,client_id,measure,comparator,threshold,numerator_line,denominator_line,effective_from,effective_to,reference_id,proof_document_id,created_by)
  VALUES(upper(btrim(p->>'ratio_code')),btrim(p->>'label'),p->>'sacco_type',NULLIF(p->>'client_id','')::uuid,p->>'measure',p->>'comparator',(p->>'threshold')::numeric,p->>'numerator_line',NULLIF(p->>'denominator_line',''),
   (p->>'effective_from')::date,NULLIF(p->>'effective_to','')::date,NULLIF(p->>'reference_id','')::uuid,NULLIF(p->>'proof_document_id','')::uuid,a.staff_id) RETURNING ratio_id INTO v_id;
  RETURN jsonb_build_object('ok',true,'ratio_id',v_id);
 END IF;
 SELECT * INTO r FROM erp_private.sasra_ratios WHERE ratio_id=(p->>'ratio_id')::uuid FOR UPDATE;
 IF r.ratio_id IS NULL THEN RAISE EXCEPTION 'Ratio not found' USING ERRCODE='P0002'; END IF;
 IF r.status<>'Draft' THEN RAISE EXCEPTION 'An active ratio cannot be edited. Retire it and add a new one with a new effective date.' USING ERRCODE='23514'; END IF;
 IF p ? 'revision' AND (p->>'revision')::bigint<>r.revision THEN RAISE EXCEPTION 'This ratio changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 UPDATE erp_private.sasra_ratios SET label=btrim(p->>'label'),sacco_type=p->>'sacco_type',client_id=NULLIF(p->>'client_id','')::uuid,measure=p->>'measure',comparator=p->>'comparator',threshold=(p->>'threshold')::numeric,
  numerator_line=p->>'numerator_line',denominator_line=NULLIF(p->>'denominator_line',''),effective_from=(p->>'effective_from')::date,effective_to=NULLIF(p->>'effective_to','')::date,
  reference_id=NULLIF(p->>'reference_id','')::uuid,proof_document_id=NULLIF(p->>'proof_document_id','')::uuid WHERE ratio_id=r.ratio_id;
 RETURN jsonb_build_object('ok',true,'ratio_id',r.ratio_id);
END $$;

CREATE FUNCTION erp_private.sasra_ratio_activate(p_ratio uuid,p_note text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.sasra_ratios;ref erp_private.legal_references;n text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can confirm and activate a SASRA ratio' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM erp_private.sasra_ratios WHERE ratio_id=p_ratio FOR UPDATE;
 IF r.ratio_id IS NULL THEN RAISE EXCEPTION 'Ratio not found' USING ERRCODE='P0002'; END IF;
 IF p_revision IS NOT NULL AND p_revision<>r.revision THEN RAISE EXCEPTION 'This ratio changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 IF r.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft ratio can be activated' USING ERRCODE='23514'; END IF;
 IF r.reference_id IS NULL THEN RAISE EXCEPTION 'Link the SASRA source (regulation, circular or supervision report) first' USING ERRCODE='23514'; END IF;
 SELECT * INTO ref FROM erp_private.legal_references WHERE ref_id=r.reference_id;
 IF ref.verification<>'Primary source verified' THEN RAISE EXCEPTION 'The linked source "%" is not verified from the primary source. Verify it in the legal references first.',ref.title USING ERRCODE='23514'; END IF;
 FOR n IN SELECT l.label FROM erp_private.sasra_figure_lines l WHERE l.line_code IN(r.numerator_line,COALESCE(r.denominator_line,r.numerator_line)) AND l.defined_by IS NULL LOOP
  RAISE EXCEPTION 'A Partner must confirm the definition of "%" before a ratio that uses it is activated.',n USING ERRCODE='23514';
 END LOOP;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record the source page or paragraph you checked, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.sasra_ratios SET status='Active',confirmed_by=a.staff_id,confirmed_at=now(),confirmation_note=btrim(p_note) WHERE ratio_id=r.ratio_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sasra_ratio_retire(p_ratio uuid,p_end date,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.sasra_ratios;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can retire a SASRA ratio' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM erp_private.sasra_ratios WHERE ratio_id=p_ratio FOR UPDATE;
 IF r.ratio_id IS NULL OR r.status<>'Active' THEN RAISE EXCEPTION 'Only an active ratio can be retired' USING ERRCODE='23514'; END IF;
 IF p_end IS NOT NULL AND p_end<r.effective_from THEN RAISE EXCEPTION 'The end date cannot be before the effective date' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.sasra_ratios SET status='Superseded',effective_to=COALESCE(p_end,effective_to),confirmation_note=confirmation_note||E'\nRetired: '||btrim(p_note) WHERE ratio_id=r.ratio_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sasra_figure_save(p_file uuid,p_line text,p_amount numeric,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'An audit staff member enters the prudential figures' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF erp_private.client_sacco_type(f.client_id)='NOT_SACCO' THEN RAISE EXCEPTION 'This file is not for a SACCO' USING ERRCODE='23514'; END IF;
 IF f.file_status NOT IN('Draft','Prepared','Returned') THEN RAISE EXCEPTION 'Prudential figures are locked once the file is sent for review' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.sasra_file_figures(audit_file_id,line_code,amount,source_note,entered_by) VALUES(p_file,p_line,p_amount,btrim(COALESCE(p_note,'')),a.staff_id);
 RETURN jsonb_build_object('ok',true);
END $$;

-- The check itself: one row per active ratio that applies to this file. Nothing is assumed when a figure or a ratio is missing.
CREATE FUNCTION erp_private.sasra_breach_check(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;res jsonb:='[]'::jsonb;r record;num numeric;den numeric;val numeric;met boolean;state text;ack record;vtxt text;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF st='NOT_SACCO' THEN RETURN NULL; END IF;
 FOR r IN
  SELECT DISTINCT ON (x.ratio_code) x.* FROM erp_private.sasra_ratios x
  WHERE x.status='Active' AND x.sacco_type=st AND (x.client_id IS NULL OR x.client_id=f.client_id) AND x.effective_from<=f.ends_on AND (x.effective_to IS NULL OR x.effective_to>=f.ends_on)
  ORDER BY x.ratio_code,(x.client_id IS NOT NULL) DESC,x.effective_from DESC
 LOOP
  SELECT amount INTO num FROM erp_private.sasra_file_figures WHERE audit_file_id=p_file AND line_code=r.numerator_line ORDER BY entered_at DESC,figure_id LIMIT 1;
  den:=NULL;
  IF r.denominator_line IS NOT NULL THEN SELECT amount INTO den FROM erp_private.sasra_file_figures WHERE audit_file_id=p_file AND line_code=r.denominator_line ORDER BY entered_at DESC,figure_id LIMIT 1; END IF;
  val:=NULL;met:=NULL;state:='Figures missing';
  IF r.measure='Amount KES' AND num IS NOT NULL THEN val:=num;
  ELSIF r.measure='Percentage' AND num IS NOT NULL AND den IS NOT NULL AND den>0 THEN val:=num*100/den;
  ELSIF r.measure='Percentage' AND den=0 THEN state:='Denominator is zero'; END IF;
  IF val IS NOT NULL THEN
   met:=CASE r.comparator WHEN 'At least' THEN val>=r.threshold ELSE val<=r.threshold END;
   state:=CASE WHEN met THEN 'Met' ELSE 'Breach' END;
  END IF;
  vtxt:=CASE WHEN val IS NULL THEN NULL ELSE round(val,4)::text END;
  SELECT q.created_at,q.value_seen,s.full_name INTO ack FROM erp_private.audit_quality_logs q LEFT JOIN erp_private.staff_members s ON s.staff_id=q.created_by
   WHERE q.audit_file_id=p_file AND q.kind='Breach acknowledged' AND q.ratio_id=r.ratio_id ORDER BY q.created_at DESC,q.log_id DESC LIMIT 1;
  res:=res||jsonb_build_array(jsonb_build_object('ratio_id',r.ratio_id,'ratio_code',r.ratio_code,'label',r.label,'measure',r.measure,'comparator',r.comparator,'threshold',r.threshold,'client_specific',r.client_id IS NOT NULL,
   'numerator_line',r.numerator_line,'denominator_line',r.denominator_line,'numerator',num,'denominator',den,'value',vtxt,'state',state,
   'acknowledged',(state='Breach' AND ack.value_seen IS NOT NULL AND ack.value_seen=vtxt),'ack_by',ack.full_name,'ack_at',ack.created_at,'ack_stale',(state='Breach' AND ack.value_seen IS NOT NULL AND ack.value_seen<>vtxt)));
 END LOOP;
 RETURN res;
END $$;

CREATE FUNCTION erp_private.sasra_breach_ack(p_file uuid,p_ratio uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;row jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can acknowledge a regulatory breach' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<20 THEN RAISE EXCEPTION 'Record how the breach affects the audit report, in at least 20 characters' USING ERRCODE='23514'; END IF;
 SELECT x INTO row FROM jsonb_array_elements(COALESCE(erp_private.sasra_breach_check(p_file),'[]'::jsonb)) x WHERE (x->>'ratio_id')::uuid=p_ratio;
 IF row IS NULL OR row->>'state'<>'Breach' THEN RAISE EXCEPTION 'That ratio is not in breach on this file' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.audit_quality_logs(audit_file_id,kind,ratio_id,value_seen,note,created_by) VALUES(p_file,'Breach acknowledged',p_ratio,row->>'value',btrim(p_note),a.staff_id);
 RETURN jsonb_build_object('ok',true);
END $$;

-- What stops final sign-off on a SACCO file. Empty list = nothing stops it.
CREATE FUNCTION erp_private.sasra_signoff_issues(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;chk jsonb;x jsonb;issues jsonb:='[]'::jsonb;eq jsonb;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN '[]'::jsonb; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF st='NOT_SACCO' THEN RETURN '[]'::jsonb; END IF;
 IF NOT erp_private.sasra_eligible(f.client_id,f.handling_firm_id,EXTRACT(year FROM f.ends_on)::integer) AND NOT f.is_demonstration THEN
  issues:=issues||to_jsonb('SASRA auditor eligibility for financial year '||EXTRACT(year FROM f.ends_on)::integer||' is not confirmed by a Partner.'::text); END IF;
 chk:=erp_private.sasra_breach_check(p_file);
 IF chk IS NULL OR jsonb_array_length(chk)=0 THEN
  issues:=issues||to_jsonb('No SASRA ratio is confirmed for this type of SACCO and year end. A Partner must confirm the ratios first.'::text);
 ELSE
  FOR x IN SELECT * FROM jsonb_array_elements(chk) LOOP
   IF x->>'state'<>'Met' AND x->>'state'<>'Breach' THEN issues:=issues||to_jsonb(('Enter the figures for '||(x->>'label')||' ('||(x->>'state')||').')::text);
   ELSIF x->>'state'='Breach' AND NOT (x->>'acknowledged')::boolean THEN issues:=issues||to_jsonb(('Regulatory breach not acknowledged by a Partner: '||(x->>'label')||' is '||(x->>'value')||'.')::text); END IF;
  END LOOP;
 END IF;
 eq:=erp_private.audit_eqcr_status(p_file);
 IF erp_private.audit_eqcr_required(p_file) AND NOT COALESCE((eq->>'approved')::boolean,false) THEN issues:=issues||to_jsonb('EQCR Partner approval required before final sign-off.'::text); END IF;
 RETURN issues;
END $$;

-- Reads for the screens.
CREATE FUNCTION erp_private.sasra_file_overview(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code='INTERN' THEN RETURN NULL; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF st='NOT_SACCO' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('sacco_type',st,'financial_year',EXTRACT(year FROM f.ends_on)::integer,
  'eligible',erp_private.sasra_eligible(f.client_id,f.handling_firm_id,EXTRACT(year FROM f.ends_on)::integer),
  'eligibility_log',COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('confirmed_by_name',s.full_name,'proof_file_name',d.file_name) ORDER BY l.confirmed_at DESC) FROM erp_private.sasra_verification_logs l
    JOIN erp_private.staff_members s ON s.staff_id=l.confirmed_by LEFT JOIN erp_private.documents d ON d.document_id=l.proof_document_id
    WHERE l.client_id=f.client_id AND l.firm_id=f.handling_firm_id AND l.financial_year=EXTRACT(year FROM f.ends_on)::integer),'[]'::jsonb),
  'eqcr',erp_private.audit_eqcr_status(p_file),'ratios',erp_private.sasra_breach_check(p_file),
  'figures',COALESCE((SELECT jsonb_agg(jsonb_build_object('line_code',l.line_code,'label',l.label,'defined',l.defined_by IS NOT NULL,'amount',g.amount,'source_note',g.source_note,'entered_at',g.entered_at,'entered_by_name',s.full_name) ORDER BY l.sort_order)
    FROM erp_private.sasra_figure_lines l LEFT JOIN LATERAL (SELECT * FROM erp_private.sasra_file_figures x WHERE x.audit_file_id=p_file AND x.line_code=l.line_code ORDER BY x.entered_at DESC,x.figure_id LIMIT 1) g ON true
    LEFT JOIN erp_private.staff_members s ON s.staff_id=g.entered_by),'[]'::jsonb),
  'assembly',erp_private.audit_assembly_deadline(p_file),'issues',erp_private.sasra_signoff_issues(p_file),
  'quality_log',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',q.kind,'note',q.note,'created_at',q.created_at,'by',s.full_name) ORDER BY q.created_at DESC) FROM erp_private.audit_quality_logs q LEFT JOIN erp_private.staff_members s ON s.staff_id=q.created_by WHERE q.audit_file_id=p_file),'[]'::jsonb));
END $$;

CREATE FUNCTION erp_private.sasra_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object(
  'policy',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',s.key,'value',s.value,'note',s.note,'confirmed',s.updated_by IS NOT NULL,'confirmed_by_name',m.full_name,'updated_at',s.updated_at,'revision',s.revision) ORDER BY s.key)
    FROM erp_private.system_settings s LEFT JOIN erp_private.staff_members m ON m.staff_id=s.updated_by WHERE s.key IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','SACCO_DT_REQUIRES_EQCR')),'[]'::jsonb),
  'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('defined_by_name',m.full_name) ORDER BY l.sort_order) FROM erp_private.sasra_figure_lines l LEFT JOIN erp_private.staff_members m ON m.staff_id=l.defined_by),'[]'::jsonb),
  'ratios',COALESCE((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('confirmed_by_name',m.full_name,'reference_title',lr.title,'client_name',c.company_name) ORDER BY r.sacco_type,r.ratio_code,r.effective_from DESC)
    FROM erp_private.sasra_ratios r LEFT JOIN erp_private.staff_members m ON m.staff_id=r.confirmed_by LEFT JOIN erp_private.legal_references lr ON lr.ref_id=r.reference_id LEFT JOIN erp_private.clients c ON c.client_id=r.client_id),'[]'::jsonb),
  'saccos',COALESCE((SELECT jsonb_agg(jsonb_build_object('client_id',c.client_id,'company_name',c.company_name,'sacco_type',erp_private.client_sacco_type(c.client_id),
      'firm_id',l.firm_id,'firm_code',fm.firm_code,
      'records',COALESCE((SELECT jsonb_agg(jsonb_build_object('financial_year',z.financial_year,'is_approved',z.is_approved,'confirmed_at',z.confirmed_at,'listing_reference',z.listing_reference)) FROM
         (SELECT DISTINCT ON (v.financial_year) v.* FROM erp_private.sasra_verification_logs v WHERE v.client_id=c.client_id AND v.firm_id=l.firm_id ORDER BY v.financial_year DESC,v.confirmed_at DESC,v.log_id) z),'[]'::jsonb))
      ORDER BY c.company_name)
    FROM erp_private.clients c JOIN erp_private.client_firm_links l ON l.client_id=c.client_id JOIN erp_private.firms fm ON fm.firm_id=l.firm_id
    WHERE c.deleted_at IS NULL AND erp_private.client_sacco_type(c.client_id)<>'NOT_SACCO'),'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION erp_private.audit_policy_save(text,text,text),erp_private.audit_report_date_save(uuid,date,text),erp_private.audit_assembly_deadline(uuid),erp_private.sasra_eligible(uuid,uuid,integer),
 erp_private.sasra_eligibility_record(uuid,uuid,integer,boolean,text,uuid,text,text),erp_private.audit_eqcr_required(uuid),erp_private.audit_eqcr_conflicts(uuid,uuid),erp_private.audit_eqcr_status(uuid),
 erp_private.audit_eqcr_decide(uuid,boolean,text),erp_private.sasra_line_define(text,text),erp_private.sasra_ratio_save(jsonb),erp_private.sasra_ratio_activate(uuid,text,bigint),erp_private.sasra_ratio_retire(uuid,date,text),
 erp_private.sasra_figure_save(uuid,text,numeric,text),erp_private.sasra_breach_check(uuid),erp_private.sasra_breach_ack(uuid,uuid,text),erp_private.sasra_signoff_issues(uuid),erp_private.sasra_file_overview(uuid),erp_private.sasra_overview()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_policy_save(text,text,text),erp_private.audit_report_date_save(uuid,date,text),erp_private.audit_assembly_deadline(uuid),erp_private.sasra_eligible(uuid,uuid,integer),
 erp_private.sasra_eligibility_record(uuid,uuid,integer,boolean,text,uuid,text,text),erp_private.audit_eqcr_required(uuid),erp_private.audit_eqcr_conflicts(uuid,uuid),erp_private.audit_eqcr_status(uuid),
 erp_private.audit_eqcr_decide(uuid,boolean,text),erp_private.sasra_line_define(text,text),erp_private.sasra_ratio_save(jsonb),erp_private.sasra_ratio_activate(uuid,text,bigint),erp_private.sasra_ratio_retire(uuid,date,text),
 erp_private.sasra_figure_save(uuid,text,numeric,text),erp_private.sasra_breach_check(uuid),erp_private.sasra_breach_ack(uuid,uuid,text),erp_private.sasra_signoff_issues(uuid),erp_private.sasra_file_overview(uuid),erp_private.sasra_overview()
 TO erp_api;
