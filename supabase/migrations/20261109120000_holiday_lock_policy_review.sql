-- Build .107 (staging): holiday compliance lock, go-live date setting, and dated policy reviews.

-- 1. Holiday source note. The column is named source_note.
ALTER TABLE erp_private.public_holidays RENAME COLUMN source TO source_note;
ALTER TABLE erp_private.public_holidays RENAME CONSTRAINT public_holidays_source_check TO public_holidays_source_note_check;
CREATE OR REPLACE FUNCTION erp_private.holiday_save(p_date date,p_name text,p_is_working_day boolean,p_source text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change the holiday calendar' USING ERRCODE='42501'; END IF;
 IF p_date IS NULL OR p_date<'2020-01-01' OR p_date>'2100-12-31' THEN RAISE EXCEPTION 'Choose a valid date' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_name,'')))<3 THEN RAISE EXCEPTION 'Enter the holiday name' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_source,'')))<10 THEN RAISE EXCEPTION 'Record the source note (at least 10 characters), for example Gazette Notice No. 1234.' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.public_holidays(holiday_date,name,is_working_day,source_note,confirmed,confirmed_by,confirmed_at)
  VALUES(p_date,btrim(p_name),coalesce(p_is_working_day,false),btrim(p_source),true,a.staff_id,now())
  ON CONFLICT (holiday_date) DO UPDATE SET name=EXCLUDED.name,is_working_day=EXCLUDED.is_working_day,source_note=EXCLUDED.source_note,confirmed=true,confirmed_by=EXCLUDED.confirmed_by,confirmed_at=now();
END $$;

-- 2. Compliance lock. While any holiday in the current month (Nairobi) is unconfirmed, the stuck-task scan and the payroll jobs pause
--    and every Partner is told once a month. Payroll jobs, when built, must call erp_private.holiday_lock_active() first.
CREATE FUNCTION erp_private.holiday_lock_active() RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.public_holidays h
  WHERE NOT h.confirmed AND date_trunc('month',h.holiday_date::timestamp)=date_trunc('month',(now() AT TIME ZONE 'Africa/Nairobi')))
$$;
REVOKE ALL ON FUNCTION erp_private.holiday_lock_active() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.holiday_lock_active() TO erp_api;

