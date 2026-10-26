-- V4: a stable engagement owns accounting/evidence; monthly work projects are period
-- records beneath it. Existing task/document/journal IDs never move or duplicate.
UPDATE erp_private.services SET service_name='KRA Tax Compilation and Compliance' WHERE service_code='TAX-COMP';
ALTER TABLE erp_private.projects ADD COLUMN tax_master boolean NOT NULL DEFAULT false;
ALTER TABLE erp_private.tasks ADD COLUMN iso_week_year integer, ADD COLUMN iso_week_number integer CHECK(iso_week_number BETWEEN 1 AND 53);
CREATE TABLE erp_private.project_work_periods (
 work_period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 period_kind text NOT NULL CHECK(period_kind IN ('Monthly','Quarterly','Annually','Once-off','Weekly')),
 starts_on date NOT NULL,ends_on date NOT NULL,status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Archived')),
 archived_at timestamptz,archive_reason text,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,period_kind,starts_on),UNIQUE(work_period_id,project_id),CHECK(ends_on>=starts_on),
 CHECK((status='Archived')=(archived_at IS NOT NULL))
);
CREATE TABLE erp_private.work_period_tasks (
 task_id uuid PRIMARY KEY REFERENCES erp_private.tasks,work_period_id uuid NOT NULL REFERENCES erp_private.project_work_periods,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_period_project_idx ON erp_private.project_work_periods(project_id,status,starts_on);
CREATE INDEX work_period_tasks_period_idx ON erp_private.work_period_tasks(work_period_id);
ALTER TABLE erp_private.project_work_periods ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.project_work_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.work_period_tasks ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.work_period_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY work_period_read ON erp_private.project_work_periods FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (status='Open' OR erp_private.is_leader()));
CREATE POLICY work_period_add ON erp_private.project_work_periods FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id));
CREATE POLICY work_period_update ON erp_private.project_work_periods FOR UPDATE TO erp_api USING(erp_private.project_editor() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id));
CREATE POLICY work_period_task_read ON erp_private.work_period_tasks FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id) AND EXISTS(SELECT 1 FROM erp_private.project_work_periods p WHERE p.work_period_id=work_period_tasks.work_period_id));
CREATE POLICY work_period_task_add ON erp_private.work_period_tasks FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.task_allowed(task_id));
GRANT SELECT,INSERT,UPDATE ON erp_private.project_work_periods TO erp_api;GRANT SELECT,INSERT ON erp_private.work_period_tasks TO erp_api;
REVOKE ALL ON erp_private.project_work_periods,erp_private.work_period_tasks FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_no_delete BEFORE DELETE ON erp_private.project_work_periods FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER period_audit AFTER INSERT OR UPDATE ON erp_private.project_work_periods FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('work_period_id');
CREATE TRIGGER period_task_immutable BEFORE UPDATE OR DELETE ON erp_private.work_period_tasks FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE FUNCTION erp_private.work_period_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
 IF OLD.status='Archived' OR (NEW.project_id,NEW.period_kind,NEW.starts_on,NEW.ends_on) IS DISTINCT FROM (OLD.project_id,OLD.period_kind,OLD.starts_on,OLD.ends_on) THEN RAISE EXCEPTION 'Archived work and period identity are immutable';END IF;
 IF NEW.status='Archived' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text||':periods',0));
  IF NEW.ends_on >= (now() AT TIME ZONE 'Africa/Nairobi')::date OR NOT EXISTS(SELECT 1 FROM erp_private.work_period_tasks WHERE work_period_id=NEW.work_period_id)
  OR EXISTS(SELECT 1 FROM erp_private.work_period_tasks l JOIN erp_private.tasks t USING(task_id) LEFT JOIN erp_private.task_procedures w USING(task_id) WHERE l.work_period_id=NEW.work_period_id AND (t.status NOT IN('Completed','Cancelled') OR (t.status<>'Cancelled' AND w.stage IS DISTINCT FROM 'Closed')))
  THEN RAISE EXCEPTION 'Finish the reporting period and close every required task, review and payment follow-up before archiving';END IF;
 END IF;END IF;RETURN NEW;
