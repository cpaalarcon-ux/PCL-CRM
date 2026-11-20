-- Audit build S8.1: the assembly deadline can be extended by a Partner, with a reason, and every extension is kept.
--
--  The deadline is the firm's own deadline for assembling the audit file (default 60 days after the audit report date, a Partner confirms or
--  changes it: S3 settings). It is NOT a statutory filing date. Nothing here reads, moves or blocks a statutory deadline, and the lock only
--  stops changes to the audit file's own records.
--  A Partner may extend the deadline of a file that is not yet sealed: by a number of days, with a reason of at least 20 characters. Each
--  extension keeps who, when, how many days, the old deadline, the new deadline and the reason, and cannot be changed or deleted.
--  Whether a Partner may extend at all is a firm setting. The default is yes; it shows as not yet confirmed until a Partner confirms it.

ALTER TABLE erp_private.system_settings ADD CONSTRAINT system_settings_lock_extension CHECK(key<>'AUDIT_LOCK_EXTENSION_ALLOWED' OR value IN('true','false'));
INSERT INTO erp_private.system_settings(key,value,note) VALUES
 ('AUDIT_LOCK_EXTENSION_ALLOWED','true','Default: a Partner may extend the assembly deadline of a file, with a reason. A Partner confirms or switches this off.')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE erp_private.audit_lock_extensions (
 extension_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 seq integer NOT NULL CHECK(seq>0),
 extra_days integer NOT NULL CHECK(extra_days BETWEEN 1 AND 365),
 old_deadline date NOT NULL,
 new_deadline date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>=20),
 extended_by uuid NOT NULL REFERENCES erp_private.staff_members,
 extended_at timestamptz NOT NULL DEFAULT now(),
 CHECK(new_deadline=old_deadline+extra_days),
 UNIQUE(audit_file_id,seq),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_lock_extensions_by_idx ON erp_private.audit_lock_extensions(extended_by);
CREATE INDEX audit_lock_extensions_scope_idx ON erp_private.audit_lock_extensions(audit_file_id,project_id,handling_firm_id);
ALTER TABLE erp_private.audit_lock_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.audit_lock_extensions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.audit_lock_extensions TO erp_api;
CREATE POLICY audit_lock_extensions_read ON erp_private.audit_lock_extensions FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.audit_lock_extensions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.audit_lock_extensions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('extension_id');
CREATE FUNCTION erp_private.audit_lock_extension_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A lock extension cannot be changed' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.audit_lock_extensions FOR EACH ROW EXECUTE FUNCTION erp_private.audit_lock_extension_immutable();

