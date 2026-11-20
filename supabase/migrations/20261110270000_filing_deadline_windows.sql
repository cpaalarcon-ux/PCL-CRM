-- Filing deadline windows (build 2026-11-10.2710), from the Partner's written instruction of 10 Nov 2026 17:02.
-- A matrix of two numbers for each kind of filing: how many days BEFORE the due date it is flagged "due soon", and how many days AFTER the due date
-- the Partners get one alert (flag and alert only: nothing is blocked; the Partner chose this on 10 Nov). Defaults:
--   PAYE and payroll  (due the 9th):            warn 3 days, late alert 3 days
--   VAT and monthly   (due the 20th):           warn 5 days, late alert 3 days
--   Annual            (due 30 June or April):   warn 14 days, late alert 3 days
-- The values are database defaults. They show "Default - not yet confirmed" until a Partner records the confirmation with its written source (Claude never
-- records that confirmation), and a Partner can change any of them in Settings. The dates are measured from the due date already on the filing task; no statutory
-- calendar is stored here, and no tax rate or threshold is added.

CREATE TABLE erp_private.deadline_settings(
 setting_key text PRIMARY KEY,
 label text NOT NULL,
 int_value integer NOT NULL,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed')),
 source_note text,
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(rule_status='Suggested' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(COALESCE(source_note,'')))>=10)),
 CHECK(rule_status<>'Suggested' OR (confirmed_by IS NULL AND confirmed_at IS NULL))
);
CREATE INDEX deadline_settings_confirmed_by_idx ON erp_private.deadline_settings(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX deadline_settings_updated_by_idx ON erp_private.deadline_settings(updated_by) WHERE updated_by IS NOT NULL;
INSERT INTO erp_private.deadline_settings(setting_key,label,int_value,source_note) VALUES
 ('paye_warn_days','PAYE and payroll filings (due the 9th): flag as due soon this many days before the due date',3,'Default from the Partner''s written instruction of 10 Nov 2026. A Partner records the confirmation.'),
 ('paye_late_days','PAYE and payroll filings (due the 9th): alert the Partners this many days after the due date',3,'Default from the Partner''s written instruction of 10 Nov 2026. A Partner records the confirmation.'),
 ('vat_warn_days','VAT and monthly filings (due the 20th): flag as due soon this many days before the due date',5,'Default from the Partner''s written instruction of 10 Nov 2026. A Partner records the confirmation.'),
 ('vat_late_days','VAT and monthly filings (due the 20th): alert the Partners this many days after the due date',3,'Default from the Partner''s written instruction of 10 Nov 2026. A Partner records the confirmation.'),
 ('annual_warn_days','Annual filings (due 30 June or April): flag as due soon this many days before the due date',14,'Default from the Partner''s written instruction of 10 Nov 2026. A Partner records the confirmation.'),
 ('annual_late_days','Annual filings (due 30 June or April): alert the Partners this many days after the due date',3,'Default from the Partner''s written instruction of 10 Nov 2026. A Partner records the confirmation.');
ALTER TABLE erp_private.deadline_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.deadline_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON erp_private.deadline_settings TO erp_api;
CREATE POLICY deadline_settings_read ON erp_private.deadline_settings FOR SELECT TO erp_api USING(true);
CREATE POLICY deadline_settings_update ON erp_private.deadline_settings FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');

CREATE FUNCTION erp_private.deadline_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF ROW(NEW.setting_key,NEW.label) IS DISTINCT FROM ROW(OLD.setting_key,OLD.label) THEN RAISE EXCEPTION 'A setting cannot be renamed' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change or confirm a filing-window setting' USING ERRCODE='42501'; END IF;
 IF NEW.int_value IS DISTINCT FROM OLD.int_value THEN
  IF NEW.setting_key LIKE '%\_warn\_days' AND (NEW.int_value<1 OR NEW.int_value>90) THEN RAISE EXCEPTION 'Use a number of days from 1 to 90' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key LIKE '%\_late\_days' AND (NEW.int_value<1 OR NEW.int_value>60) THEN RAISE EXCEPTION 'Use a number of days from 1 to 60' USING ERRCODE='23514'; END IF;
  IF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN RAISE EXCEPTION 'Change the value first; a Partner then records the confirmation' USING ERRCODE='23514'; END IF;
  NEW.rule_status:='Suggested';NEW.confirmed_by:=NULL;NEW.confirmed_at:=NULL;NEW.source_note:=NULL;NEW.updated_by:=v_actor;
 ELSIF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN
  IF NEW.rule_status<>'Confirmed' THEN RAISE EXCEPTION 'A confirmation is withdrawn by changing the value' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the confirmation must be the signed-in Partner' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.source_note,'')))<10 THEN RAISE EXCEPTION 'Say who confirmed this and where it is written (at least 10 characters)' USING ERRCODE='23514'; END IF;
  NEW.confirmed_at:=now();NEW.updated_by:=v_actor;
 ELSIF ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.source_note) IS DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at,OLD.source_note) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be edited' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deadline_guard BEFORE UPDATE ON erp_private.deadline_settings FOR EACH ROW EXECUTE FUNCTION erp_private.deadline_settings_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.deadline_settings FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.deadline_settings FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER UPDATE ON erp_private.deadline_settings FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('setting_key');