END;$$;
CREATE TRIGGER work_period_guard BEFORE UPDATE ON erp_private.project_work_periods FOR EACH ROW EXECUTE FUNCTION erp_private.work_period_guard();

-- Calendar weeks retain their ISO week-year. A week crossing a month has two
-- non-overlapping coverage segments in the two monthly projects.
CREATE OR REPLACE FUNCTION erp_private.schedule_occurrences(freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH bounds AS (SELECT greatest(starts,effective) first_day,ends last_day), months AS (
 SELECT d::date m,(d+interval '1 month -1 day')::date me FROM bounds,generate_series(date_trunc('month',first_day::timestamp),last_day::timestamp,interval '1 month') d
 ), week_segments AS (
 SELECT greatest(w::date,m,starts,effective) ps,least((w+interval '6 days')::date,me,ends) pe,w::date monday
 FROM months CROSS JOIN LATERAL generate_series(date_trunc('week',m::timestamp),me::timestamp,interval '7 days') w
 WHERE freq IN('Weekly','Monthly','Weekly + Monthly','Weekly + Monthly + Annually') AND least((w+interval '6 days')::date,me,ends)>=greatest(w::date,m,starts,effective)
 ), wt(k,n,doc,rev) AS (VALUES
 ('weekly-sales','Upload weekly sales',true,false),('weekly-purchases','Upload weekly purchases',true,false),('weekly-bank','Upload bank transactions',true,false),
 ('weekly-mapping','Map purchases and reconcile bank',false,false),('weekly-review','Review weekly tax compilation',false,true),('weekly-report','Prepare weekly client report',false,false)),
 mt(k,n,day_due,obligation,rev) AS (VALUES
 ('monthly-compile','Compile monthly tax schedules',15,'',false),('monthly-review','Review monthly tax compilation',15,'',true),('monthly-report','Prepare monthly client report',15,'',false),
 ('monthly-paye','File PAYE return',6,'PAYE',false),('monthly-vat','File VAT return',15,'VAT',false),('monthly-tot','File TOT return',15,'TOT',false),('monthly-payroll','Prepare payroll',6,'Payroll',false)),
 tax_occ AS (
 SELECT wt.k,wt.n||' · '||to_char(monday,'IYYY-"W"IW') ps_name,ps,pe,ps::timestamp+interval '3 hours' rel,pe::timestamp+interval '23 hours 59 minutes' due,wt.doc,wt.rev
 FROM week_segments CROSS JOIN wt WHERE pack_name='Tax Compilation'
 UNION ALL
 SELECT mt.k,mt.n,m,me,greatest(m,starts,effective,CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE m END)::timestamp+interval '3 hours',
 (m+interval '1 month'+(mt.day_due-1)*interval '1 day')::date::timestamp+interval '23 hours 59 minutes',false,mt.rev
 FROM months CROSS JOIN mt WHERE pack_name='Tax Compilation' AND freq IN('Monthly','Weekly + Monthly','Weekly + Monthly + Annually') AND (mt.obligation='' OR mt.obligation=ANY(obligations))
 AND CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE greatest(m,starts,effective) END<=least(me,ends)
 UNION ALL
 SELECT a.k,a.n,d::date,(d+interval '1 year -1 day')::date,greatest((d+a.offset_month*interval '1 month')::date,starts,effective)::timestamp+interval '3 hours',(d+interval '1 year -1 day')::timestamp+interval '23 hours 59 minutes',false,a.rev
 FROM bounds,generate_series(date_trunc('year',first_day::timestamp),last_day::timestamp,interval '1 year') d CROSS JOIN (VALUES('annual-compile','Prepare annual tax schedules',0,false),('annual-review','Review annual tax compilation',10,true),('annual-report','Prepare annual client report',11,false)) a(k,n,offset_month,rev) WHERE pack_name='Tax Compilation' AND freq IN('Annually','Weekly + Monthly + Annually') AND (d+a.offset_month*interval '1 month')::date<=ends
 ), ordinary AS (
 SELECT CASE freq WHEN 'Weekly' THEN date_trunc('week',d)::date WHEN 'Monthly' THEN date_trunc('month',d)::date WHEN 'Quarterly' THEN date_trunc('quarter',d)::date WHEN 'Annually' THEN date_trunc('year',d)::date ELSE starts END ps,
 CASE freq WHEN 'Weekly' THEN (date_trunc('week',d)+interval '6 days')::date WHEN 'Monthly' THEN (date_trunc('month',d)+interval '1 month -1 day')::date WHEN 'Quarterly' THEN (date_trunc('quarter',d)+interval '3 months -1 day')::date WHEN 'Annually' THEN (date_trunc('year',d)+interval '1 year -1 day')::date ELSE ends END pe
 FROM bounds,generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d WHERE pack_name='General' OR freq IN('Once-off','Quarterly')
 ), all_occ AS (
 SELECT * FROM tax_occ UNION ALL
 SELECT DISTINCT 'general-'||lower(freq),'Complete '||lower(freq)||' project work',greatest(ps,starts,effective),least(pe,ends),greatest(ps,starts,effective)::timestamp+interval '3 hours',least(pe,ends)::timestamp+interval '23 hours 59 minutes',false,false FROM ordinary
 ) SELECT k,ps_name,ps,pe,rel AT TIME ZONE 'Africa/Nairobi',due AT TIME ZONE 'Africa/Nairobi',doc,rev FROM all_occ
 WHERE ps<=ends AND pe>=greatest(starts,effective) AND rel AT TIME ZONE 'Africa/Nairobi'<=through_at ORDER BY rel,k
$$;
CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record;o record;wp uuid;n integer;total integer:=0;is_tax boolean;kind text;ps date;pe date;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(pid::text||':periods',0));
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM erp_private.projects WHERE project_id=pid AND deleted_at IS NULL AND status<>'Archived') THEN RETURN 0;END IF;
 SELECT tax_master INTO is_tax FROM erp_private.projects WHERE project_id=pid;
 FOR s IN SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL ORDER BY version LOOP
 FOR o IN SELECT * FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at) LOOP
 wp:=null;
 IF is_tax THEN
  kind:=CASE WHEN o.template_key LIKE 'annual-%' THEN 'Annually' WHEN s.frequency IN('Once-off','Quarterly') THEN s.frequency ELSE 'Monthly' END;
  ps:=CASE WHEN kind='Monthly' THEN date_trunc('month',o.period_start::timestamp)::date ELSE o.period_start END;
  pe:=CASE WHEN kind='Monthly' THEN (ps+interval '1 month -1 day')::date ELSE o.period_end END;
  INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on) VALUES(pid,kind,ps,pe) ON CONFLICT(project_id,period_kind,starts_on) DO NOTHING;
  SELECT work_period_id INTO wp FROM erp_private.project_work_periods WHERE project_id=pid AND period_kind=kind AND starts_on=ps AND status='Open';
  IF wp IS NULL THEN CONTINUE;END IF;
 END IF;
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version,iso_week_year,iso_week_number)
 VALUES(pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
 'Generated from the approved service schedule. Internal target; statutory deadline and client approval remain separate controls.',o.due_at,o.template_key||':'||o.period_start::text,o.requires_document,o.period_start,o.period_end,o.template_key,s.version,
 CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(isoyear FROM o.period_start)::int END,CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(week FROM o.period_start)::int END)
 ON CONFLICT(project_id,recurring_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;total:=total+n;
 IF wp IS NOT NULL THEN INSERT INTO erp_private.work_period_tasks(task_id,work_period_id) SELECT task_id,wp FROM erp_private.tasks WHERE project_id=pid AND recurring_key=o.template_key||':'||o.period_start::text ON CONFLICT(task_id) DO NOTHING;END IF;
 END LOOP;END LOOP;RETURN total;
END;$$;
CREATE FUNCTION erp_private.archive_closed_periods(pid uuid DEFAULT null) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 IF current_user='erp_api' AND NOT erp_private.project_editor() THEN RAISE EXCEPTION 'Reviewer required' USING ERRCODE='42501';END IF;
 UPDATE erp_private.project_work_periods p SET status='Archived',archived_at=now(),archive_reason='All required tasks, independent reviews and applicable payment follow-ups closed.'
 WHERE (pid IS NULL OR p.project_id=pid) AND p.status='Open' AND p.ends_on<(now() AT TIME ZONE 'Africa/Nairobi')::date
 AND EXISTS(SELECT 1 FROM erp_private.work_period_tasks l WHERE l.work_period_id=p.work_period_id)
 AND NOT EXISTS(SELECT 1 FROM erp_private.work_period_tasks l JOIN erp_private.tasks t USING(task_id) LEFT JOIN erp_private.task_procedures w USING(task_id) WHERE l.work_period_id=p.work_period_id AND (t.status NOT IN('Completed','Cancelled') OR (t.status<>'Cancelled' AND w.stage IS DISTINCT FROM 'Closed')));
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END;$$;
-- Existing IDs and source relationships are retained. No invented approvals, no moved journals.
UPDATE erp_private.projects p SET tax_master=true FROM erp_private.project_schedules s WHERE p.project_id=s.project_id AND p.service_code='TAX-COMP' AND s.pack='Tax Compilation' AND NOT p.tax_master;
INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on)
 SELECT DISTINCT p.project_id,CASE WHEN t.template_key LIKE 'annual-%' THEN 'Annually' ELSE 'Monthly' END,
 CASE WHEN t.template_key LIKE 'annual-%' THEN date_trunc('year',t.period_start::timestamp)::date ELSE date_trunc('month',t.period_start::timestamp)::date END,
 CASE WHEN t.template_key LIKE 'annual-%' THEN (date_trunc('year',t.period_start::timestamp)+interval '1 year -1 day')::date ELSE (date_trunc('month',t.period_start::timestamp)+interval '1 month -1 day')::date END
 FROM erp_private.projects p JOIN erp_private.tasks t USING(project_id) WHERE p.tax_master AND t.period_start IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO erp_private.work_period_tasks(task_id,work_period_id)
 SELECT t.task_id,w.work_period_id FROM erp_private.tasks t JOIN erp_private.project_work_periods w ON w.project_id=t.project_id AND w.period_kind=CASE WHEN t.template_key LIKE 'annual-%' THEN 'Annually' ELSE 'Monthly' END AND t.period_start BETWEEN w.starts_on AND w.ends_on ON CONFLICT DO NOTHING;