-- The policy function now knows the extension setting.
CREATE OR REPLACE FUNCTION erp_private.audit_policy_save(p_key text,p_value text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can set firm audit policy' USING ERRCODE='42501'; END IF;
 IF p_key NOT IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT','AUDIT_DEADLINE_LOCK_ENFORCED','AUDIT_LOCK_EXTENSION_ALLOWED') THEN RAISE EXCEPTION 'Unknown policy setting' USING ERRCODE='22023'; END IF;
 IF p_key='AUDIT_FILE_LOCK_DAYS' AND NOT (btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' AND CASE WHEN btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' THEN btrim(p_value)::integer BETWEEN 1 AND 365 ELSE false END) THEN RAISE EXCEPTION 'Enter the number of days, from 1 to 365' USING ERRCODE='23514'; END IF;
 IF p_key='AUDIT_FILE_LOCK_ANCHOR' AND btrim(COALESCE(p_value,'')) NOT IN('REPORT_DATE','YEAR_END') THEN RAISE EXCEPTION 'Choose the audit report date or the financial year end' USING ERRCODE='23514'; END IF;
 IF p_key IN('SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT','AUDIT_DEADLINE_LOCK_ENFORCED','AUDIT_LOCK_EXTENSION_ALLOWED') AND btrim(COALESCE(p_value,'')) NOT IN('true','false') THEN RAISE EXCEPTION 'Choose yes or no' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.system_settings SET value=btrim(p_value),note=btrim(p_note),updated_by=a.staff_id WHERE key=p_key;
 RETURN jsonb_build_object('ok',true);
END $$;

-- The lock information includes the extensions.
CREATE OR REPLACE FUNCTION erp_private.audit_lock_info(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;days integer;anchor text;dconf boolean;aconf boolean;enf boolean;enf_conf boolean;anchor_date date;dl date;today date;sealed boolean;opn boolean;enforced boolean;past boolean;why text:='';v_extra integer;v_n integer;v_base date;v_ext_ok boolean;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 SELECT value::integer,updated_by IS NOT NULL INTO days,dconf FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_DAYS';
 SELECT value,updated_by IS NOT NULL INTO anchor,aconf FROM erp_private.system_settings WHERE key='AUDIT_FILE_LOCK_ANCHOR';
 SELECT value='true',updated_by IS NOT NULL INTO enf,enf_conf FROM erp_private.system_settings WHERE key='AUDIT_DEADLINE_LOCK_ENFORCED';
 anchor_date:=CASE anchor WHEN 'YEAR_END' THEN f.ends_on ELSE f.audit_report_date END;
 SELECT COALESCE(sum(extra_days),0)::integer,count(*)::integer INTO v_extra,v_n FROM erp_private.audit_lock_extensions WHERE audit_file_id=p_file;
 SELECT COALESCE(value='true',false) INTO v_ext_ok FROM erp_private.system_settings WHERE key='AUDIT_LOCK_EXTENSION_ALLOWED';
 v_base:=CASE WHEN anchor_date IS NULL THEN NULL ELSE anchor_date+days END;
 dl:=CASE WHEN v_base IS NULL THEN NULL ELSE v_base+v_extra END;
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
 RETURN jsonb_build_object('sealed',sealed,'amendment_open',opn,'enforced',enforced,'not_enforced_because',why,'deadline',dl,'base_deadline',v_base,'extra_days',v_extra,'extensions',v_n,'extension_allowed',COALESCE(v_ext_ok,false),'anchor',anchor,'anchor_date',anchor_date,'days',days,
  'past_deadline',past,'locked',(sealed OR past) AND NOT opn,'locked_by',CASE WHEN opn THEN NULL WHEN sealed THEN 'Assembly complete' WHEN past THEN 'Assembly deadline' ELSE NULL END);
END $$;

-- The Assembly tab also lists the extensions and the extension setting.
CREATE OR REPLACE FUNCTION erp_private.audit_assembly_workspace(p_file uuid) RETURNS jsonb
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
    FROM erp_private.system_settings s LEFT JOIN erp_private.staff_members m ON m.staff_id=s.updated_by WHERE s.key IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','AUDIT_DEADLINE_LOCK_ENFORCED','AUDIT_LOCK_EXTENSION_ALLOWED')),
  'milestones',COALESCE((SELECT jsonb_agg(jsonb_build_object('milestone_id',m.milestone_id,'seq',m.seq,'kind',m.kind,'label',m.label,'note',m.note,'file_status',m.file_status,'fingerprint',left(m.fingerprint,12),'taken_at',m.taken_at,'taken_by_name',s.full_name) ORDER BY m.seq)
    FROM erp_private.audit_milestones m JOIN erp_private.staff_members s ON s.staff_id=m.taken_by WHERE m.audit_file_id=p_file),'[]'::jsonb),
  'amendments',COALESCE((SELECT jsonb_agg(jsonb_build_object('amendment_id',x.amendment_id,'seq',x.seq,'reason',x.reason,'status',x.status,'opened_by',x.opened_by,'opened_by_name',o.full_name,'opened_at',x.opened_at,
      'closed_by_name',c.full_name,'closed_at',x.closed_at,'close_note',x.close_note,'changes',x.changes,'open_milestone_id',x.open_milestone_id,'close_milestone_id',x.close_milestone_id) ORDER BY x.seq)
    FROM erp_private.audit_amendments x JOIN erp_private.staff_members o ON o.staff_id=x.opened_by LEFT JOIN erp_private.staff_members c ON c.staff_id=x.closed_by WHERE x.audit_file_id=p_file),'[]'::jsonb),
  'extensions',COALESCE((SELECT jsonb_agg(jsonb_build_object('extension_id',e.extension_id,'seq',e.seq,'extra_days',e.extra_days,'old_deadline',e.old_deadline,'new_deadline',e.new_deadline,'reason',e.reason,'extended_by_name',s.full_name,'extended_at',e.extended_at) ORDER BY e.seq)
    FROM erp_private.audit_lock_extensions e JOIN erp_private.staff_members s ON s.staff_id=e.extended_by WHERE e.audit_file_id=p_file),'[]'::jsonb));
END $$;

-- A Partner extends the assembly deadline of a file that is not yet sealed.
CREATE FUNCTION erp_private.audit_lock_extend(p_file uuid,p_days integer,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;v_info jsonb;v_old date;v_new date;v_seq integer;v_today date;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner extends the assembly deadline' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE((SELECT value='true' FROM erp_private.system_settings WHERE key='AUDIT_LOCK_EXTENSION_ALLOWED'),false) THEN RAISE EXCEPTION 'Extending the assembly deadline is switched off in the firm settings' USING ERRCODE='23514'; END IF;
 IF f.file_status='Archived' THEN RAISE EXCEPTION 'The audit file is archived' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_assembly_seals WHERE audit_file_id=p_file) THEN RAISE EXCEPTION 'Assembly is already recorded as complete, so the file is locked. Open a late change instead' USING ERRCODE='23514'; END IF;
 v_info:=erp_private.audit_lock_info(p_file);
 v_old:=(v_info->>'deadline')::date;
 IF v_old IS NULL THEN RAISE EXCEPTION 'The assembly deadline is not known yet, because the date it runs from is not set' USING ERRCODE='23514'; END IF;
 IF p_days IS NULL OR p_days<1 OR p_days>365 THEN RAISE EXCEPTION 'Enter the number of days to add, from 1 to 365' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<20 THEN RAISE EXCEPTION 'Record why the deadline must be extended, in at least 20 characters' USING ERRCODE='23514'; END IF;
 v_new:=v_old+p_days;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 IF v_new<v_today THEN RAISE EXCEPTION 'The new deadline (%) would already have passed. Add more days', v_new USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(seq),0)+1 INTO v_seq FROM erp_private.audit_lock_extensions WHERE audit_file_id=p_file;
 INSERT INTO erp_private.audit_lock_extensions(audit_file_id,project_id,handling_firm_id,seq,extra_days,old_deadline,new_deadline,reason,extended_by) VALUES(p_file,f.project_id,f.handling_firm_id,v_seq,p_days,v_old,v_new,btrim(p_reason),a.staff_id);
 RETURN jsonb_build_object('ok',true,'old_deadline',v_old,'new_deadline',v_new);
END $$;

REVOKE ALL ON FUNCTION erp_private.audit_lock_extension_immutable() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_lock_extend(uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_lock_extend(uuid,integer,text) TO erp_api;
