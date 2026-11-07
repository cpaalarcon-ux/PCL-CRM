-- Recurring fees: a daily run creates the draft invoice for every period that has started and has none yet. It follows exactly the
-- rules of the "Generate drafts" button (same period maths, same narration, same VAT split, dated at the start of the period when that
-- is in the current month, else today; due 14 days later). Drafts are never posted automatically: a Partner reviews and posts them.
-- The people who set the schedule up and the project owner are notified once per month per schedule.
CREATE FUNCTION erp_private.fee_day_text(d date) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT extract(day FROM d)::int||' '||(ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month FROM d)::int]||' '||extract(year FROM d)::int;
$$;
-- The date n months after a start date, keeping the day of the month but never passing the end of a shorter month (31 Jan + 1 month = 28/29 Feb).
CREATE FUNCTION erp_private.fee_add_months(d date,n integer) RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (date_trunc('month',d)+make_interval(months=>n))::date+LEAST(extract(day FROM d)::int,extract(day FROM (date_trunc('month',d)+make_interval(months=>n+1))::date-1)::int)-1;
$$;
CREATE FUNCTION erp_private.run_recurring_fee_drafts() RETURNS integer
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
   net:=round(s.amount_ex_vat,2);vat:=round(net*s.vat_rate/100,2);issue:=CASE WHEN pstart>=mstart THEN pstart ELSE today END;
   INSERT INTO erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,recurring_fee_schedule_id,recurring_period_start,service_from,service_to,service_months,created_by)
   VALUES(gen_random_uuid(),s.project_id,s.client_id,s.handling_firm_id,narr,issue,issue+14,
    jsonb_build_array(jsonb_build_object('description',narr,'quantity',1,'unit_price',s.amount_ex_vat::float8,'vat_rate',s.vat_rate::float8,'net',net::float8,'vat',vat::float8,'total',(net+vat)::float8)),net,vat,s.fee_schedule_id,pstart,pstart,pend,months,s.created_by)
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
REVOKE ALL ON FUNCTION erp_private.run_recurring_fee_drafts() FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.fee_day_text(date),erp_private.fee_add_months(date,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.fee_day_text(date),erp_private.fee_add_months(date,integer) TO erp_api;
SELECT cron.schedule('recurring-fee-drafts','20 3 * * *','select erp_private.run_recurring_fee_drafts()');