CREATE FUNCTION erp_private.period_archive_tick() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN PERFORM erp_private.archive_closed_periods();END;$$;
REVOKE ALL ON FUNCTION erp_private.work_period_guard(),erp_private.archive_closed_periods(uuid),erp_private.period_archive_tick() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.work_period_guard(),erp_private.archive_closed_periods(uuid) TO erp_api;
SELECT cron.schedule('pcl-work-period-archive','*/5 * * * *','select erp_private.period_archive_tick();');

-- Internal chatter: messages are immutable, membership and source scope are
-- checked on every API call. Realtime carries an invalidation only, never text.
CREATE TABLE erp_private.discussion_channels (
 channel_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN('Project','Task','Direct')),
 project_id uuid REFERENCES erp_private.projects,task_id uuid REFERENCES erp_private.tasks,
 dm_low uuid REFERENCES erp_private.staff_members,dm_high uuid REFERENCES erp_private.staff_members,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='Project' AND project_id IS NOT NULL AND task_id IS NULL AND dm_low IS NULL AND dm_high IS NULL) OR (kind='Task' AND project_id IS NOT NULL AND task_id IS NOT NULL AND dm_low IS NULL AND dm_high IS NULL) OR (kind='Direct' AND project_id IS NULL AND task_id IS NULL AND dm_low IS NOT NULL AND dm_high IS NOT NULL AND dm_low<dm_high))
);
CREATE UNIQUE INDEX discussion_project_once ON erp_private.discussion_channels(project_id) WHERE kind='Project';
CREATE UNIQUE INDEX discussion_task_once ON erp_private.discussion_channels(task_id) WHERE kind='Task';
CREATE UNIQUE INDEX discussion_dm_once ON erp_private.discussion_channels(dm_low,dm_high) WHERE kind='Direct';
CREATE TABLE erp_private.discussion_messages (
 message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,request_id uuid NOT NULL,author_id uuid NOT NULL REFERENCES erp_private.staff_members,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),reply_to uuid REFERENCES erp_private.discussion_messages,
 document_id uuid REFERENCES erp_private.documents,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(author_id,request_id)
);
CREATE INDEX discussion_messages_channel_idx ON erp_private.discussion_messages(channel_id,sequence DESC);
CREATE INDEX discussion_reply_idx ON erp_private.discussion_messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX discussion_document_idx ON erp_private.discussion_messages(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX discussion_author_idx ON erp_private.discussion_messages(author_id);
CREATE TABLE erp_private.discussion_reads (
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 last_sequence bigint NOT NULL DEFAULT 0,read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(channel_id,staff_id)
);
CREATE INDEX discussion_reads_staff_idx ON erp_private.discussion_reads(staff_id);
CREATE FUNCTION erp_private.discussion_allowed(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND EXISTS(SELECT 1 FROM erp_private.discussion_channels c WHERE c.channel_id=cid AND
 CASE c.kind WHEN 'Direct' THEN (erp_private.actor()).staff_id IN(c.dm_low,c.dm_high)
 WHEN 'Task' THEN erp_private.task_allowed(c.task_id) AND EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=c.task_id AND t.project_id=c.project_id)
 ELSE erp_private.project_allowed(c.project_id) END)
$$;
CREATE FUNCTION erp_private.discussion_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c erp_private.discussion_channels;
BEGIN
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id=NEW.channel_id;
 IF NOT erp_private.discussion_allowed(NEW.channel_id) OR NEW.author_id IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'Internal conversation unavailable' USING ERRCODE='42501';END IF;
 IF NEW.reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.discussion_messages WHERE message_id=NEW.reply_to AND channel_id=NEW.channel_id) THEN RAISE EXCEPTION 'Reply must stay in this conversation';END IF;
 IF c.project_id IS NOT NULL AND (EXISTS(SELECT 1 FROM erp_private.projects WHERE project_id=c.project_id AND status='Archived') OR c.task_id IS NOT NULL AND (EXISTS(SELECT 1 FROM erp_private.task_procedures WHERE task_id=c.task_id AND stage='Closed') OR EXISTS(SELECT 1 FROM erp_private.tasks WHERE task_id=c.task_id AND status IN('Completed','Cancelled')))) THEN RAISE EXCEPTION 'Closed work is read only; open a linked correction task';END IF;
 IF NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=NEW.document_id AND d.deleted_at IS NULL AND c.project_id IS NOT NULL AND d.project_id=c.project_id) THEN RAISE EXCEPTION 'Attachment must be an authorised private document in this project';END IF;
 RETURN NEW;
