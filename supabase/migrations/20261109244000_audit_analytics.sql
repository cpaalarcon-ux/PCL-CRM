-- Audit build E: analytics on the client's posted ledger journals for the audit period.
-- Tests run on the server: duplicates, sequence gaps, Benford first digits, round amounts, postings on weekends and public holidays,
-- unusual preparers and amounts just under thresholds. Results are risk alerts. The auditor clears each alert with a note.
-- The audit file cannot go to review while an alert is open.

CREATE TABLE erp_private.audit_analytic_runs (
 run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 params jsonb NOT NULL,
 params_sha256 text NOT NULL CHECK(params_sha256 ~ '^[a-f0-9]{64}$'),
 population_journals integer NOT NULL,
 population_lines integer NOT NULL,
 tests jsonb NOT NULL,
 alerts_added integer NOT NULL DEFAULT 0,
 run_by uuid NOT NULL REFERENCES erp_private.staff_members,
 run_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_analytic_runs_file_idx ON erp_private.audit_analytic_runs(audit_file_id,run_at DESC);
CREATE INDEX audit_analytic_runs_by_idx ON erp_private.audit_analytic_runs(run_by);

CREATE TABLE erp_private.audit_analytic_alerts (
 alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 run_id uuid NOT NULL REFERENCES erp_private.audit_analytic_runs,
 test_kind text NOT NULL CHECK(test_kind IN('Duplicate','Sequence gap','Benford','Round amounts','Weekend or holiday posting','Unusual preparer','Just under threshold')),
 severity text NOT NULL CHECK(severity IN('Low','Medium','High')),
 title text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Cleared')),
 clear_note text NOT NULL DEFAULT '',
 cleared_by uuid REFERENCES erp_private.staff_members,
 cleared_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(audit_file_id,fingerprint),
 CHECK(status='Open' OR (cleared_by IS NOT NULL AND cleared_at IS NOT NULL AND length(btrim(clear_note))>=20)),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_analytic_alerts_file_idx ON erp_private.audit_analytic_alerts(audit_file_id,status,severity);
CREATE INDEX audit_analytic_alerts_run_idx ON erp_private.audit_analytic_alerts(run_id);
CREATE INDEX audit_analytic_alerts_clr_idx ON erp_private.audit_analytic_alerts(cleared_by);

DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_analytic_runs','audit_analytic_alerts'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
 END LOOP;
END $do$;
CREATE FUNCTION erp_private.audit_run_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.tests<>'{}'::jsonb OR NEW.params IS DISTINCT FROM OLD.params OR NEW.run_by<>OLD.run_by OR NEW.audit_file_id<>OLD.audit_file_id THEN RAISE EXCEPTION 'An analytics run record cannot be changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER run_lock BEFORE UPDATE ON erp_private.audit_analytic_runs FOR EACH ROW EXECUTE FUNCTION erp_private.audit_run_guard();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.audit_analytic_alerts FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_analytic_alerts FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('alert_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.audit_analytic_runs FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('run_id');

-- An alert's content is fixed. Only the clearing fields change.
CREATE FUNCTION erp_private.audit_alert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.detail IS DISTINCT FROM OLD.detail OR NEW.title<>OLD.title OR NEW.test_kind<>OLD.test_kind OR NEW.severity<>OLD.severity OR NEW.fingerprint<>OLD.fingerprint OR NEW.audit_file_id<>OLD.audit_file_id THEN
  RAISE EXCEPTION 'An analytics alert cannot be edited; clear it with a note' USING ERRCODE='23514'; END IF;
 IF OLD.status='Cleared' THEN RAISE EXCEPTION 'A cleared alert cannot be changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alert_lock BEFORE UPDATE ON erp_private.audit_analytic_alerts FOR EACH ROW EXECUTE FUNCTION erp_private.audit_alert_guard();

-- The population: posted journal lines of the client in the audit period. Opening and year-close journals are left out.
CREATE FUNCTION erp_private.audit_analytics_population(p_file uuid) RETURNS TABLE(line_id uuid,journal_id uuid,reference text,kind text,journal_date date,posted_at timestamptz,prepared_by uuid,account_code text,amt numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT l.line_id,j.journal_id,j.reference,j.kind,j.journal_date,j.posted_at,j.prepared_by,l.account_code,(l.debit+l.credit)
 FROM erp_private.audit_files f JOIN erp_private.projects pr ON pr.client_id=f.client_id JOIN erp_private.ledger_journals j ON j.project_id=pr.project_id JOIN erp_private.ledger_lines l ON l.journal_id=j.journal_id
 WHERE f.audit_file_id=p_file AND j.status='Posted' AND j.journal_date BETWEEN f.starts_on AND f.ends_on AND j.kind NOT IN('Opening','Year close') AND (l.debit+l.credit)>0;
$$;

CREATE FUNCTION erp_private.audit_analytics_run(p_file uuid,p_params jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;m erp_private.audit_materiality;run uuid;prm jsonb;
 dup_min numeric;rbase numeric;rmin numeric;rshare numeric;thr numeric[];band numeric:=0.05;cap integer:=50;
 nj integer;nl integer;tst jsonb:='{}'::jsonb;added integer:=0;ins_n integer;fnd integer;
 pop_n bigint;chi numeric;exp_n numeric;obs jsonb;digs bigint[]:=ARRAY[0,0,0,0,0,0,0,0,0];dg_i integer;rr record;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to new analytics runs' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM erp_private.audit_materiality WHERE audit_file_id=p_file AND status='Approved';
 dup_min:=LEAST(GREATEST(COALESCE((p_params->>'dup_min_amount')::numeric,1000),0),1000000000);
 rbase:=LEAST(GREATEST(COALESCE((p_params->>'round_base')::numeric,1000),1),1000000);
 rmin:=LEAST(GREATEST(COALESCE((p_params->>'round_min_amount')::numeric,10000),1),1000000000);
 rshare:=LEAST(GREATEST(COALESCE((p_params->>'round_share')::numeric,0.3),0.05),1);
 thr:=COALESCE((SELECT array_agg(DISTINCT x ORDER BY x) FROM (SELECT (v)::numeric x FROM jsonb_array_elements_text(COALESCE(p_params->'thresholds','[]'::jsonb)) v WHERE v ~ '^[0-9]+(\.[0-9]+)?$' UNION SELECT m.overall_amount WHERE m.materiality_id IS NOT NULL UNION SELECT m.performance_amount WHERE m.materiality_id IS NOT NULL) q WHERE x>0),ARRAY[]::numeric[]);
 prm:=jsonb_build_object('dup_min_amount',dup_min,'round_base',rbase,'round_min_amount',rmin,'round_share',rshare,'thresholds',to_jsonb(thr),'just_under_band',band,'benford_min_population',50,'benford_chi_square_critical',15.507,'per_test_alert_cap',cap);
 SELECT count(DISTINCT journal_id),count(*) INTO nj,nl FROM erp_private.audit_analytics_population(p_file);
 INSERT INTO erp_private.audit_analytic_runs(audit_file_id,project_id,handling_firm_id,params,params_sha256,population_journals,population_lines,tests,run_by)
  VALUES(p_file,f.project_id,f.handling_firm_id,prm,encode(sha256(convert_to(prm::text,'UTF8')),'hex'),nj,nl,'{}'::jsonb,a.staff_id) RETURNING run_id INTO run;
 IF nl=0 THEN
  UPDATE erp_private.audit_analytic_runs SET tests=jsonb_build_object('population',jsonb_build_object('ran',false,'reason','No posted journals in the audit period for this client.')) WHERE run_id=run;
  RETURN run;
 END IF;

 -- 1. Duplicates: same account, amount and date in two or more journals. Accounts that share the same journals are reported once.
 fnd:=0;
 WITH g AS (SELECT account_code,amt,journal_date,count(DISTINCT journal_id) n,array_agg(DISTINCT reference ORDER BY reference) refs FROM erp_private.audit_analytics_population(p_file) WHERE account_code IS NOT NULL AND amt>=dup_min GROUP BY 1,2,3 HAVING count(DISTINCT journal_id)>=2),
 d AS (SELECT amt,journal_date,n,refs,array_agg(account_code ORDER BY account_code) accts FROM g GROUP BY amt,journal_date,n,refs),
 ins AS (INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
  SELECT p_file,f.project_id,f.handling_firm_id,run,'Duplicate',CASE WHEN m.materiality_id IS NOT NULL AND amt>=m.performance_amount THEN 'High' ELSE 'Medium' END,
   'Possible duplicate: amount '||amt||' on '||journal_date||' in '||n||' journals ('||array_to_string(refs[1:5],', ')||')',jsonb_build_object('accounts',to_jsonb(accts),'amount',amt,'date',journal_date,'journals',n,'references',to_jsonb(refs[1:10])),
   'dup:'||md5(amt||'|'||journal_date||'|'||array_to_string(refs,',')) FROM (SELECT * FROM d ORDER BY amt DESC LIMIT cap) z ON CONFLICT(audit_file_id,fingerprint) DO NOTHING RETURNING 1)
 SELECT (SELECT count(*) FROM d),(SELECT count(*) FROM ins) INTO fnd,ins_n;
 added:=added+ins_n;tst:=tst||jsonb_build_object('Duplicate',jsonb_build_object('ran',true,'found',fnd,'added',ins_n));

 -- 2. Sequence gaps in journal references that end in a number, per journal kind and prefix.
 WITH j AS (SELECT DISTINCT journal_id,kind,reference FROM erp_private.audit_analytics_population(p_file)),
 n AS (SELECT kind,regexp_replace(reference,'[0-9]+$','') pfx,substring(reference from '[0-9]{1,12}$')::bigint num FROM j WHERE reference ~ '(^|[^0-9])[0-9]{1,12}$'),
 g AS (SELECT kind,pfx,min(num) lo,max(num) hi,count(DISTINCT num) c FROM n GROUP BY 1,2 HAVING count(DISTINCT num)>=5 AND max(num)-min(num)<=100000),
 mm AS (SELECT g.kind,g.pfx,g.lo,g.hi,g.c,(SELECT array_agg(s ORDER BY s) FROM generate_series(g.lo,g.hi) s WHERE NOT EXISTS(SELECT 1 FROM n WHERE n.kind=g.kind AND n.pfx=g.pfx AND n.num=s)) missing FROM g),
 ins AS (INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
  SELECT p_file,f.project_id,f.handling_firm_id,run,'Sequence gap','Medium','Missing numbers in '||kind||' journals '||pfx||lo||' to '||pfx||hi||': '||array_length(missing,1)||' not posted',
   jsonb_build_object('kind',kind,'prefix',pfx,'first',lo,'last',hi,'posted',c,'missing_count',array_length(missing,1),'missing_sample',to_jsonb(missing[1:20]),'note','A missing number may be a draft or deleted journal. Confirm it is not a posted entry that was removed.'),
   'gap:'||kind||'|'||pfx||'|'||md5(array_to_string(missing,',')) FROM mm WHERE missing IS NOT NULL ON CONFLICT(audit_file_id,fingerprint) DO NOTHING RETURNING 1)
 SELECT (SELECT count(*) FROM mm WHERE missing IS NOT NULL),(SELECT count(*) FROM ins) INTO fnd,ins_n;
 added:=added+ins_n;tst:=tst||jsonb_build_object('Sequence gap',jsonb_build_object('ran',true,'found',fnd,'added',ins_n));

 -- 3. Benford first-digit test on line amounts of 1 or more. Needs at least 50 amounts. Chi-square critical value 15.507 (8 degrees of freedom, 5%).
 SELECT count(*) INTO pop_n FROM erp_private.audit_analytics_population(p_file) WHERE amt>=1;
 IF pop_n<50 THEN
  tst:=tst||jsonb_build_object('Benford',jsonb_build_object('ran',false,'reason','Only '||pop_n||' amounts of 1 or more; at least 50 are needed for the test to mean anything.'));
 ELSE
  FOR rr IN SELECT substring(amt::text from '[1-9]')::int dg,count(*) c FROM erp_private.audit_analytics_population(p_file) WHERE amt>=1 GROUP BY 1 LOOP digs[rr.dg]:=rr.c; END LOOP;
  chi:=0;obs:='[]'::jsonb;
  FOR dg_i IN 1..9 LOOP exp_n:=pop_n*log(1+1.0/dg_i);chi:=chi+power(digs[dg_i]-exp_n,2)/exp_n;obs:=obs||jsonb_build_array(jsonb_build_object('digit',dg_i,'observed',digs[dg_i],'expected',round(exp_n,1)));END LOOP;
  ins_n:=0;
  IF chi>15.507 THEN
   INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
    VALUES(p_file,f.project_id,f.handling_firm_id,run,'Benford','Medium','First-digit pattern differs from Benford''s law (chi-square '||round(chi,1)||' against 15.5)',jsonb_build_object('population',pop_n,'chi_square',round(chi,2),'critical',15.507,'digits',obs,'note','A difference is a prompt to look closer, not proof of error. Some populations, such as fixed fees, do not follow the law.'),'benford:'||md5(digs::text)) ON CONFLICT(audit_file_id,fingerprint) DO NOTHING;
   GET DIAGNOSTICS ins_n=ROW_COUNT;
  END IF;
  added:=added+ins_n;tst:=tst||jsonb_build_object('Benford',jsonb_build_object('ran',true,'population',pop_n,'chi_square',round(chi,2),'found',CASE WHEN chi>15.507 THEN 1 ELSE 0 END,'added',ins_n));
 END IF;

 -- 4. Round amounts: a high share of large amounts that are exact multiples of the round base.
 SELECT count(*),count(*) FILTER(WHERE amt%rbase=0) INTO pop_n,fnd FROM erp_private.audit_analytics_population(p_file) WHERE amt>=rmin;
 ins_n:=0;
 IF pop_n>=20 AND fnd>=5 AND fnd::numeric/pop_n>=rshare THEN
  INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
   SELECT p_file,f.project_id,f.handling_firm_id,run,'Round amounts','Low',fnd||' of '||pop_n||' amounts of '||rmin||' or more are exact multiples of '||rbase,
    jsonb_build_object('amounts_tested',pop_n,'round_amounts',fnd,'share',round(fnd::numeric/pop_n,3),'round_base',rbase,'samples',(SELECT jsonb_agg(jsonb_build_object('reference',reference,'account_code',account_code,'amount',amt)) FROM (SELECT reference,account_code,amt FROM erp_private.audit_analytics_population(p_file) WHERE amt>=rmin AND amt%rbase=0 ORDER BY amt DESC LIMIT 10) s)),
    'round:'||md5(fnd||'|'||pop_n||'|'||rbase) ON CONFLICT(audit_file_id,fingerprint) DO NOTHING;
  GET DIAGNOSTICS ins_n=ROW_COUNT;
 END IF;
 added:=added+ins_n;tst:=tst||jsonb_build_object('Round amounts',jsonb_build_object('ran',pop_n>=20,'population',pop_n,'found',CASE WHEN pop_n>=20 AND fnd>=5 AND fnd::numeric/pop_n>=rshare THEN 1 ELSE 0 END,'added',ins_n)||CASE WHEN pop_n<20 THEN jsonb_build_object('reason','Only '||pop_n||' amounts of '||rmin||' or more; at least 20 are needed.') ELSE '{}'::jsonb END);

 -- 5. Journals posted on a weekend or public holiday (Nairobi date of posting).
 WITH p AS (SELECT journal_id,min(reference) reference,min(kind) kind,min(posted_at) posted_at,(array_agg(prepared_by))[1] prepared_by,sum(amt)/2 value FROM erp_private.audit_analytics_population(p_file) WHERE posted_at IS NOT NULL GROUP BY journal_id),
 w AS (SELECT p.*,(p.posted_at AT TIME ZONE 'Africa/Nairobi')::date pd FROM p),
 x AS (SELECT w.*,extract(isodow FROM pd)>=6 weekend,h.name holiday FROM w LEFT JOIN erp_private.public_holidays h ON h.holiday_date=w.pd AND NOT h.is_working_day WHERE extract(isodow FROM pd)>=6 OR h.holiday_date IS NOT NULL),
 ins AS (INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
  SELECT p_file,f.project_id,f.handling_firm_id,run,'Weekend or holiday posting','Medium','Journal '||reference||' ('||kind||') posted on '||pd||CASE WHEN holiday IS NOT NULL THEN ' ('||holiday||')' WHEN weekend THEN ' (weekend)' ELSE '' END,
   jsonb_build_object('journal_id',journal_id,'reference',reference,'kind',kind,'posted_on',pd,'value',round(value,2),'prepared_by',prepared_by,'holiday',holiday,'weekend',weekend),'post:'||journal_id
  FROM (SELECT * FROM x ORDER BY value DESC LIMIT cap) z ON CONFLICT(audit_file_id,fingerprint) DO NOTHING RETURNING 1)
 SELECT (SELECT count(*) FROM x),(SELECT count(*) FROM ins) INTO fnd,ins_n;
 added:=added+ins_n;tst:=tst||jsonb_build_object('Weekend or holiday posting',jsonb_build_object('ran',true,'found',fnd,'added',ins_n));

 -- 6. Unusual preparers: someone who prepared under 5% of the journals when there are at least 20 journals.
 ins_n:=0;fnd:=0;
 IF nj>=20 THEN
  WITH c AS (SELECT prepared_by,count(DISTINCT journal_id) cnt,sum(amt)/2 value FROM erp_private.audit_analytics_population(p_file) GROUP BY 1),
  r AS (SELECT c.*,s.full_name,s.category_code FROM c JOIN erp_private.staff_members s ON s.staff_id=c.prepared_by WHERE c.cnt::numeric/nj<0.05),
  ins AS (INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
   SELECT p_file,f.project_id,f.handling_firm_id,run,'Unusual preparer','Medium',full_name||' ('||category_code||') prepared only '||cnt||' of '||nj||' journals',
    jsonb_build_object('prepared_by',prepared_by,'journals',cnt,'population',nj,'value',round(value,2)),'preparer:'||prepared_by||'|'||cnt FROM r ON CONFLICT(audit_file_id,fingerprint) DO NOTHING RETURNING 1)
  SELECT (SELECT count(*) FROM r),(SELECT count(*) FROM ins) INTO fnd,ins_n;
 END IF;
 added:=added+ins_n;tst:=tst||jsonb_build_object('Unusual preparer',jsonb_build_object('ran',nj>=20,'found',fnd,'added',ins_n)||CASE WHEN nj<20 THEN jsonb_build_object('reason','Only '||nj||' journals; at least 20 are needed.') ELSE '{}'::jsonb END);

 -- 7. Amounts just under a threshold (within 5% below). Thresholds are those supplied plus approved materiality.
 ins_n:=0;fnd:=0;
 IF array_length(thr,1) IS NULL THEN
  tst:=tst||jsonb_build_object('Just under threshold',jsonb_build_object('ran',false,'reason','No thresholds supplied and materiality is not approved.'));
 ELSE
  WITH t AS (SELECT unnest(thr) th),
  u AS (SELECT p.journal_id,min(p.reference) reference,t.th,max(p.amt) amt,count(*) lines FROM erp_private.audit_analytics_population(p_file) p JOIN t ON p.amt>=t.th*(1-band) AND p.amt<t.th GROUP BY p.journal_id,t.th),
  ins AS (INSERT INTO erp_private.audit_analytic_alerts(audit_file_id,project_id,handling_firm_id,run_id,test_kind,severity,title,detail,fingerprint)
   SELECT p_file,f.project_id,f.handling_firm_id,run,'Just under threshold','High','Journal '||reference||' has '||lines||' line(s) just under '||th||' (largest '||amt||')',
    jsonb_build_object('journal_id',journal_id,'reference',reference,'threshold',th,'largest_amount',amt,'lines',lines,'band',band),'under:'||journal_id||'|'||th FROM (SELECT * FROM u ORDER BY amt DESC LIMIT cap) z ON CONFLICT(audit_file_id,fingerprint) DO NOTHING RETURNING 1)
  SELECT (SELECT count(*) FROM u),(SELECT count(*) FROM ins) INTO fnd,ins_n;
  added:=added+ins_n;tst:=tst||jsonb_build_object('Just under threshold',jsonb_build_object('ran',true,'found',fnd,'added',ins_n,'thresholds',to_jsonb(thr)));
 END IF;

 UPDATE erp_private.audit_analytic_runs SET tests=tst,alerts_added=added WHERE run_id=run;
 RETURN run;
END $$;

-- Clearing needs a Supervisor or above and a note that says what was done.
CREATE FUNCTION erp_private.audit_analytic_clear(p_alert uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;al erp_private.audit_analytic_alerts;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner clears analytics alerts' USING ERRCODE='42501'; END IF;
 SELECT * INTO al FROM erp_private.audit_analytic_alerts WHERE alert_id=p_alert AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF al.alert_id IS NULL THEN RAISE EXCEPTION 'Alert unavailable' USING ERRCODE='42501'; END IF;
 IF al.status<>'Open' THEN RAISE EXCEPTION 'This alert is already cleared' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_files WHERE audit_file_id=al.audit_file_id AND file_status IN('Approved','Completion','Archived')) THEN RAISE EXCEPTION 'The audit file is closed' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<20 THEN RAISE EXCEPTION 'Say what you did to clear it (at least 20 characters)' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_analytic_alerts SET status='Cleared',clear_note=btrim(p_note),cleared_by=a.staff_id,cleared_at=now() WHERE alert_id=p_alert;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_file_analytics_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE n integer;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status OR NEW.file_status NOT IN('In Review','Approved') THEN RETURN NEW; END IF;
 SELECT count(*) INTO n FROM erp_private.audit_analytic_alerts WHERE audit_file_id=NEW.audit_file_id AND status='Open';
 IF n>0 THEN RAISE EXCEPTION 'Clear every analytics alert with a note first (% open)',n USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER analytics_guard BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_analytics_guard();

REVOKE ALL ON FUNCTION erp_private.audit_run_guard(),erp_private.audit_alert_guard(),erp_private.audit_analytics_population(uuid),erp_private.audit_file_analytics_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_analytics_run(uuid,jsonb),erp_private.audit_analytic_clear(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_analytics_run(uuid,jsonb),erp_private.audit_analytic_clear(uuid,text) TO erp_api;
