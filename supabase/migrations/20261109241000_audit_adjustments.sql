-- Audit build B: audit adjusting journals and the schedule of unadjusted misstatements.
-- These entries live on the audit file only. They never post to the client's bookkeeping ledger.
CREATE TABLE erp_private.audit_adjustments (
 adjustment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 adj_seq integer NOT NULL CHECK(adj_seq>0),
 adj_ref text NOT NULL,
 kind text NOT NULL CHECK(kind IN('Adjusting','Unadjusted')),
 description text NOT NULL CHECK(length(btrim(description))>=10),
 basis text NOT NULL CHECK(length(btrim(basis))>=10),
 misstatement_type text CHECK(misstatement_type IS NULL OR misstatement_type IN('Factual','Judgmental','Projected')),
 management_response text NOT NULL DEFAULT '',
 audit_workpaper_id uuid,
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
 FOREIGN KEY(audit_workpaper_id,audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_workpapers(audit_workpaper_id,audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,adj_seq),
 UNIQUE(audit_file_id,adj_ref),
 UNIQUE(adjustment_id,audit_file_id,project_id,handling_firm_id),
 CHECK(kind<>'Unadjusted' OR misstatement_type IS NOT NULL),
 CHECK(status NOT IN('Submitted','Approved') OR submitted_at IS NOT NULL),
 CHECK(status<>'Approved' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by AND length(btrim(review_note))>=10))
);
CREATE TABLE erp_private.audit_adjustment_lines (
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 adjustment_id uuid NOT NULL,
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 line_no integer NOT NULL CHECK(line_no>0),
 audit_account_id uuid NOT NULL,
 debit numeric(30,2) NOT NULL DEFAULT 0 CHECK(debit>=0),
 credit numeric(30,2) NOT NULL DEFAULT 0 CHECK(credit>=0),
 memo text NOT NULL DEFAULT '',
 FOREIGN KEY(adjustment_id,audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_adjustments(adjustment_id,audit_file_id,project_id,handling_firm_id),
 FOREIGN KEY(audit_account_id,handling_firm_id) REFERENCES erp_private.audit_account_mappings(audit_account_id,handling_firm_id),
 UNIQUE(adjustment_id,line_no),
 CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0))
);
CREATE TABLE erp_private.audit_misstatement_conclusions (
 conclusion_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 accumulated_gross numeric(30,2) NOT NULL,
 overall_amount numeric(20,2) NOT NULL,
 note text NOT NULL CHECK(length(btrim(note))>=30),
 concluded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 concluded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX audit_adjustments_file_idx ON erp_private.audit_adjustments(audit_file_id,status,kind);
CREATE INDEX audit_adjustment_lines_acct_idx ON erp_private.audit_adjustment_lines(audit_account_id);
CREATE INDEX audit_adjustment_lines_adj_idx ON erp_private.audit_adjustment_lines(adjustment_id);

DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_adjustments','audit_adjustment_lines','audit_misstatement_conclusions'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
 END LOOP;
END $do$;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.audit_adjustments FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.audit_misstatement_conclusions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.audit_adjustments FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_adjustments FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('adjustment_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_misstatement_conclusions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('conclusion_id');

-- Once approved or withdrawn an entry never changes. Lines can only be written while the entry is a draft or returned.
CREATE FUNCTION erp_private.audit_adjustment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status IN('Approved','Withdrawn') THEN RAISE EXCEPTION 'An approved or withdrawn audit entry cannot be changed' USING ERRCODE='23514'; END IF;
 IF NEW.kind<>OLD.kind OR NEW.adj_ref<>OLD.adj_ref OR NEW.prepared_by<>OLD.prepared_by OR NEW.audit_file_id<>OLD.audit_file_id THEN RAISE EXCEPTION 'The kind, reference and preparer of an audit entry cannot change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER entry_guard BEFORE UPDATE ON erp_private.audit_adjustments FOR EACH ROW EXECUTE FUNCTION erp_private.audit_adjustment_guard();
CREATE FUNCTION erp_private.audit_adjustment_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE st text;aid uuid:=COALESCE(NEW.adjustment_id,OLD.adjustment_id);
BEGIN
 SELECT status INTO st FROM erp_private.audit_adjustments WHERE adjustment_id=aid;
 IF st NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Lines can only change while the entry is a draft or returned' USING ERRCODE='23514'; END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON erp_private.audit_adjustment_lines FOR EACH ROW EXECUTE FUNCTION erp_private.audit_adjustment_line_guard();
CREATE TRIGGER no_update_conclusion BEFORE UPDATE ON erp_private.audit_misstatement_conclusions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

-- Effect of one entry. Profit effect is before tax: credit minus debit on income and expense lines, tax excluded.
-- Net assets effect is debit minus credit on asset and liability lines.
CREATE FUNCTION erp_private.audit_entry_effects(p_adjustment uuid) RETURNS TABLE(profit_effect numeric,tax_effect numeric,net_assets_effect numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE(sum(CASE WHEN m.financial_statement_line IN('Revenue','Cost of sales','Operating expenses','Finance costs') THEN l.credit-l.debit ELSE 0 END),0),
  COALESCE(sum(CASE WHEN m.financial_statement_line='Tax expense' THEN l.credit-l.debit ELSE 0 END),0),
  COALESCE(sum(CASE WHEN m.financial_statement_line IN('Assets','Liabilities') THEN l.debit-l.credit ELSE 0 END),0)
 FROM erp_private.audit_adjustment_lines l JOIN erp_private.audit_account_mappings m ON m.audit_account_id=l.audit_account_id WHERE l.adjustment_id=p_adjustment;
$$;

CREATE FUNCTION erp_private.audit_adjustment_save(p_file uuid,p_adjustment uuid,p_kind text,p_description text,p_basis text,p_type text,p_response text,p_workpaper uuid,p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;e erp_private.audit_adjustments;id uuid:=p_adjustment;n integer;x jsonb;i integer:=0;acct uuid;d numeric;c numeric;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to entries' USING ERRCODE='23514'; END IF;
 IF p_kind NOT IN('Adjusting','Unadjusted') THEN RAISE EXCEPTION 'Choose adjusting or unadjusted' USING ERRCODE='22023'; END IF;
 IF p_kind='Unadjusted' AND (p_type IS NULL OR p_type NOT IN('Factual','Judgmental','Projected')) THEN RAISE EXCEPTION 'Say whether the misstatement is factual, judgmental or projected' USING ERRCODE='23514'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<2 OR jsonb_array_length(p_lines)>40 THEN RAISE EXCEPTION 'An entry needs between 2 and 40 lines' USING ERRCODE='23514'; END IF;
 IF id IS NULL THEN
  SELECT COALESCE(max(adj_seq),0)+1 INTO n FROM erp_private.audit_adjustments WHERE audit_file_id=p_file;
  INSERT INTO erp_private.audit_adjustments(audit_file_id,project_id,handling_firm_id,adj_seq,adj_ref,kind,description,basis,misstatement_type,management_response,audit_workpaper_id,prepared_by)
   VALUES(p_file,f.project_id,f.handling_firm_id,n,CASE WHEN p_kind='Adjusting' THEN 'AJ-' ELSE 'UM-' END||lpad(n::text,3,'0'),p_kind,btrim(p_description),btrim(p_basis),CASE WHEN p_kind='Unadjusted' THEN p_type END,COALESCE(btrim(p_response),''),p_workpaper,a.staff_id) RETURNING adjustment_id INTO id;
 ELSE
  SELECT * INTO e FROM erp_private.audit_adjustments WHERE adjustment_id=id AND audit_file_id=p_file FOR UPDATE;
  IF e.adjustment_id IS NULL THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
  IF e.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned entry can be edited' USING ERRCODE='23514'; END IF;
  IF e.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can edit this entry' USING ERRCODE='42501'; END IF;
  IF e.kind<>p_kind THEN RAISE EXCEPTION 'An entry cannot change between adjusting and unadjusted' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.audit_adjustments SET description=btrim(p_description),basis=btrim(p_basis),misstatement_type=CASE WHEN p_kind='Unadjusted' THEN p_type END,management_response=COALESCE(btrim(p_response),''),audit_workpaper_id=p_workpaper,status='Draft' WHERE adjustment_id=id;
  DELETE FROM erp_private.audit_adjustment_lines WHERE adjustment_id=id;
 END IF;
 FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
  i:=i+1;
  BEGIN acct:=(x->>'audit_account_id')::uuid;d:=COALESCE(NULLIF(x->>'debit',''),'0')::numeric;c:=COALESCE(NULLIF(x->>'credit',''),'0')::numeric;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Line % has an invalid account or amount',i USING ERRCODE='22023'; END;
  IF NOT((d>0 AND c=0) OR (c>0 AND d=0)) THEN RAISE EXCEPTION 'Line % must have either a debit or a credit, not both and not neither',i USING ERRCODE='23514'; END IF;
  INSERT INTO erp_private.audit_adjustment_lines(adjustment_id,audit_file_id,project_id,handling_firm_id,line_no,audit_account_id,debit,credit,memo)
   VALUES(id,p_file,f.project_id,f.handling_firm_id,i,acct,round(d,2),round(c,2),left(COALESCE(x->>'memo',''),300));
 END LOOP;
 RETURN id;
END $$;

CREATE FUNCTION erp_private.audit_adjustment_submit(p_adjustment uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_adjustments;dr numeric;cr numeric;cid uuid;r record;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO e FROM erp_private.audit_adjustments WHERE adjustment_id=p_adjustment AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.adjustment_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
 IF e.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned entry can be submitted' USING ERRCODE='23514'; END IF;
 IF e.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can submit this entry' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(sum(debit),0),COALESCE(sum(credit),0) INTO dr,cr FROM erp_private.audit_adjustment_lines WHERE adjustment_id=p_adjustment;
 IF dr=0 OR dr<>cr THEN RAISE EXCEPTION 'The entry must balance: debits % and credits %',dr,cr USING ERRCODE='23514'; END IF;
 IF e.kind='Unadjusted' AND length(btrim(e.management_response))<10 THEN RAISE EXCEPTION 'Record management''s response to the misstatement' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_adjustments SET status='Submitted',submitted_at=now(),review_note='',reviewer_id=NULL,reviewed_at=NULL WHERE adjustment_id=p_adjustment;
 SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=e.audit_file_id;
 FOR r IN SELECT staff_id FROM erp_private.review_candidates(cid) WHERE staff_id<>a.staff_id LOOP
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.staff_id,'Audit entry '||e.adj_ref||' is waiting for review: '||left(e.description,150),'audit-entry:'||p_adjustment::text||':'||e.revision::text||':'||r.staff_id::text) ON CONFLICT DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_adjustment_review(p_adjustment uuid,p_decision text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_adjustments;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'A Manager or Partner reviews audit entries' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM erp_private.audit_adjustments WHERE adjustment_id=p_adjustment AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.adjustment_id IS NULL THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
 IF e.status<>'Submitted' THEN RAISE EXCEPTION 'Only a submitted entry can be reviewed' USING ERRCODE='23514'; END IF;
 IF e.prepared_by=a.staff_id THEN RAISE EXCEPTION 'You cannot review an entry you prepared' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Write a review note of at least 10 characters' USING ERRCODE='23514'; END IF;
 IF p_decision='Approve' THEN
  UPDATE erp_private.audit_adjustments SET status='Approved',reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(p_note) WHERE adjustment_id=p_adjustment;
 ELSIF p_decision='Return' THEN
  UPDATE erp_private.audit_adjustments SET status='Returned',reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(p_note) WHERE adjustment_id=p_adjustment;
 ELSE RAISE EXCEPTION 'Choose Approve or Return' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(e.prepared_by,a.full_name||CASE WHEN p_decision='Approve' THEN ' approved ' ELSE ' returned ' END||'audit entry '||e.adj_ref||': '||left(btrim(p_note),200),'audit-entry-done:'||p_adjustment::text||':'||e.revision::text) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.audit_adjustment_withdraw(p_adjustment uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.audit_adjustments;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO e FROM erp_private.audit_adjustments WHERE adjustment_id=p_adjustment AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF e.adjustment_id IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Entry unavailable' USING ERRCODE='42501'; END IF;
 IF e.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Only a draft or returned entry can be withdrawn' USING ERRCODE='23514'; END IF;
 IF e.prepared_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the preparer or a Manager or Partner can withdraw this entry' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why it is withdrawn, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_adjustments SET status='Withdrawn',review_note=btrim(p_reason) WHERE adjustment_id=p_adjustment;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Trial balance with approved adjusting entries applied. Debit is positive, credit negative.
CREATE FUNCTION erp_private.audit_adjusted_tb(p_file uuid) RETURNS TABLE(audit_account_id uuid,account_code text,account_name text,audit_area text,financial_statement_line text,tb_net numeric,adjustment_net numeric,adjusted_net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN; END IF;
 RETURN QUERY
 WITH cur AS (SELECT l.audit_account_id aid,sum(l.source_debit-l.source_credit) net FROM erp_private.audit_tb_lines l JOIN erp_private.audit_tb_imports i ON i.audit_tb_import_id=l.audit_tb_import_id WHERE i.audit_file_id=p_file AND i.period_kind='Current' AND i.status='Confirmed' AND l.audit_account_id IS NOT NULL GROUP BY 1),
 adj AS (SELECT al.audit_account_id aid,sum(al.debit-al.credit) net FROM erp_private.audit_adjustment_lines al JOIN erp_private.audit_adjustments a ON a.adjustment_id=al.adjustment_id WHERE a.audit_file_id=p_file AND a.kind='Adjusting' AND a.status='Approved' GROUP BY 1)
 SELECT m.audit_account_id,m.legacy_account_code,m.legacy_account_name,m.audit_area,m.financial_statement_line,COALESCE(cur.net,0),COALESCE(adj.net,0),COALESCE(cur.net,0)+COALESCE(adj.net,0)
 FROM erp_private.audit_account_mappings m LEFT JOIN cur ON cur.aid=m.audit_account_id LEFT JOIN adj ON adj.aid=m.audit_account_id
 WHERE cur.aid IS NOT NULL OR adj.aid IS NOT NULL ORDER BY m.legacy_account_code;
END $$;

-- Accumulated unadjusted misstatements. An item is clearly trivial when neither its profit nor its net assets effect is above the trivial threshold.
CREATE FUNCTION erp_private.audit_misstatement_calc(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE mat erp_private.audit_materiality;items jsonb;gross numeric:=0;net numeric:=0;con record;
BEGIN
 SELECT * INTO mat FROM erp_private.audit_materiality WHERE audit_file_id=p_file AND status='Approved';
 WITH x AS (SELECT a.adjustment_id,a.adj_ref,a.description,a.misstatement_type,a.management_response,a.status,e.profit_effect,e.tax_effect,e.net_assets_effect,
   (mat.materiality_id IS NOT NULL AND greatest(abs(e.profit_effect),abs(e.net_assets_effect))<=mat.trivial_amount) AS trivial
  FROM erp_private.audit_adjustments a CROSS JOIN LATERAL erp_private.audit_entry_effects(a.adjustment_id) e WHERE a.audit_file_id=p_file AND a.kind='Unadjusted' AND a.status IN('Submitted','Approved') ORDER BY a.adj_seq)
 SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb),COALESCE(sum(abs(x.profit_effect)) FILTER(WHERE x.status='Approved' AND NOT x.trivial),0),COALESCE(sum(x.profit_effect) FILTER(WHERE x.status='Approved' AND NOT x.trivial),0) INTO items,gross,net FROM x;
 SELECT * INTO con FROM erp_private.audit_misstatement_conclusions WHERE audit_file_id=p_file ORDER BY concluded_at DESC LIMIT 1;
 RETURN jsonb_build_object('items',items,'gross_profit_effect',gross,'net_profit_effect',net,
  'overall_materiality',mat.overall_amount,'performance_materiality',mat.performance_amount,'clearly_trivial',mat.trivial_amount,
  'exceeds_overall',(mat.materiality_id IS NOT NULL AND gross>mat.overall_amount),'exceeds_performance',(mat.materiality_id IS NOT NULL AND gross>mat.performance_amount),
  'conclusion',CASE WHEN con.conclusion_id IS NULL THEN NULL ELSE jsonb_build_object('note',con.note,'accumulated_gross',con.accumulated_gross,'concluded_at',con.concluded_at,'current',con.accumulated_gross=gross) END);
END $$;

CREATE FUNCTION erp_private.audit_misstatement_schedule(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN NULL; END IF;
 RETURN erp_private.audit_misstatement_calc(p_file);
END $$;

CREATE FUNCTION erp_private.audit_misstatement_conclude(p_file uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;s jsonb;mat erp_private.audit_materiality;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner records the conclusion on unadjusted misstatements' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed' USING ERRCODE='23514'; END IF;
 SELECT * INTO mat FROM erp_private.audit_materiality WHERE audit_file_id=p_file AND status='Approved';
 IF mat.materiality_id IS NULL THEN RAISE EXCEPTION 'Approve materiality first' USING ERRCODE='23514'; END IF;
 s:=erp_private.audit_misstatement_calc(p_file);
 IF length(btrim(COALESCE(p_note,'')))<30 THEN RAISE EXCEPTION 'Record your conclusion in at least 30 characters' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.audit_misstatement_conclusions(audit_file_id,project_id,handling_firm_id,accumulated_gross,overall_amount,note,concluded_by) VALUES(p_file,f.project_id,f.handling_firm_id,(s->>'gross_profit_effect')::numeric,mat.overall_amount,btrim(p_note),a.staff_id);
 RETURN jsonb_build_object('ok',true);
END $$;

-- Gates on the audit file. Review needs no draft or returned entries. Approval needs every entry decided and, where unadjusted misstatements exceed
-- overall materiality, a current Partner conclusion.
CREATE FUNCTION erp_private.audit_file_adjustment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE open_n integer;s jsonb;con jsonb;
BEGIN
 IF NEW.file_status IS NOT DISTINCT FROM OLD.file_status OR NEW.file_status NOT IN('In Review','Approved') THEN RETURN NEW; END IF;
 SELECT count(*) INTO open_n FROM erp_private.audit_adjustments WHERE audit_file_id=NEW.audit_file_id AND status IN('Draft','Returned');
 IF open_n>0 THEN RAISE EXCEPTION 'Submit or withdraw every draft and returned audit entry first (% open)',open_n USING ERRCODE='23514'; END IF;
 IF NEW.file_status='Approved' THEN
  SELECT count(*) INTO open_n FROM erp_private.audit_adjustments WHERE audit_file_id=NEW.audit_file_id AND status='Submitted';
  IF open_n>0 THEN RAISE EXCEPTION 'Review every submitted audit entry first (% waiting)',open_n USING ERRCODE='23514'; END IF;
  s:=erp_private.audit_misstatement_calc(NEW.audit_file_id);
  IF s IS NOT NULL AND (s->>'exceeds_overall')::boolean THEN
   con:=s->'conclusion';
   IF con IS NULL OR con='null'::jsonb OR NOT (con->>'current')::boolean THEN RAISE EXCEPTION 'Unadjusted misstatements exceed overall materiality. A Partner must record a current conclusion first' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER adjustment_guard BEFORE UPDATE OF file_status ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.audit_file_adjustment_guard();

REVOKE ALL ON FUNCTION erp_private.audit_misstatement_calc(uuid),erp_private.audit_file_adjustment_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.audit_entry_effects(uuid),erp_private.audit_adjustment_save(uuid,uuid,text,text,text,text,text,uuid,jsonb),erp_private.audit_adjustment_submit(uuid),erp_private.audit_adjustment_review(uuid,text,text),erp_private.audit_adjustment_withdraw(uuid,text),erp_private.audit_adjusted_tb(uuid),erp_private.audit_misstatement_schedule(uuid),erp_private.audit_misstatement_conclude(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.audit_entry_effects(uuid),erp_private.audit_adjustment_save(uuid,uuid,text,text,text,text,text,uuid,jsonb),erp_private.audit_adjustment_submit(uuid),erp_private.audit_adjustment_review(uuid,text,text),erp_private.audit_adjustment_withdraw(uuid,text),erp_private.audit_adjusted_tb(uuid),erp_private.audit_misstatement_schedule(uuid),erp_private.audit_misstatement_conclude(uuid,text) TO erp_api;