END;$$;
DO $$DECLARE x text;BEGIN
 FOREACH x IN ARRAY ARRAY['discussion_channels','discussion_messages','discussion_reads'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',x);EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',x);
 EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated,service_role',x);
 END LOOP;
END;$$;
CREATE POLICY discussion_channel_read ON erp_private.discussion_channels FOR SELECT TO erp_api USING(erp_private.discussion_allowed(channel_id));
CREATE POLICY discussion_channel_add ON erp_private.discussion_channels FOR INSERT TO erp_api WITH CHECK(created_by=(erp_private.actor()).staff_id AND CASE kind WHEN 'Project' THEN erp_private.project_allowed(project_id) WHEN 'Task' THEN erp_private.task_allowed(task_id) ELSE (erp_private.actor()).staff_id IN(dm_low,dm_high) END);
CREATE POLICY discussion_message_read ON erp_private.discussion_messages FOR SELECT TO erp_api USING(erp_private.discussion_allowed(channel_id));
CREATE POLICY discussion_message_add ON erp_private.discussion_messages FOR INSERT TO erp_api WITH CHECK(author_id=(erp_private.actor()).staff_id AND erp_private.discussion_allowed(channel_id));
CREATE POLICY discussion_cursor_read ON erp_private.discussion_reads FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id AND erp_private.discussion_allowed(channel_id));
CREATE POLICY discussion_cursor_write ON erp_private.discussion_reads FOR ALL TO erp_api USING(staff_id=(erp_private.actor()).staff_id AND erp_private.discussion_allowed(channel_id)) WITH CHECK(staff_id=(erp_private.actor()).staff_id AND erp_private.discussion_allowed(channel_id));
GRANT SELECT,INSERT ON erp_private.discussion_channels,erp_private.discussion_messages TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.discussion_reads TO erp_api;GRANT USAGE ON SEQUENCE erp_private.discussion_messages_sequence_seq TO erp_api;
CREATE TRIGGER discussion_guard BEFORE INSERT ON erp_private.discussion_messages FOR EACH ROW EXECUTE FUNCTION erp_private.discussion_guard();
CREATE TRIGGER discussion_immutable BEFORE UPDATE OR DELETE ON erp_private.discussion_messages FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER discussion_identity_immutable BEFORE UPDATE OR DELETE ON erp_private.discussion_channels FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER discussion_audit AFTER INSERT ON erp_private.discussion_messages FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('message_id');
REVOKE ALL ON FUNCTION erp_private.discussion_allowed(uuid),erp_private.discussion_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.discussion_allowed(uuid),erp_private.discussion_guard() TO erp_api;

