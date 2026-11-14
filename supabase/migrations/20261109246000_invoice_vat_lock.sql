-- Firm policy: every invoice is VATable at 16%, except disbursements, which carry no VAT.
-- * A trigger on invoices refuses any new invoice, or any change to an invoice's lines or amounts, that breaks the rule. There is no single
--   vat_rate column (each line has its own), and old invoices keep the rate they were billed at, so a table CHECK cannot express the rule; the
--   trigger does. It only looks at new rows and at edits to lines or amounts, never at posting or voiding an old invoice.
-- * Fee lines must carry exactly 16%. Disbursement lines (line_type Disbursement) must carry 0% and 0 VAT. Totals must equal the sum of the lines.
-- * Recurring fee schedules are brought to 16% and locked with a CHECK; the daily run bills 16%.
CREATE FUNCTION erp_private.invoice_vat_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE l jsonb;lt text;sn numeric:=0;sv numeric:=0;ln numeric;lv numeric;lr numeric;
BEGIN
 IF TG_OP='UPDATE' AND NEW.lines IS NOT DISTINCT FROM OLD.lines AND NEW.net_amount IS NOT DISTINCT FROM OLD.net_amount AND NEW.vat_amount IS NOT DISTINCT FROM OLD.vat_amount THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.lines)<>'array' OR jsonb_array_length(NEW.lines)=0 THEN RAISE EXCEPTION 'An invoice needs at least one line.' USING ERRCODE='23514'; END IF;
 FOR l IN SELECT * FROM jsonb_array_elements(NEW.lines) LOOP
  lt:=COALESCE(l->>'line_type','Fee');lr:=COALESCE((l->>'vat_rate')::numeric,-1);ln:=COALESCE((l->>'net')::numeric,0);lv:=COALESCE((l->>'vat')::numeric,0);
  IF lt='Fee' THEN
   IF lr<>16 OR abs(lv-round(ln*0.16,2))>0.01 THEN RAISE EXCEPTION 'Firm policy requires all invoices to be VATable at 16%%.' USING ERRCODE='23514'; END IF;
  ELSIF lt='Disbursement' THEN
   IF lr<>0 OR lv<>0 THEN RAISE EXCEPTION 'Disbursements are not VATable. Enter them with no VAT.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Choose Fee or Disbursement for each invoice line.' USING ERRCODE='23514'; END IF;
  sn:=sn+ln;sv:=sv+lv;
 END LOOP;
 IF abs(NEW.net_amount-sn)>0.01 OR abs(NEW.vat_amount-sv)>0.01 THEN RAISE EXCEPTION 'Firm policy requires all invoices to be VATable at 16%%.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_vat_guard BEFORE INSERT OR UPDATE ON erp_private.invoices FOR EACH ROW EXECUTE FUNCTION erp_private.invoice_vat_guard();
REVOKE ALL ON FUNCTION erp_private.invoice_vat_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;

UPDATE erp_private.recurring_fee_schedules SET vat_rate=16 WHERE vat_rate<>16;
ALTER TABLE erp_private.recurring_fee_schedules ALTER COLUMN vat_rate SET DEFAULT 16;
ALTER TABLE erp_private.recurring_fee_schedules ADD CONSTRAINT recurring_fee_vat_16 CHECK(vat_rate=16.0);

CREATE OR REPLACE FUNCTION erp_private.run_recurring_fee_drafts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s record;i integer;step integer;pstart date;pend date;nxt date;lastd date;months integer;k integer;endk date;
 today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;mstart date:=date_trunc('month',(now() AT TIME ZONE 'Africa/Nairobi')::date)::date;
 narr text;net numeric;vat numeric;issue date;made integer;total integer:=0;ym text:=to_char((now() AT TIME ZONE 'Africa/Nairobi')::date,'YYYY-MM');
