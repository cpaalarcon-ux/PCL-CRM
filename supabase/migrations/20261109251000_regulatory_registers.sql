-- S2: three Partner-governed registers for SACCO (and later other regulated) audits.
--  * legal_references: each Act, regulation, circular, standard or Bill, with its legal status and how far it has been verified.
--  * regulatory_calendar: dated obligations, with the wording exactly as reported. No due date is computed until a Partner has entered
--    the rule and confirmed it against a primary-source reference. The wording of a rule is never rewritten by the ERP.
--  * legislative_monitor: things being watched (Bills, consultations, circulars) with an append-only log of each check.
-- Nothing here is a legal opinion. The seeded rows come from the legal verification report supplied by the Partner group and start
-- as Unverified / Unconfirmed; the figures in that report (capital, liquidity, loan classes) are NOT stored here, the Partner enters
-- them in the ratio table (S3) after checking the source.
CREATE TABLE erp_private.legal_references(
 ref_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ref_code text NOT NULL UNIQUE CHECK(ref_code ~ '^[A-Z0-9][A-Z0-9_.-]{2,60}$'),
 title text NOT NULL CHECK(length(btrim(title))>=3),
 instrument_type text NOT NULL CHECK(instrument_type IN('Act','Regulation','Circular','Guidance','Standard','Bill','Other')),
 citation text NOT NULL DEFAULT '',
 issuing_body text NOT NULL DEFAULT '',
 legal_status text NOT NULL DEFAULT 'Not yet confirmed' CHECK(legal_status IN('Not yet confirmed','In force','Binding direction','Guidance only','Consultation','Proposed (Bill)','Repealed')),
 applies_to text[] NOT NULL DEFAULT ARRAY['ALL_SACCO']::text[] CHECK(applies_to <@ ARRAY['DT_SACCO','NWDT_SACCO','ALL_SACCO','OTHER']::text[] AND cardinality(applies_to)>0),
 summary text NOT NULL DEFAULT '',
 source_url text NOT NULL DEFAULT '',
 verification text NOT NULL DEFAULT 'Unverified' CHECK(verification IN('Unverified','Secondary source','Primary source verified')),
 verified_by uuid REFERENCES erp_private.staff_members,
 verified_at timestamptz,
 verification_note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(verification='Unverified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND length(btrim(verification_note))>=10)),
 CHECK(verification<>'Primary source verified' OR (length(btrim(source_url))>=8 AND legal_status<>'Not yet confirmed')),
 CHECK(instrument_type<>'Bill' OR legal_status IN('Not yet confirmed','Proposed (Bill)','In force','Repealed'))
);
CREATE INDEX legal_references_verified_by_idx ON erp_private.legal_references(verified_by);
CREATE INDEX legal_references_created_by_idx ON erp_private.legal_references(created_by);

CREATE TABLE erp_private.regulatory_calendar(
 item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_code text NOT NULL UNIQUE CHECK(item_code ~ '^[A-Z0-9][A-Z0-9_.-]{2,60}$'),
 title text NOT NULL CHECK(length(btrim(title))>=3),
 reference_id uuid REFERENCES erp_private.legal_references,
 applies_to text[] NOT NULL DEFAULT ARRAY['ALL_SACCO']::text[] CHECK(applies_to <@ ARRAY['DT_SACCO','NWDT_SACCO','ALL_SACCO','OTHER']::text[] AND cardinality(applies_to)>0),
 as_reported text NOT NULL CHECK(length(btrim(as_reported))>=3),
 conflicting_wording text NOT NULL DEFAULT '',
 rule_type text NOT NULL DEFAULT 'Unresolved' CHECK(rule_type IN('Unresolved','Period after year end','Fixed date each year')),
 offset_months integer CHECK(offset_months BETWEEN 0 AND 24),
 offset_days integer CHECK(offset_days BETWEEN 0 AND 366),
 fixed_month integer CHECK(fixed_month BETWEEN 1 AND 12),
 fixed_day integer CHECK(fixed_day BETWEEN 1 AND 31),
 direction text CHECK(direction IN('On or before','Not earlier than','On')),
 status text NOT NULL DEFAULT 'Unconfirmed' CHECK(status IN('Unconfirmed','Confirmed')),
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 confirmation_note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(rule_type<>'Period after year end' OR (offset_months IS NOT NULL OR offset_days IS NOT NULL)),
 CHECK(rule_type<>'Fixed date each year' OR (fixed_month IS NOT NULL AND fixed_day IS NOT NULL)),
 CHECK(status='Unconfirmed' OR (rule_type<>'Unresolved' AND direction IS NOT NULL AND reference_id IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(confirmation_note))>=10))
);
CREATE INDEX regulatory_calendar_ref_idx ON erp_private.regulatory_calendar(reference_id);
CREATE INDEX regulatory_calendar_confirmed_by_idx ON erp_private.regulatory_calendar(confirmed_by);
CREATE INDEX regulatory_calendar_created_by_idx ON erp_private.regulatory_calendar(created_by);