-- Only a scoped Manager/Partner may navigate archived task history. Keeping
-- the master engagement accessible preserves authorised annual ledger reports.
CREATE OR REPLACE FUNCTION erp_private.task_allowed(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.tasks x JOIN erp_private.projects p ON p.project_id=x.project_id JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE x.task_id=t AND x.deleted_at IS NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL AND erp_private.firm_allowed(p.handling_firm_id)
 AND (erp_private.is_leader() OR NOT EXISTS(SELECT 1 FROM erp_private.work_period_tasks l JOIN erp_private.project_work_periods w USING(work_period_id) WHERE l.task_id=x.task_id AND w.status='Archived'))
 AND ((x.assigned_to=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=x.project_id AND a.staff_id=x.assigned_to AND a.deleted_at IS NULL)) OR ((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND erp_private.project_allowed(x.project_id))))
$$;
-- Private realtime authorisation wrapper: has no table-returning API and sends
-- only a sequence invalidation. Every message/download still rechecks scope.
CREATE FUNCTION public.pcl_discussion_realtime_allowed(topic_name text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE cid uuid;
BEGIN
 IF auth.uid() IS NULL OR topic_name !~ '^pcl-discussion:[0-9a-f-]{36}$' THEN RETURN false;END IF;
 BEGIN cid:=substring(topic_name FROM 16)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN false;END;
 RETURN erp_private.discussion_allowed(cid);
END;$$;
REVOKE ALL ON FUNCTION public.pcl_discussion_realtime_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pcl_discussion_realtime_allowed(text) TO authenticated;
CREATE FUNCTION erp_private.discussion_signal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
 PERFORM realtime.send(jsonb_build_object('sequence',NEW.sequence),'changed','pcl-discussion:'||NEW.channel_id::text,true);
 END IF;RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.discussion_signal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER discussion_signal AFTER INSERT ON erp_private.discussion_messages FOR EACH ROW EXECUTE FUNCTION erp_private.discussion_signal();
DO $$BEGIN
 IF to_regclass('realtime.messages') IS NOT NULL THEN
 EXECUTE 'CREATE POLICY pcl_discussion_broadcast_read ON realtime.messages FOR SELECT TO authenticated USING(extension=''broadcast'' AND public.pcl_discussion_realtime_allowed(realtime.topic()))';
 END IF;
END;$$;

ALTER TABLE erp_private.workbook_batches DROP CONSTRAINT IF EXISTS workbook_batches_header_row_check;
ALTER TABLE erp_private.workbook_batches ADD CONSTRAINT workbook_batches_header_row_check CHECK(header_row>=0);
-- Firm policies/specifications are private firm references, never dummy client files.
CREATE TABLE erp_private.reference_documents (
 reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,version_label text NOT NULL,
 file_name text NOT NULL,object_key text NOT NULL UNIQUE,sha256 text NOT NULL UNIQUE,mime_type text NOT NULL,file_size_bytes bigint NOT NULL CHECK(file_size_bytes>0),
 status text NOT NULL DEFAULT 'Awaiting review' CHECK(status IN('Awaiting review','Approved','Superseded','Withdrawn')),
 supersedes_id uuid REFERENCES erp_private.reference_documents,uploaded_by uuid NOT NULL REFERENCES erp_private.staff_members,uploaded_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES erp_private.staff_members,approved_at timestamptz,approval_note text,
 CHECK((approved_by IS NULL)=(approved_at IS NULL))
);
CREATE INDEX reference_uploader_idx ON erp_private.reference_documents(uploaded_by);
CREATE INDEX reference_approver_idx ON erp_private.reference_documents(approved_by);
CREATE INDEX reference_prior_idx ON erp_private.reference_documents(supersedes_id);
CREATE TABLE erp_private.reference_access_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reference_id uuid NOT NULL REFERENCES erp_private.reference_documents,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,action text NOT NULL CHECK(action IN('UPLOAD','DOWNLOAD','APPROVE')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reference_access_document_idx ON erp_private.reference_access_events(reference_id,created_at);
CREATE INDEX reference_access_actor_idx ON erp_private.reference_access_events(actor_id);
ALTER TABLE erp_private.reference_documents ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.reference_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.reference_access_events ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.reference_access_events FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_read ON erp_private.reference_documents FOR SELECT TO erp_api USING(erp_private.is_leader());
CREATE POLICY reference_write ON erp_private.reference_documents FOR ALL TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());
CREATE POLICY reference_access_read ON erp_private.reference_access_events FOR SELECT TO erp_api USING(erp_private.is_leader());
CREATE POLICY reference_access_add ON erp_private.reference_access_events FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND actor_id=(erp_private.actor()).staff_id);
REVOKE ALL ON erp_private.reference_documents,erp_private.reference_access_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.reference_documents TO erp_api;GRANT SELECT,INSERT ON erp_private.reference_access_events TO erp_api;
CREATE FUNCTION erp_private.reference_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reference history cannot be deleted';END IF;
 IF TG_OP='UPDATE' AND (NEW.reference_id,NEW.title,NEW.version_label,NEW.file_name,NEW.object_key,NEW.sha256,NEW.mime_type,NEW.file_size_bytes,NEW.supersedes_id,NEW.uploaded_by,NEW.uploaded_at) IS DISTINCT FROM (OLD.reference_id,OLD.title,OLD.version_label,OLD.file_name,OLD.object_key,OLD.sha256,OLD.mime_type,OLD.file_size_bytes,OLD.supersedes_id,OLD.uploaded_by,OLD.uploaded_at) THEN RAISE EXCEPTION 'Upload a new reference version; the original is immutable';END IF;
 IF NEW.status='Approved' AND (NEW.approved_by IS DISTINCT FROM (erp_private.actor()).staff_id OR NEW.approved_at IS NULL OR length(btrim(NEW.approval_note))<3) THEN RAISE EXCEPTION 'Record an authenticated approval and note';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER reference_guard BEFORE UPDATE OR DELETE ON erp_private.reference_documents FOR EACH ROW EXECUTE FUNCTION erp_private.reference_guard();
