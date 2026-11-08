-- Build .106 (staging): Partner-managed public holidays, firm and manager metrics, and "manual time is what is recorded" for task timers.

-- 1. Holidays. is_working_day=true means the firm works that day, so the clocks keep running. Only Partners add or change rows, with a reason.
ALTER TABLE erp_private.public_holidays
 ADD COLUMN is_working_day boolean NOT NULL DEFAULT false,
 ADD COLUMN source text,
 ADD COLUMN confirmed_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN confirmed_at timestamptz,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN revision bigint NOT NULL DEFAULT 1;
CREATE INDEX public_holidays_confirmed_by_idx ON erp_private.public_holidays(confirmed_by);
UPDATE erp_private.public_holidays SET name='Mazingira Day' WHERE holiday_date IN ('2027-10-10') ;
UPDATE erp_private.public_holidays SET name='Mazingira Day (Sunday observed on Monday)' WHERE holiday_date='2027-10-11';
UPDATE erp_private.public_holidays SET name='Boxing Day / Utamaduni Day' WHERE holiday_date IN ('2026-12-26','2027-12-26');
UPDATE erp_private.public_holidays SET name='Boxing Day / Utamaduni Day (Sunday observed on Monday)' WHERE holiday_date='2027-12-27';
UPDATE erp_private.public_holidays SET source='Seeded from public holiday listings (build .105). A Partner should check against the Kenya Gazette.' WHERE source IS NULL;
INSERT INTO erp_private.public_holidays(holiday_date,name,source) VALUES
 ('2026-01-01','New Year''s Day','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2026-03-20','Eid al-Fitr (date depends on moon sighting)','Seeded from public holiday listings, marked provisional there (build .106). A Partner should confirm the gazetted date.'),
 ('2026-04-03','Good Friday','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2026-04-06','Easter Monday','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2026-05-01','Labour Day','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2026-05-27','Eid al-Adha (date depends on moon sighting)','Seeded from public holiday listings (build .106). A Partner should confirm the gazetted date.'),
 ('2026-06-01','Madaraka Day','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2026-10-10','Mazingira Day','Seeded from public holiday listings (build .106). Falls on a Saturday.'),
 ('2026-10-20','Mashujaa Day','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2027-03-10','Eid al-Fitr (date depends on moon sighting)','Seeded from public holiday listings (build .106). A Partner should confirm the gazetted date.'),
 ('2027-03-26','Good Friday','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2027-03-29','Easter Monday','Seeded from public holiday listings (build .106). A Partner should check against the Kenya Gazette.'),
 ('2027-05-17','Eid al-Adha (date depends on moon sighting)','Seeded from public holiday listings (build .106). A Partner should confirm the gazetted date.')
ON CONFLICT (holiday_date) DO NOTHING;
ALTER TABLE erp_private.public_holidays ADD CONSTRAINT public_holidays_source_check CHECK(source IS NULL OR length(btrim(source))>=10);
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.public_holidays FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.public_holidays FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('holiday_date');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.public_holidays FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

CREATE FUNCTION erp_private.holiday_save(p_date date,p_name text,p_is_working_day boolean,p_source text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change the holiday calendar' USING ERRCODE='42501'; END IF;
 IF p_date IS NULL OR p_date<'2020-01-01' OR p_date>'2100-12-31' THEN RAISE EXCEPTION 'Choose a valid date' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_name,'')))<3 THEN RAISE EXCEPTION 'Enter the holiday name' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_source,'')))<10 THEN RAISE EXCEPTION 'Record the source or reason (at least 10 characters), for example the Gazette notice.' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.public_holidays(holiday_date,name,is_working_day,source,confirmed,confirmed_by,confirmed_at)
  VALUES(p_date,btrim(p_name),coalesce(p_is_working_day,false),btrim(p_source),true,a.staff_id,now())
  ON CONFLICT (holiday_date) DO UPDATE SET name=EXCLUDED.name,is_working_day=EXCLUDED.is_working_day,source=EXCLUDED.source,confirmed=true,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now();