CREATE FUNCTION erp_private.alert_partners(p_key text,p_message text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;n integer:=0;k integer;
BEGIN
 FOR r IN SELECT staff_id FROM erp_private.staff_members WHERE category_code='PARTNER' AND access_status='Active' LOOP
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.staff_id,p_message,p_key||':'||r.staff_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT;n:=n+k;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.alert_partners(text,text) FROM PUBLIC,anon,authenticated,service_role,erp_api;

CREATE OR REPLACE FUNCTION erp_private.stuck_task_scan() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;lvl smallint;n integer:=0;sent integer;rec uuid;tail text;
BEGIN
 IF erp_private.holiday_lock_active() THEN
  PERFORM erp_private.alert_partners('holiday-lock:'||to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY-MM'),
   'Stuck-task alerts are paused: a public holiday this month is not confirmed. Open Settings > Public holidays and confirm it with its Gazette source.');
  RETURN 0;
 END IF;
 FOR r IN SELECT t.task_id,t.task_name,t.project_id,t.assigned_to,s.full_name,c.company_name,
   t.work_seconds+round(erp_private.working_seconds(t.work_started_at,now()))::integer secs
  FROM erp_private.tasks t JOIN erp_private.staff_members s ON s.staff_id=t.assigned_to JOIN erp_private.projects p ON p.project_id=t.project_id JOIN erp_private.clients c ON c.client_id=p.client_id
  WHERE t.status='In Progress' AND t.work_started_at IS NOT NULL AND t.deleted_at IS NULL
 LOOP
  FOR lvl IN SELECT x FROM unnest(ARRAY[4,8]::smallint[]) x WHERE r.secs>=x*3600 AND NOT EXISTS(SELECT 1 FROM erp_private.task_stuck_alerts a WHERE a.task_id=r.task_id AND a.level=x) ORDER BY x LOOP
   sent:=0;tail:=CASE WHEN lvl=4 THEN 'Please check in.' ELSE 'This is now a Manager-level alert; please review.' END;
   FOR rec IN SELECT DISTINCT q FROM erp_private.stuck_recipients(r.assigned_to,r.project_id,lvl) q LOOP
    INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
     VALUES(rec,r.task_id,format('%s has worked %s working hours on "%s" for %s. %s',r.full_name,lvl,r.task_name,r.company_name,tail),format('stuck:%s:%s:%s',r.task_id,lvl,rec)) ON CONFLICT DO NOTHING;
    sent:=sent+1;
   END LOOP;
   INSERT INTO erp_private.task_stuck_alerts(task_id,level,recipients) VALUES(r.task_id,lvl,sent) ON CONFLICT DO NOTHING;
   n:=n+1;
  END LOOP;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.stuck_task_scan() FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- 3. System settings. GO_LIVE_DATE stays empty during staging and UAT, so policy review timers do not run.
CREATE TABLE erp_private.system_settings(
 key text PRIMARY KEY CHECK(key ~ '^[A-Z_]{3,60}$'),
 value text,
 note text,
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(key<>'GO_LIVE_DATE' OR value IS NULL OR value ~ '^\d{4}-\d{2}-\d{2}$'),
 CHECK(key<>'POLICY_REVIEW_CYCLE_DAYS' OR (value ~ '^\d{1,4}$' AND value::integer>=1))
);
CREATE INDEX system_settings_updated_by_idx ON erp_private.system_settings(updated_by);
INSERT INTO erp_private.system_settings(key,value) VALUES('GO_LIVE_DATE',NULL),('POLICY_REVIEW_CYCLE_DAYS','365');
ALTER TABLE erp_private.system_settings ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.system_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.system_settings TO erp_api;
CREATE POLICY system_settings_read ON erp_private.system_settings FOR SELECT TO erp_api USING(true);
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.system_settings FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.system_settings FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('key');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.system_settings FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

-- 4. Policy review dates.
ALTER TABLE erp_private.system_policies ADD COLUMN review_due_date date,ADD COLUMN review_warned_at timestamptz;
DO $$DECLARE c text;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.system_policies'::regclass AND contype='c' LOOP
  EXECUTE format('ALTER TABLE erp_private.system_policies DROP CONSTRAINT %I',c);
 END LOOP;
END$$;
ALTER TABLE erp_private.system_policies
 ADD CONSTRAINT system_policies_policy_code_check CHECK(policy_code ~ '^[A-Z_]{3,60}$'),
 ADD CONSTRAINT system_policies_status_check CHECK(status IN('Pending','Signed_Off','Expired')),
 ADD CONSTRAINT system_policies_signature_check CHECK((status IN('Signed_Off','Expired') AND signed_by IS NOT NULL AND signed_at IS NOT NULL) OR (status='Pending' AND signed_by IS NULL AND signed_at IS NULL)),
 ADD CONSTRAINT system_policies_review_check CHECK(status='Signed_Off' OR review_due_date IS NULL OR status='Expired');

-- First review is GO_LIVE_DATE + 14 days. If that date has already passed when a policy is (re)signed, the next review is one cycle away (POLICY_REVIEW_CYCLE_DAYS, 365 unless changed).
CREATE FUNCTION erp_private.next_policy_review(p_from date) RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN g.v IS NULL THEN NULL
  WHEN g.v::date+14>p_from THEN g.v::date+14
  ELSE p_from+coalesce((SELECT value::integer FROM erp_private.system_settings WHERE key='POLICY_REVIEW_CYCLE_DAYS'),365) END
 FROM (SELECT value v FROM erp_private.system_settings WHERE key='GO_LIVE_DATE') g
$$;
REVOKE ALL ON FUNCTION erp_private.next_policy_review(date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.next_policy_review(date) TO erp_api;

CREATE OR REPLACE FUNCTION erp_private.system_policies_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE me erp_private.staff_members;
BEGIN
 IF NEW.policy_code IS DISTINCT FROM OLD.policy_code OR NEW.policy_name IS DISTINCT FROM OLD.policy_name OR NEW.statement IS DISTINCT FROM OLD.statement THEN
  RAISE EXCEPTION 'A policy statement cannot be edited.';
 END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 me:=erp_private.actor();
 IF NEW.status='Expired' THEN
  IF OLD.status<>'Signed_Off' THEN RAISE EXCEPTION 'Only a signed policy can expire.'; END IF;
  NEW.signed_by:=OLD.signed_by;NEW.signed_at:=OLD.signed_at;RETURN NEW;
 END IF;
 IF me.category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can sign off or withdraw a policy.'; END IF;
 IF NEW.status='Signed_Off' THEN NEW.signed_by:=me.staff_id;NEW.signed_at:=now();NEW.review_due_date:=erp_private.next_policy_review((now() AT TIME ZONE 'Africa/Nairobi')::date);NEW.review_warned_at:=NULL;
 ELSE NEW.signed_by:=NULL;NEW.signed_at:=NULL;NEW.review_due_date:=NULL;NEW.review_warned_at:=NULL; END IF;
 RETURN NEW;
END $$;

-- Partner sets or clears the go-live date. Signed policies get their review date worked out again from the new date.
CREATE FUNCTION erp_private.go_live_save(p_date date,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can set the go-live date' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why (at least 10 characters).' USING ERRCODE='23514'; END IF;
 IF p_date IS NOT NULL AND (p_date<'2026-01-01' OR p_date>'2100-12-31') THEN RAISE EXCEPTION 'Choose a valid date' USING ERRCODE='22023'; END IF;
 UPDATE erp_private.system_settings SET value=to_char(p_date,'YYYY-MM-DD'),note=btrim(p_note),updated_by=a.staff_id,updated_at=now() WHERE key='GO_LIVE_DATE';
 UPDATE erp_private.system_policies SET review_due_date=erp_private.next_policy_review((now() AT TIME ZONE 'Africa/Nairobi')::date),review_warned_at=NULL WHERE status='Signed_Off';
END $$;
REVOKE ALL ON FUNCTION erp_private.go_live_save(date,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.go_live_save(date,text) TO erp_api;

-- Daily check. Nothing happens until GO_LIVE_DATE is set. Three days before the review date every Partner is warned; on the date the policy expires
-- and its gate closes (for Assistant data entry that means proposals are blocked) until a Partner signs it again.
CREATE FUNCTION erp_private.policy_review_scan() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;n integer:=0;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.system_settings WHERE key='GO_LIVE_DATE' AND value IS NOT NULL) THEN RETURN 0; END IF;
 FOR r IN SELECT policy_code,policy_name,review_due_date FROM erp_private.system_policies WHERE status='Signed_Off' AND review_due_date IS NOT NULL AND review_due_date<=today LOOP
  UPDATE erp_private.system_policies SET status='Expired' WHERE policy_code=r.policy_code;
  PERFORM erp_private.alert_partners('policy-expired:'||r.policy_code||':'||r.review_due_date,format('%s has expired because its review was due on %s. Sign it again in Settings. Actions that depend on it are blocked until then.',r.policy_name,r.review_due_date));
  n:=n+1;
 END LOOP;
 FOR r IN SELECT policy_code,policy_name,review_due_date FROM erp_private.system_policies WHERE status='Signed_Off' AND review_due_date IS NOT NULL AND review_due_date>today AND review_due_date<=today+3 LOOP
  PERFORM erp_private.alert_partners('policy-warning:'||r.policy_code||':'||r.review_due_date,format('%s is due for review on %s. Review it and sign it again before it expires.',r.policy_name,r.review_due_date));
  UPDATE erp_private.system_policies SET review_warned_at=now() WHERE policy_code=r.policy_code AND review_warned_at IS NULL;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.policy_review_scan() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('pcl-policy-review-scan','10 3 * * *','select erp_private.policy_review_scan();');