CREATE TRIGGER reference_access_immutable BEFORE UPDATE OR DELETE ON erp_private.reference_access_events FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER reference_change AFTER INSERT OR UPDATE ON erp_private.reference_documents FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('reference_id');
REVOKE ALL ON FUNCTION erp_private.reference_guard() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.reference_guard() TO erp_api;
CREATE FUNCTION erp_private.discussion_candidates() RETURNS TABLE(staff_id uuid,full_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT s.staff_id,s.full_name FROM erp_private.staff_members s JOIN erp_private.staff_firm_access fa ON fa.staff_id=s.staff_id
 WHERE (erp_private.actor()).staff_id IS NOT NULL AND fa.deleted_at IS NULL AND erp_private.firm_allowed(fa.firm_id) AND s.deleted_at IS NULL AND s.access_status='Active'
 AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
$$;
REVOKE ALL ON FUNCTION erp_private.discussion_candidates() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.discussion_candidates() TO erp_api;
CREATE FUNCTION erp_private.discussion_notify(mid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m erp_private.discussion_messages;c erp_private.discussion_channels;r record;
BEGIN
 SELECT * INTO m FROM erp_private.discussion_messages WHERE message_id=mid;
 IF NOT FOUND OR m.author_id IS DISTINCT FROM (erp_private.actor()).staff_id OR NOT erp_private.discussion_allowed(m.channel_id) THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id=m.channel_id;
 FOR r IN SELECT s.staff_id FROM erp_private.staff_members s WHERE s.staff_id<>m.author_id AND s.deleted_at IS NULL AND s.access_status='Active'
 AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND CASE WHEN c.kind='Direct' THEN s.staff_id IN(c.dm_low,c.dm_high)
 WHEN c.kind='Task' THEN s.staff_id IN(SELECT assigned_to FROM erp_private.tasks WHERE task_id=c.task_id UNION SELECT reviewer_id FROM erp_private.task_procedures WHERE task_id=c.task_id)
 ELSE EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=c.project_id AND a.staff_id=s.staff_id AND a.deleted_at IS NULL) END
 LOOP
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(r.staff_id,c.task_id,'New message in an internal discussion. Open Comms → Internal chat.','discussion:'||m.message_id::text||':'||r.staff_id::text) ON CONFLICT DO NOTHING;
 END LOOP;
END;$$;
REVOKE ALL ON FUNCTION erp_private.discussion_notify(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.discussion_notify(uuid) TO erp_api;
CREATE FUNCTION erp_private.task_is_archived(tid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.work_period_tasks l JOIN erp_private.project_work_periods w USING(work_period_id) WHERE l.task_id=tid AND w.status='Archived')
$$;
REVOKE ALL ON FUNCTION erp_private.task_is_archived(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.task_is_archived(uuid) TO erp_api;
ALTER POLICY tasks_read ON erp_private.tasks USING(deleted_at IS NULL AND erp_private.task_scope(project_id,assigned_to) AND (erp_private.is_leader() OR NOT erp_private.task_is_archived(task_id)));
ALTER POLICY tasks_update ON erp_private.tasks USING(deleted_at IS NULL AND erp_private.task_scope(project_id,assigned_to) AND NOT erp_private.task_is_archived(task_id)) WITH CHECK(deleted_at IS NULL AND erp_private.task_scope(project_id,assigned_to) AND NOT erp_private.task_is_archived(task_id));
CREATE OR REPLACE FUNCTION erp_private.period_archive_tick() RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p record;BEGIN
 FOR p IN SELECT project_id FROM erp_private.projects WHERE tax_master AND deleted_at IS NULL AND status<>'Archived' LOOP
 PERFORM erp_private.generate_project_tasks(p.project_id);PERFORM erp_private.archive_closed_periods(p.project_id);
 END LOOP;
END;$$;
CREATE FUNCTION erp_private.period_task_change_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.work_period_tasks WHERE task_id=OLD.task_id) AND NEW.status='Cancelled' AND OLD.status<>'Cancelled' THEN
 IF current_user='erp_api' AND NOT erp_private.project_editor() THEN RAISE EXCEPTION 'A reviewer must authorise cancellation' USING ERRCODE='42501';END IF;
 IF length(btrim(coalesce(NEW.blocked_reason,'')))<10 THEN RAISE EXCEPTION 'Record a cancellation or not-applicable reason';END IF;
 END IF;RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.period_task_change_guard() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.period_task_change_guard() TO erp_api;
CREATE TRIGGER period_task_change_guard BEFORE UPDATE ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.period_task_change_guard();
CREATE TABLE erp_private.workbook_import_requests (
 project_id uuid NOT NULL REFERENCES erp_private.projects,signature text NOT NULL,batch_id uuid NOT NULL REFERENCES erp_private.workbook_batches,document_id uuid NOT NULL REFERENCES erp_private.documents,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,signature)
);
CREATE INDEX workbook_request_batch_idx ON erp_private.workbook_import_requests(batch_id);
CREATE INDEX workbook_request_document_idx ON erp_private.workbook_import_requests(document_id);
ALTER TABLE erp_private.workbook_import_requests ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.workbook_import_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workbook_request_read ON erp_private.workbook_import_requests FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY workbook_request_add ON erp_private.workbook_import_requests FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
REVOKE ALL ON erp_private.workbook_import_requests FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT ON erp_private.workbook_import_requests TO erp_api;
CREATE TRIGGER workbook_request_immutable BEFORE UPDATE OR DELETE ON erp_private.workbook_import_requests FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