CREATE TABLE erp_private.legislative_monitor(
 entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(btrim(title))>=3),
 item_type text NOT NULL CHECK(item_type IN('Bill','Regulation change','Circular','Consultation','Court decision','Standard','Other')),
 source_body text NOT NULL DEFAULT '',
 reference_id uuid REFERENCES erp_private.legal_references,
 status text NOT NULL DEFAULT 'Watching' CHECK(status IN('Watching','Reviewed - no change needed','Reviewed - action needed','Closed')),
 first_seen_on date NOT NULL DEFAULT CURRENT_DATE,
 last_checked_on date,
 next_check_due date,
 owner_id uuid REFERENCES erp_private.staff_members,
 note text NOT NULL DEFAULT '',
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'Closed' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE INDEX legislative_monitor_ref_idx ON erp_private.legislative_monitor(reference_id);
CREATE INDEX legislative_monitor_owner_idx ON erp_private.legislative_monitor(owner_id);
CREATE INDEX legislative_monitor_closed_by_idx ON erp_private.legislative_monitor(closed_by);
CREATE INDEX legislative_monitor_created_by_idx ON erp_private.legislative_monitor(created_by);

CREATE TABLE erp_private.legislative_monitor_checks(
 check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entry_id uuid NOT NULL REFERENCES erp_private.legislative_monitor,
 checked_on date NOT NULL,
 checked_by uuid NOT NULL REFERENCES erp_private.staff_members,
 outcome text NOT NULL CHECK(outcome IN('No change','Changed - needs review','Action needed','Closed')),
 note text NOT NULL CHECK(length(btrim(note))>=10),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX legislative_monitor_checks_entry_idx ON erp_private.legislative_monitor_checks(entry_id,checked_on DESC);
CREATE INDEX legislative_monitor_checks_by_idx ON erp_private.legislative_monitor_checks(checked_by);

DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['legal_references','regulatory_calendar','legislative_monitor','legislative_monitor_checks'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['legal_references','regulatory_calendar','legislative_monitor'] LOOP
  EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',t);
 END LOOP;
END $do$;
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.legal_references FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('ref_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.regulatory_calendar FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('item_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.legislative_monitor FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('entry_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.legislative_monitor_checks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('check_id');
CREATE TRIGGER append_only BEFORE UPDATE ON erp_private.legislative_monitor_checks FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

-- Managers and Partners add and edit entries; only a Partner verifies a reference or confirms a calendar rule. Changing the substance of
-- a verified reference sends it, and every confirmed calendar rule that depends on it, back to unverified / unconfirmed.
CREATE FUNCTION erp_private.reg_reference_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.legal_references;v_id uuid;changed boolean;v_applies text[];dropped integer:=0;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner maintains the legal reference register' USING ERRCODE='42501'; END IF;
 v_applies:=COALESCE(ARRAY(SELECT jsonb_array_elements_text(p->'applies_to')),ARRAY['ALL_SACCO']::text[]);
 IF NULLIF(p->>'ref_id','') IS NULL THEN
  INSERT INTO erp_private.legal_references(ref_code,title,instrument_type,citation,issuing_body,legal_status,applies_to,summary,source_url,created_by)
  VALUES(upper(btrim(p->>'ref_code')),btrim(p->>'title'),p->>'instrument_type',COALESCE(p->>'citation',''),COALESCE(p->>'issuing_body',''),COALESCE(p->>'legal_status','Not yet confirmed'),v_applies,COALESCE(p->>'summary',''),COALESCE(btrim(p->>'source_url'),''),a.staff_id)
  RETURNING ref_id INTO v_id;
  RETURN jsonb_build_object('ok',true,'ref_id',v_id);
 END IF;
 SELECT * INTO r FROM erp_private.legal_references WHERE ref_id=(p->>'ref_id')::uuid FOR UPDATE;
 IF r.ref_id IS NULL THEN RAISE EXCEPTION 'Reference not found' USING ERRCODE='P0002'; END IF;
 IF p ? 'revision' AND (p->>'revision')::bigint<>r.revision THEN RAISE EXCEPTION 'This reference changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 changed:=r.title IS DISTINCT FROM btrim(p->>'title') OR r.instrument_type IS DISTINCT FROM p->>'instrument_type' OR r.citation IS DISTINCT FROM COALESCE(p->>'citation','')
  OR r.legal_status IS DISTINCT FROM COALESCE(p->>'legal_status','Not yet confirmed') OR r.applies_to IS DISTINCT FROM v_applies OR r.summary IS DISTINCT FROM COALESCE(p->>'summary','')
  OR r.source_url IS DISTINCT FROM COALESCE(btrim(p->>'source_url'),'');
 IF changed AND r.verification<>'Unverified' THEN
  UPDATE erp_private.legal_references SET title=btrim(p->>'title'),instrument_type=p->>'instrument_type',citation=COALESCE(p->>'citation',''),issuing_body=COALESCE(p->>'issuing_body',''),
   legal_status=COALESCE(p->>'legal_status','Not yet confirmed'),applies_to=v_applies,summary=COALESCE(p->>'summary',''),source_url=COALESCE(btrim(p->>'source_url'),''),
   verification='Unverified',verified_by=NULL,verified_at=NULL,verification_note=''
  WHERE ref_id=r.ref_id;
  UPDATE erp_private.regulatory_calendar SET status='Unconfirmed',confirmed_by=NULL,confirmed_at=NULL,confirmation_note='' WHERE reference_id=r.ref_id AND status='Confirmed';
  GET DIAGNOSTICS dropped=ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'ref_id',r.ref_id,'verification_reset',true,'rules_unconfirmed',dropped);
 END IF;
 UPDATE erp_private.legal_references SET title=btrim(p->>'title'),instrument_type=p->>'instrument_type',citation=COALESCE(p->>'citation',''),issuing_body=COALESCE(p->>'issuing_body',''),
  legal_status=COALESCE(p->>'legal_status','Not yet confirmed'),applies_to=v_applies,summary=COALESCE(p->>'summary',''),source_url=COALESCE(btrim(p->>'source_url'),'') WHERE ref_id=r.ref_id;
 RETURN jsonb_build_object('ok',true,'ref_id',r.ref_id,'verification_reset',false,'rules_unconfirmed',0);
END $$;

CREATE FUNCTION erp_private.reg_reference_verify(p_ref uuid,p_level text,p_note text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.legal_references;dropped integer:=0;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can verify a legal reference' USING ERRCODE='42501'; END IF;
 IF p_level NOT IN('Unverified','Secondary source','Primary source verified') THEN RAISE EXCEPTION 'Choose a verification level' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM erp_private.legal_references WHERE ref_id=p_ref FOR UPDATE;
 IF r.ref_id IS NULL THEN RAISE EXCEPTION 'Reference not found' USING ERRCODE='P0002'; END IF;
 IF p_revision IS NOT NULL AND p_revision<>r.revision THEN RAISE EXCEPTION 'This reference changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 IF p_level<>'Unverified' AND length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what you checked and where, in at least 10 characters' USING ERRCODE='23514'; END IF;
 IF p_level='Primary source verified' AND (length(btrim(r.source_url))<8 OR r.legal_status='Not yet confirmed') THEN
  RAISE EXCEPTION 'Enter the primary-source web address and the legal status before marking this reference as verified from the primary source' USING ERRCODE='23514'; END IF;
 IF p_level='Unverified' THEN
  UPDATE erp_private.legal_references SET verification='Unverified',verified_by=NULL,verified_at=NULL,verification_note='' WHERE ref_id=r.ref_id;
 ELSE
  UPDATE erp_private.legal_references SET verification=p_level,verified_by=a.staff_id,verified_at=now(),verification_note=btrim(p_note) WHERE ref_id=r.ref_id;
 END IF;
 IF p_level<>'Primary source verified' THEN
  UPDATE erp_private.regulatory_calendar SET status='Unconfirmed',confirmed_by=NULL,confirmed_at=NULL,confirmation_note='' WHERE reference_id=r.ref_id AND status='Confirmed';
  GET DIAGNOSTICS dropped=ROW_COUNT;
 END IF;
 RETURN jsonb_build_object('ok',true,'rules_unconfirmed',dropped);
END $$;

CREATE FUNCTION erp_private.reg_calendar_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;c erp_private.regulatory_calendar;v_id uuid;v_applies text[];v_ref uuid;changed boolean;
 v_type text;v_m integer;v_d integer;v_fm integer;v_fd integer;v_dir text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner maintains the regulatory calendar' USING ERRCODE='42501'; END IF;
 v_applies:=COALESCE(ARRAY(SELECT jsonb_array_elements_text(p->'applies_to')),ARRAY['ALL_SACCO']::text[]);
 v_ref:=NULLIF(p->>'reference_id','')::uuid;
 v_type:=COALESCE(NULLIF(p->>'rule_type',''),'Unresolved');
 v_m:=NULLIF(p->>'offset_months','')::int;v_d:=NULLIF(p->>'offset_days','')::int;v_fm:=NULLIF(p->>'fixed_month','')::int;v_fd:=NULLIF(p->>'fixed_day','')::int;v_dir:=NULLIF(p->>'direction','');
 IF NULLIF(p->>'item_id','') IS NULL THEN
  INSERT INTO erp_private.regulatory_calendar(item_code,title,reference_id,applies_to,as_reported,conflicting_wording,rule_type,offset_months,offset_days,fixed_month,fixed_day,direction,created_by)
  VALUES(upper(btrim(p->>'item_code')),btrim(p->>'title'),v_ref,v_applies,btrim(p->>'as_reported'),COALESCE(p->>'conflicting_wording',''),v_type,v_m,v_d,v_fm,v_fd,v_dir,a.staff_id) RETURNING item_id INTO v_id;
  RETURN jsonb_build_object('ok',true,'item_id',v_id);
 END IF;
 SELECT * INTO c FROM erp_private.regulatory_calendar WHERE item_id=(p->>'item_id')::uuid FOR UPDATE;
 IF c.item_id IS NULL THEN RAISE EXCEPTION 'Calendar item not found' USING ERRCODE='P0002'; END IF;
 IF p ? 'revision' AND (p->>'revision')::bigint<>c.revision THEN RAISE EXCEPTION 'This item changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 changed:=c.reference_id IS DISTINCT FROM v_ref OR c.applies_to IS DISTINCT FROM v_applies OR c.as_reported IS DISTINCT FROM btrim(p->>'as_reported') OR c.rule_type IS DISTINCT FROM v_type
  OR c.offset_months IS DISTINCT FROM v_m OR c.offset_days IS DISTINCT FROM v_d OR c.fixed_month IS DISTINCT FROM v_fm OR c.fixed_day IS DISTINCT FROM v_fd OR c.direction IS DISTINCT FROM v_dir;
 UPDATE erp_private.regulatory_calendar SET title=btrim(p->>'title'),reference_id=v_ref,applies_to=v_applies,as_reported=btrim(p->>'as_reported'),conflicting_wording=COALESCE(p->>'conflicting_wording',''),
  rule_type=v_type,offset_months=v_m,offset_days=v_d,fixed_month=v_fm,fixed_day=v_fd,direction=v_dir,
  status=CASE WHEN changed THEN 'Unconfirmed' ELSE status END,confirmed_by=CASE WHEN changed THEN NULL ELSE confirmed_by END,
  confirmed_at=CASE WHEN changed THEN NULL ELSE confirmed_at END,confirmation_note=CASE WHEN changed THEN '' ELSE confirmation_note END
 WHERE item_id=c.item_id;
 RETURN jsonb_build_object('ok',true,'item_id',c.item_id,'confirmation_reset',changed AND c.status='Confirmed');
END $$;

CREATE FUNCTION erp_private.reg_calendar_confirm(p_item uuid,p_note text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;c erp_private.regulatory_calendar;r erp_private.legal_references;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can confirm a regulatory calendar rule' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM erp_private.regulatory_calendar WHERE item_id=p_item FOR UPDATE;
 IF c.item_id IS NULL THEN RAISE EXCEPTION 'Calendar item not found' USING ERRCODE='P0002'; END IF;
 IF p_revision IS NOT NULL AND p_revision<>c.revision THEN RAISE EXCEPTION 'This item changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 IF c.rule_type='Unresolved' OR c.direction IS NULL THEN RAISE EXCEPTION 'Enter the rule (type and whether the date is a limit or an earliest date) before confirming it' USING ERRCODE='23514'; END IF;
 IF c.reference_id IS NULL THEN RAISE EXCEPTION 'Link the legal reference before confirming the rule' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM erp_private.legal_references WHERE ref_id=c.reference_id;
 IF r.verification<>'Primary source verified' THEN RAISE EXCEPTION 'The linked reference "%" is not verified from the primary source. Verify it first.',r.title USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record how you confirmed the rule, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.regulatory_calendar SET status='Confirmed',confirmed_by=a.staff_id,confirmed_at=now(),confirmation_note=btrim(p_note) WHERE item_id=c.item_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.reg_calendar_withdraw(p_item uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can withdraw a confirmed rule' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.regulatory_calendar SET status='Unconfirmed',confirmed_by=NULL,confirmed_at=NULL,confirmation_note='' WHERE item_id=p_item AND status='Confirmed';
 IF NOT FOUND THEN RAISE EXCEPTION 'That rule is not confirmed' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values)
  VALUES(auth.uid(),current_user,'regulatory_calendar','RULE_WITHDRAWN',p_item::text,jsonb_build_object('reason',btrim(p_note),'by',a.staff_id));
 RETURN jsonb_build_object('ok',true);
END $$;

-- The due date for a financial year. NULL unless a Partner has confirmed the rule: the ERP never shows a guessed date.
CREATE FUNCTION erp_private.regulatory_due_date(p_item uuid,p_year_end date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c erp_private.regulatory_calendar;d date;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR p_year_end IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO c FROM erp_private.regulatory_calendar WHERE item_id=p_item;
 IF c.item_id IS NULL OR c.status<>'Confirmed' THEN RETURN NULL; END IF;
 IF c.rule_type='Period after year end' THEN
  d:=((p_year_end + make_interval(months=>COALESCE(c.offset_months,0)))::date) + COALESCE(c.offset_days,0);
 ELSIF c.rule_type='Fixed date each year' THEN
  -- the first such date on or after the year end
  d:=make_date(EXTRACT(year FROM p_year_end)::int,c.fixed_month,1) + (LEAST(c.fixed_day,EXTRACT(day FROM (make_date(EXTRACT(year FROM p_year_end)::int,c.fixed_month,1)+interval '1 month'-interval '1 day'))::int)-1);
  IF d<p_year_end THEN d:=(d + interval '1 year')::date; END IF;
 ELSE RETURN NULL; END IF;
 RETURN jsonb_build_object('date',d,'direction',c.direction,'as_reported',c.as_reported);
END $$;

CREATE FUNCTION erp_private.reg_monitor_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;m erp_private.legislative_monitor;v_id uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner maintains the monitoring register' USING ERRCODE='42501'; END IF;
 IF NULLIF(p->>'entry_id','') IS NULL THEN
  INSERT INTO erp_private.legislative_monitor(title,item_type,source_body,reference_id,first_seen_on,next_check_due,owner_id,note,created_by)
  VALUES(btrim(p->>'title'),p->>'item_type',COALESCE(p->>'source_body',''),NULLIF(p->>'reference_id','')::uuid,COALESCE(NULLIF(p->>'first_seen_on','')::date,CURRENT_DATE),NULLIF(p->>'next_check_due','')::date,
   COALESCE(NULLIF(p->>'owner_id','')::uuid,a.staff_id),COALESCE(p->>'note',''),a.staff_id) RETURNING entry_id INTO v_id;
  RETURN jsonb_build_object('ok',true,'entry_id',v_id);
 END IF;
 SELECT * INTO m FROM erp_private.legislative_monitor WHERE entry_id=(p->>'entry_id')::uuid FOR UPDATE;
 IF m.entry_id IS NULL THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='P0002'; END IF;
 IF m.status='Closed' THEN RAISE EXCEPTION 'A closed entry cannot be edited' USING ERRCODE='23514'; END IF;
 IF p ? 'revision' AND (p->>'revision')::bigint<>m.revision THEN RAISE EXCEPTION 'This entry changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 UPDATE erp_private.legislative_monitor SET title=btrim(p->>'title'),item_type=p->>'item_type',source_body=COALESCE(p->>'source_body',''),reference_id=NULLIF(p->>'reference_id','')::uuid,
  next_check_due=NULLIF(p->>'next_check_due','')::date,owner_id=COALESCE(NULLIF(p->>'owner_id','')::uuid,owner_id),note=COALESCE(p->>'note','') WHERE entry_id=m.entry_id;
 RETURN jsonb_build_object('ok',true,'entry_id',m.entry_id);
END $$;

CREATE FUNCTION erp_private.reg_monitor_check(p_entry uuid,p_outcome text,p_note text,p_next date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;m erp_private.legislative_monitor;st text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner records monitoring checks' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM erp_private.legislative_monitor WHERE entry_id=p_entry FOR UPDATE;
 IF m.entry_id IS NULL THEN RAISE EXCEPTION 'Entry not found' USING ERRCODE='P0002'; END IF;
 IF m.status='Closed' THEN RAISE EXCEPTION 'This entry is closed' USING ERRCODE='23514'; END IF;
 IF p_outcome NOT IN('No change','Changed - needs review','Action needed','Closed') THEN RAISE EXCEPTION 'Choose an outcome' USING ERRCODE='22023'; END IF;
 IF p_outcome='Closed' AND a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can close a monitoring entry' USING ERRCODE='42501'; END IF;
 IF p_outcome<>'Closed' AND p_next IS NULL THEN RAISE EXCEPTION 'Set the date of the next check' USING ERRCODE='23514'; END IF;
 IF p_next IS NOT NULL AND p_next<=CURRENT_DATE THEN RAISE EXCEPTION 'The next check must be in the future' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.legislative_monitor_checks(entry_id,checked_on,checked_by,outcome,note) VALUES(m.entry_id,CURRENT_DATE,a.staff_id,p_outcome,btrim(COALESCE(p_note,'')));
 st:=CASE p_outcome WHEN 'No change' THEN 'Reviewed - no change needed' WHEN 'Closed' THEN 'Closed' WHEN 'Action needed' THEN 'Reviewed - action needed' ELSE 'Watching' END;
 UPDATE erp_private.legislative_monitor SET status=st,last_checked_on=CURRENT_DATE,next_check_due=CASE WHEN p_outcome='Closed' THEN NULL ELSE p_next END,
  closed_by=CASE WHEN p_outcome='Closed' THEN a.staff_id END,closed_at=CASE WHEN p_outcome='Closed' THEN now() END WHERE entry_id=m.entry_id;
 IF p_outcome IN('Changed - needs review','Action needed') THEN
  PERFORM erp_private.alert_partners('regmon:'||m.entry_id||':'||CURRENT_DATE,'Legislative monitor: "'||m.title||'" - '||lower(p_outcome)||'.');
 END IF;
 RETURN jsonb_build_object('ok',true,'status',st);
END $$;

-- One read for the screen.
CREATE FUNCTION erp_private.regulatory_register() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;res jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RETURN NULL; END IF;
 SELECT jsonb_build_object(
  'references',COALESCE((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('verified_by_name',s.full_name) ORDER BY r.instrument_type,r.title) FROM erp_private.legal_references r LEFT JOIN erp_private.staff_members s ON s.staff_id=r.verified_by),'[]'::jsonb),
  'calendar',COALESCE((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('confirmed_by_name',s.full_name,'reference_title',r.title,'reference_verification',r.verification) ORDER BY c.title) FROM erp_private.regulatory_calendar c LEFT JOIN erp_private.staff_members s ON s.staff_id=c.confirmed_by LEFT JOIN erp_private.legal_references r ON r.ref_id=c.reference_id),'[]'::jsonb),
  'monitor',COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('owner_name',s.full_name,'overdue',(m.status<>'Closed' AND (m.next_check_due IS NULL OR m.next_check_due<CURRENT_DATE))) ORDER BY (m.status='Closed'),m.next_check_due NULLS FIRST,m.title) FROM erp_private.legislative_monitor m LEFT JOIN erp_private.staff_members s ON s.staff_id=m.owner_id),'[]'::jsonb),
  'checks',COALESCE((SELECT jsonb_agg(to_jsonb(k)||jsonb_build_object('checked_by_name',s.full_name) ORDER BY k.created_at DESC) FROM (SELECT * FROM erp_private.legislative_monitor_checks ORDER BY created_at DESC LIMIT 200) k LEFT JOIN erp_private.staff_members s ON s.staff_id=k.checked_by),'[]'::jsonb)
 ) INTO res;
 RETURN res;
END $$;

REVOKE ALL ON FUNCTION erp_private.reg_reference_save(jsonb),erp_private.reg_reference_verify(uuid,text,text,bigint),erp_private.reg_calendar_save(jsonb),erp_private.reg_calendar_confirm(uuid,text,bigint),
 erp_private.reg_calendar_withdraw(uuid,text),erp_private.regulatory_due_date(uuid,date),erp_private.reg_monitor_save(jsonb),erp_private.reg_monitor_check(uuid,text,text,date),erp_private.regulatory_register()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.reg_reference_save(jsonb),erp_private.reg_reference_verify(uuid,text,text,bigint),erp_private.reg_calendar_save(jsonb),erp_private.reg_calendar_confirm(uuid,text,bigint),
 erp_private.reg_calendar_withdraw(uuid,text),erp_private.regulatory_due_date(uuid,date),erp_private.reg_monitor_save(jsonb),erp_private.reg_monitor_check(uuid,text,text,date),erp_private.regulatory_register()
 TO erp_api;

-- Seed rows from the legal verification report supplied by the Partner group. All start Unverified / Unconfirmed. No figures are stored.
INSERT INTO erp_private.legal_references(ref_code,title,instrument_type,citation,issuing_body,legal_status,applies_to,summary) VALUES
 ('SACCO-ACT-2008','Sacco Societies Act, 2008','Act','Act No. 14 of 2008; ss 7A, 7B, 40(4), 41(1), 44(3)-(4) as cited in the report','Parliament of Kenya','Not yet confirmed',ARRAY['ALL_SACCO'],'Reported as the principal Act. Provisions cited by the report: AML/CFT/CPF duties (ss 7A, 7B), audit and submission (ss 40(4), 41(1)), and the separate auditor report (s 44(3)-(4)).'),
 ('SACCO-DT-REG-2010','Sacco Societies (Deposit-Taking Sacco Business) Regulations, 2010','Regulation','Regs 9, 10, 13, 41, 44, 55, 56 and 65(2) as cited in the report','Cabinet Secretary, National Treasury','Not yet confirmed',ARRAY['DT_SACCO'],'Reported to hold the capital, liquidity and loan-classification requirements, the reporting deadlines and the code of conduct (Third Schedule). Figures are not stored here.'),
 ('SACCO-NWDT-REG-2020','Sacco Societies (Non-Withdrawable Deposit-Taking Sacco Business) Regulations, 2020','Regulation','As cited in the report (secondary source only)','Cabinet Secretary, National Treasury','Not yet confirmed',ARRAY['NWDT_SACCO'],'Reported to set separate requirements for non-withdrawable-deposit-taking SACCOs. Do not carry any figure from it until it has been checked against the primary text.'),
 ('SASRA-CIRC-2025-12','SASRA circular, December 2025 (as cited in the report)','Circular','Secondary source only','Sacco Societies Regulatory Authority','Not yet confirmed',ARRAY['ALL_SACCO'],'Cited by the report. Status (binding direction or guidance) and content to be checked on the SASRA site.'),
 ('SASRA-CIRC-2016-ISA701','SASRA circular on ISA 701 key audit matters, 2016 (as cited in the report)','Circular','Secondary source only','Sacco Societies Regulatory Authority','Not yet confirmed',ARRAY['ALL_SACCO'],'Cited by the report. No key audit matter is pre-set by the ERP.'),
 ('SACCO-AMEND-BILL-2025','Sacco Societies (Amendment) Bill, 2025','Bill','Section 11 cited in the report: register of verification statuses','National Assembly','Proposed (Bill)',ARRAY['ALL_SACCO'],'Proposed only. It must not be applied as law unless and until it is enacted and in force.'),
 ('ISA-701','International Standard on Auditing 701, Communicating key audit matters in the independent auditor''s report','Standard','ISA 701','IAASB / ICPAK','Not yet confirmed',ARRAY['ALL_SACCO','OTHER'],'Applies to listed entities, and to others where the auditor decides or the law requires. Whether a deposit-taking SACCO is treated as a public-interest entity is a Partner decision recorded in S3.')
ON CONFLICT (ref_code) DO NOTHING;

INSERT INTO erp_private.regulatory_calendar(item_code,title,reference_id,applies_to,as_reported,conflicting_wording)
SELECT v.code,v.title,r.ref_id,v.applies,v.reported,v.conflict
FROM (VALUES
 ('AUDIT-AND-SASRA-SUBMISSION','Audited accounts and submission to SASRA','SACCO-ACT-2008',ARRAY['ALL_SACCO'],'Audit and SASRA submission by 31 March (ss 40(4), 41(1), reg 55(1)), as reported','Whether this is a fixed date or a period after the year end is for the Partner to settle against the primary text.'),
 ('AGM','Annual general meeting','SACCO-DT-REG-2010',ARRAY['DT_SACCO'],'AGM within 4 months (reg 55(4)), as reported','Whether the four months run from the year end or from another event is for the Partner to settle against the primary text.'),
 ('S44-SEPARATE-AUDITOR-REPORT','Separate auditor report to the Authority (s 44(3)-(4), reg 56)','SACCO-ACT-2008',ARRAY['ALL_SACCO'],'The legal report reads: "not less than four months after year-end".','Trade press reads: "within four months". The two readings point in opposite directions. Wording is kept verbatim; no date is computed until a Partner settles it.')
) AS v(code,title,ref,applies,reported,conflict) JOIN erp_private.legal_references r ON r.ref_code=v.ref
ON CONFLICT (item_code) DO NOTHING;

INSERT INTO erp_private.legislative_monitor(title,item_type,source_body,reference_id,note)
SELECT v.title,v.t,v.src,r.ref_id,v.note FROM (VALUES
 ('Sacco Societies (Amendment) Bill, 2025','Bill','National Assembly','SACCO-AMEND-BILL-2025','Watch for passage, assent and commencement. Not law yet.'),
 ('SASRA circular of December 2025','Circular','SASRA','SASRA-CIRC-2025-12','Read the circular itself and record whether it is a binding direction or guidance.'),
 ('Non-withdrawable-deposit-taking SACCO regulations, 2020','Regulation change','Kenya Gazette','SACCO-NWDT-REG-2020','Check the primary text before any figure from it is entered in the ratio table.')
) AS v(title,t,src,ref,note) JOIN erp_private.legal_references r ON r.ref_code=v.ref
WHERE NOT EXISTS(SELECT 1 FROM erp_private.legislative_monitor m WHERE m.title=v.title);