CREATE FUNCTION erp_private.deadline_int(p_key text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT int_value FROM erp_private.deadline_settings WHERE setting_key=p_key
$$;

-- Open filing tasks with where they stand today. Internal: the card and the nightly alert call it; the application role cannot.
-- Kind of filing, from the task's template: PAYE (PAYE and payroll), VAT (VAT, TOT and the other monthly tasks), ANNUAL (annual tasks). Weekly tasks have no window.
CREATE FUNCTION erp_private.filing_state(p_clients uuid[] DEFAULT NULL)
RETURNS TABLE(task_id uuid,project_id uuid,client_id uuid,task_name text,filing_class text,due_date date,days_left integer,warn_days integer,late_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT t.task_id,t.project_id,p.client_id,t.task_name,x.cls,d.due,(d.due-((now() AT TIME ZONE 'Africa/Nairobi')::date))::integer,
  erp_private.deadline_int(lower(x.cls)||'_warn_days'),erp_private.deadline_int(lower(x.cls)||'_late_days')
 FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id
 CROSS JOIN LATERAL(SELECT CASE WHEN t.template_key IN('monthly-paye','monthly-payroll') THEN 'PAYE' WHEN t.template_key LIKE 'monthly-%' THEN 'VAT' WHEN t.template_key LIKE 'annual-%' THEN 'ANNUAL' END AS cls) x
 CROSS JOIN LATERAL(SELECT (t.due_at AT TIME ZONE 'Africa/Nairobi')::date AS due) d
 WHERE x.cls IS NOT NULL AND t.deleted_at IS NULL AND t.due_at IS NOT NULL AND t.status NOT IN('Completed','Cancelled')
  AND (p_clients IS NULL OR p.client_id=ANY(p_clients))
$$;
REVOKE EXECUTE ON FUNCTION erp_private.filing_state(uuid[]),erp_private.deadline_int(text) FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- The card: the same function as before with four more figures (how many filings are due soon and the fewest days left; how many are past due and the most days late).
DROP FUNCTION erp_private.client_card_flags(uuid[]);
CREATE FUNCTION erp_private.client_card_flags(p_client_ids uuid[])
RETURNS TABLE(client_id uuid,kra_open integer,kra_days integer,incoming_waiting integer,incoming_overdue integer,filing_soon integer,filing_soon_days integer,filing_late integer,filing_late_days integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;v_lim integer;v_rev boolean;v_od integer;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN RETURN; END IF;
 IF cardinality(COALESCE(p_client_ids,'{}'::uuid[]))>500 THEN RAISE EXCEPTION 'Ask for 500 clients or fewer' USING ERRCODE='22023'; END IF;
 v_lim:=erp_private.kra_int('flag_b_days');
 v_od:=COALESCE(erp_private.incoming_int('overdue_days'),3);
 -- A person who may not review the Incoming queue sees no incoming figure, the same rule as the menu count.
 v_rev:=erp_private.incoming_my_rank()>=1 AND erp_private.incoming_my_rank()>=erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role'));
 RETURN QUERY
 WITH fs AS MATERIALIZED(SELECT * FROM erp_private.filing_state(p_client_ids))
 SELECT c.client_id,
  (SELECT count(*)::integer FROM erp_private.kra_cases k WHERE k.client_id=c.client_id AND k.status='Open' AND k.deadline_date-today<=v_lim),
  (SELECT min(k.deadline_date-today)::integer FROM erp_private.kra_cases k WHERE k.client_id=c.client_id AND k.status='Open' AND k.deadline_date-today<=v_lim),
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc)) ELSE 0 END,
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc) AND i.logged_at<now()-make_interval(days=>v_od)) ELSE 0 END,
  (SELECT count(*)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left BETWEEN 0 AND fs.warn_days),
  (SELECT min(fs.days_left)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left BETWEEN 0 AND fs.warn_days),
  (SELECT count(*)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left<0),
  (SELECT max(-fs.days_left)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left<0)
 FROM erp_private.clients c
 WHERE c.client_id=ANY(p_client_ids) AND c.deleted_at IS NULL AND erp_private.client_allowed(c.client_id);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) TO erp_api;

-- Nightly: one alert to every Partner for each open filing that is at least the late-alert days past its due date. Nothing is locked or changed.
CREATE FUNCTION erp_private.filing_late_scan() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;n integer:=0;
BEGIN
 FOR r IN SELECT f.task_id,f.task_name,f.filing_class,f.due_date,-f.days_left AS days_late,c.company_name
          FROM erp_private.filing_state() f JOIN erp_private.clients c ON c.client_id=f.client_id
          WHERE f.days_left<0 AND -f.days_left>=f.late_days LOOP
  n:=n+erp_private.alert_partners('filing-late:'||r.task_id,format('%s for %s was due on %s and is now %s days late. Nothing is blocked; please follow up.',r.task_name,r.company_name,r.due_date,r.days_late));
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.filing_late_scan() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('pcl-filing-late-scan','40 3 * * *','select erp_private.filing_late_scan();');