END $$;
REVOKE ALL ON FUNCTION erp_private.holiday_save(date,text,boolean,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.holiday_save(date,text,boolean,text) TO erp_api;

-- The clock skips only the days the firm does not work.
CREATE OR REPLACE FUNCTION erp_private.working_seconds(p_from timestamptz,p_to timestamptz) RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_from IS NULL OR p_to IS NULL OR p_to<=p_from THEN 0 ELSE coalesce((
  SELECT sum(greatest(0,extract(epoch FROM least(p_to,(g.d+time '17:00') AT TIME ZONE 'Africa/Nairobi')-greatest(p_from,(g.d+time '08:00') AT TIME ZONE 'Africa/Nairobi'))))
  FROM (SELECT x::date d FROM generate_series((p_from AT TIME ZONE 'Africa/Nairobi')::date,(p_to AT TIME ZONE 'Africa/Nairobi')::date,interval '1 day') x) g
  WHERE extract(isodow FROM g.d)<6 AND NOT EXISTS(SELECT 1 FROM erp_private.public_holidays h WHERE h.holiday_date=g.d AND NOT h.is_working_day)),0) END
$$;

-- 2. Task timer is a helper. The recorded time is the hours the person keys in. The timer only suggests a figure; it no longer creates a time entry.
ALTER TABLE erp_private.task_timers ADD COLUMN suggested_seconds integer,ADD COLUMN suggested_task_id uuid REFERENCES erp_private.tasks,ADD COLUMN suggested_date date;
CREATE INDEX task_timers_suggested_task_idx ON erp_private.task_timers(suggested_task_id) WHERE suggested_task_id IS NOT NULL;
ALTER TABLE erp_private.timesheets ADD COLUMN timer_seconds integer CHECK(timer_seconds IS NULL OR timer_seconds>=0),
 ADD COLUMN time_source text NOT NULL DEFAULT 'Manual' CHECK(time_source IN ('Manual','Manual with timer'));

-- 3. Metrics for Partners (firm-wide) and Managers (only clients they oversee). Invoices only; credit notes are not part of V1.
--    Realization = net fees billed (Posted invoices, excluding VAT) / standard billable value of approved billable hours x 100.
--    Cash collected and gross margin are reported separately and never folded into realization.
CREATE FUNCTION erp_private.oversight_clients(p_staff uuid,p_category text) RETURNS TABLE(client_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.client_id FROM erp_private.clients c WHERE c.deleted_at IS NULL AND (p_category='PARTNER' OR c.owner_staff_id=p_staff
  OR EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.client_id=c.client_id AND p.deleted_at IS NULL AND (p.owner_staff_id=p_staff
     OR EXISTS(SELECT 1 FROM erp_private.project_assignments pa WHERE pa.project_id=p.project_id AND pa.staff_id=p_staff AND pa.deleted_at IS NULL))))
$$;
REVOKE ALL ON FUNCTION erp_private.oversight_clients(uuid,text) FROM PUBLIC,anon,authenticated,service_role,erp_api;

CREATE FUNCTION erp_private.metrics_summary(p_from date,p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;res jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN ('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Managers and Partners only' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>1100 THEN RAISE EXCEPTION 'Choose a valid period of up to three years' USING ERRCODE='22023'; END IF;
 WITH sc AS(SELECT client_id FROM erp_private.oversight_clients(a.staff_id,a.category_code)),
 te AS(SELECT p.client_id,t.work_date,t.hours,t.billable,r.billable_rate,r.cost_rate FROM erp_private.timesheets t
   JOIN erp_private.projects p ON p.project_id=t.project_id JOIN sc ON sc.client_id=p.client_id
   LEFT JOIN LATERAL(SELECT x.billable_rate,x.cost_rate FROM erp_private.staff_rates x WHERE x.staff_id=t.staff_id AND t.work_date BETWEEN x.effective_from AND x.effective_to ORDER BY x.effective_from DESC LIMIT 1) r ON true
   WHERE t.status='Approved' AND t.deleted_at IS NULL AND t.work_date<=p_to),
 inv AS(SELECT i.client_id,i.invoice_date,i.net_amount,i.total_amount,i.due_date,i.invoice_id FROM erp_private.invoices i JOIN sc ON sc.client_id=i.client_id WHERE i.status='Posted' AND i.deleted_at IS NULL),
 paid AS(SELECT y.invoice_id,sum(y.amount) paid FROM erp_private.payments y JOIN inv ON inv.invoice_id=y.invoice_id GROUP BY y.invoice_id),
 per AS(SELECT
   coalesce((SELECT sum(hours*billable_rate) FROM te WHERE billable AND billable_rate IS NOT NULL AND work_date>=p_from),0) std_value,
   coalesce((SELECT sum(hours) FROM te WHERE billable AND billable_rate IS NULL AND work_date>=p_from),0) hours_no_rate,
   coalesce((SELECT sum(hours*cost_rate) FROM te WHERE cost_rate IS NOT NULL AND work_date>=p_from),0) staff_cost,
   coalesce((SELECT sum(net_amount) FROM inv WHERE invoice_date BETWEEN p_from AND p_to),0) billed_net,
   coalesce((SELECT sum(y.amount) FROM erp_private.payments y JOIN inv ON inv.invoice_id=y.invoice_id WHERE y.payment_date BETWEEN p_from AND p_to),0) cash),
 wipc AS(SELECT c.client_id,
   coalesce((SELECT sum(hours*billable_rate) FROM te WHERE te.client_id=c.client_id AND billable AND billable_rate IS NOT NULL),0) std,
   coalesce((SELECT sum(net_amount) FROM inv WHERE inv.client_id=c.client_id AND invoice_date<=p_to),0) billed FROM sc c),
 ag AS(SELECT inv.invoice_id,inv.total_amount-coalesce(paid.paid,0) outstanding,today-inv.due_date days FROM inv LEFT JOIN paid ON paid.invoice_id=inv.invoice_id WHERE inv.total_amount-coalesce(paid.paid,0)>0)
 SELECT jsonb_build_object(
  'scope',CASE WHEN a.category_code='PARTNER' THEN 'firm' ELSE 'clients you oversee' END,
  'client_count',(SELECT count(*) FROM sc),'period_from',p_from,'period_to',p_to,
  'billed_net',per.billed_net,'standard_value',per.std_value,
  'realization_pct',CASE WHEN per.std_value>0 THEN round(per.billed_net/per.std_value*100,1) END,
  'hours_without_rate',per.hours_no_rate,
  'wip_unbilled',(SELECT coalesce(sum(greatest(0,std-billed)),0) FROM wipc),
  'receivables_total',(SELECT coalesce(sum(outstanding),0) FROM ag),
  'ageing',jsonb_build_object(
    'not_due',(SELECT coalesce(sum(outstanding),0) FROM ag WHERE days<=0),
    'd1_30',(SELECT coalesce(sum(outstanding),0) FROM ag WHERE days BETWEEN 1 AND 30),
    'd31_60',(SELECT coalesce(sum(outstanding),0) FROM ag WHERE days BETWEEN 31 AND 60),
    'd61_90',(SELECT coalesce(sum(outstanding),0) FROM ag WHERE days BETWEEN 61 AND 90),
    'over_90',(SELECT coalesce(sum(outstanding),0) FROM ag WHERE days>90)),
  'cash_collected',per.cash,'staff_cost',per.staff_cost,'gross_margin',per.billed_net-per.staff_cost)
 INTO res FROM per;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION erp_private.metrics_summary(date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.metrics_summary(date,date) TO erp_api;