BEGIN
 FOR s IN SELECT f.*,p.client_id,p.handling_firm_id,p.project_name,p.owner_staff_id FROM erp_private.recurring_fee_schedules f JOIN erp_private.projects p ON p.project_id=f.project_id
   WHERE f.status='Active' AND p.status='Active' AND p.deleted_at IS NULL LOOP
  step:=CASE s.frequency WHEN 'Monthly' THEN 1 WHEN 'Quarterly' THEN 3 ELSE 12 END;made:=0;
  FOR i IN 0..119 LOOP
   pstart:=erp_private.fee_add_months(s.starts_on,i*step);
   EXIT WHEN pstart>today OR (s.ends_on IS NOT NULL AND pstart>s.ends_on) OR made>=12;
   CONTINUE WHEN EXISTS(SELECT 1 FROM erp_private.invoices x WHERE x.recurring_fee_schedule_id=s.fee_schedule_id AND x.recurring_period_start=pstart AND x.deleted_at IS NULL);
   nxt:=erp_private.fee_add_months(s.starts_on,(i+1)*step);lastd:=nxt-1;pend:=CASE WHEN s.ends_on IS NOT NULL AND s.ends_on<lastd THEN s.ends_on ELSE lastd END;
   months:=NULL;FOR k IN 1..60 LOOP endk:=erp_private.fee_add_months(pstart,k)-1;IF endk=pend THEN months:=k;EXIT;END IF;EXIT WHEN endk>pend;END LOOP;
   narr:=s.description||' '||CASE WHEN months IS NOT NULL THEN months||' Month'||CASE WHEN months=1 THEN '' ELSE 's' END||' ' ELSE '' END||erp_private.fee_day_text(pstart)||' to '||erp_private.fee_day_text(pend);
   net:=round(s.amount_ex_vat,2);vat:=round(net*16/100,2);issue:=CASE WHEN pstart>=mstart THEN pstart ELSE today END;
   INSERT INTO erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,recurring_fee_schedule_id,recurring_period_start,service_from,service_to,service_months,created_by)
   VALUES(gen_random_uuid(),s.project_id,s.client_id,s.handling_firm_id,narr,issue,issue+14,
    jsonb_build_array(jsonb_build_object('description',narr,'quantity',1,'unit_price',s.amount_ex_vat::float8,'line_type','Fee','vat_rate',16.0::float8,'net',net::float8,'vat',vat::float8,'total',(net+vat)::float8)),net,vat,s.fee_schedule_id,pstart,pstart,pend,months,s.created_by)
   ON CONFLICT DO NOTHING;
   IF FOUND THEN made:=made+1;total:=total+1;END IF;
  END LOOP;
  IF made>0 THEN
   INSERT INTO erp_private.notifications(recipient_id,message,event_key)
   SELECT DISTINCT x.sid,made||' recurring invoice draft(s) were created for '||s.project_name||'. Open Finance, review and post them.','fee-drafts:'||s.fee_schedule_id||':'||ym||':'||x.sid
   FROM (VALUES(s.created_by),(s.owner_staff_id)) AS x(sid) WHERE x.sid IS NOT NULL ON CONFLICT(event_key) DO NOTHING;
   INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values)
   VALUES(NULL,current_user,'recurring_fee_schedules','AUTO_DRAFTS',s.fee_schedule_id::text,jsonb_build_object('drafts',made,'run_on',today));
  END IF;
 END LOOP;
 RETURN total;
END;$$;

-- Fix found while testing the VAT lock: voiding a Posted invoice was refused with "Posted invoice is immutable", because the generated
-- total_amount column is not yet filled in when the guard runs and so looked changed. total_amount is net plus VAT, both of which are still compared.
CREATE OR REPLACE FUNCTION erp_private.suite_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='tax_rates' THEN
  IF OLD.status='Approved' THEN RAISE EXCEPTION 'Approved rate versions are immutable' USING ERRCODE='23514';END IF;
  IF NEW.status='Approved' AND (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='invoices' THEN
  IF OLD.status<>'Draft' AND (to_jsonb(NEW)-ARRAY['status','void_reason','revision','updated_at','total_amount']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','void_reason','revision','updated_at','total_amount']) THEN RAISE EXCEPTION 'Posted invoice is immutable' USING ERRCODE='23514';END IF;
  IF OLD.status='Void' OR (OLD.status='Posted' AND NEW.status<>'Void') THEN RAISE EXCEPTION 'Invalid invoice transition' USING ERRCODE='23514';END IF;
  IF (NEW.client_id,NEW.firm_id,NEW.project_id,NEW.created_by,NEW.request_id) IS DISTINCT FROM (OLD.client_id,OLD.firm_id,OLD.project_id,OLD.created_by,OLD.request_id) THEN RAISE EXCEPTION 'Invoice identity is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='tax_cases' THEN
  IF OLD.status IN ('Locked','Filed') AND (to_jsonb(NEW)-ARRAY['status','filing_date','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','filing_date','revision','updated_at']) THEN RAISE EXCEPTION 'Locked tax snapshot cannot change' USING ERRCODE='23514';END IF;
  IF OLD.status='Filed' OR (OLD.status='Locked' AND NEW.status<>'Filed') THEN RAISE EXCEPTION 'Tax file is locked' USING ERRCODE='23514';END IF;
  IF (NEW.project_id,NEW.kind,NEW.starts_on,NEW.ends_on,NEW.prepared_by) IS DISTINCT FROM (OLD.project_id,OLD.kind,OLD.starts_on,OLD.ends_on,OLD.prepared_by) THEN RAISE EXCEPTION 'Tax period identity is immutable' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
