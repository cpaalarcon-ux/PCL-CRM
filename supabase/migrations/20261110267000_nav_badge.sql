-- Navigation regroup follow-up (build 2026-11-10.2680): the menu count on Incoming review.
-- 1. A new setting: how many days a waiting file may sit before the menu count turns red. Default 3, not confirmed (a Partner confirms it).
-- 2. incoming_counts() now counts only what the signed-in person may see (it used to count every waiting file, including Restricted ones the person cannot open).
-- 3. incoming_badge(): the menu count. Waiting files the person may see, shown only to a person whose role may review the queue.
INSERT INTO erp_private.incoming_settings(setting_key,label,int_value,text_value) VALUES
 ('overdue_days','A waiting incoming file older than this many days turns the menu count red. The count never changes who can see what',3,NULL);

CREATE OR REPLACE FUNCTION erp_private.incoming_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_changed boolean;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF ROW(NEW.setting_key,NEW.label) IS DISTINCT FROM ROW(OLD.setting_key,OLD.label) THEN RAISE EXCEPTION 'A setting cannot be renamed' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change or confirm an incoming-file setting' USING ERRCODE='42501'; END IF;
 IF (NEW.int_value IS NULL)<>(OLD.int_value IS NULL) THEN RAISE EXCEPTION 'This setting holds %', CASE WHEN OLD.int_value IS NULL THEN 'text' ELSE 'a number' END USING ERRCODE='23514'; END IF;
 v_changed:=NEW.int_value IS DISTINCT FROM OLD.int_value OR NEW.text_value IS DISTINCT FROM OLD.text_value;
 IF v_changed THEN
  IF NEW.setting_key='accept_min_role' AND NEW.text_value NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Choose Supervisor, Manager or Partner' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='restricted_min_role' AND NEW.text_value NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Choose Manager or Partner' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='kyc_route' AND NEW.text_value NOT IN('LEADERS_ONLY','SAME_QUEUE') THEN RAISE EXCEPTION 'Choose LEADERS_ONLY or SAME_QUEUE' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='retention_days' AND (NEW.int_value<30 OR NEW.int_value>3650) THEN RAISE EXCEPTION 'Use a number of days from 30 to 3650' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='overdue_days' AND (NEW.int_value<1 OR NEW.int_value>60) THEN RAISE EXCEPTION 'Use a number of days from 1 to 60' USING ERRCODE='23514'; END IF;
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

CREATE OR REPLACE FUNCTION erp_private.incoming_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN erp_private.incoming_my_rank()<2 THEN '{}'::jsonb ELSE jsonb_build_object(
  'incoming_waiting',(SELECT count(*) FROM erp_private.incoming_items WHERE deleted_at IS NULL AND status IN('Received','Needs Review') AND erp_private.incoming_can_see(client_id,confidentiality,is_kyc)),
  'incoming_needs_review',(SELECT count(*) FROM erp_private.incoming_items WHERE deleted_at IS NULL AND status='Needs Review' AND erp_private.incoming_can_see(client_id,confidentiality,is_kyc)),
  'incoming_oldest_days',COALESCE((SELECT ((now() AT TIME ZONE 'Africa/Nairobi')::date-min((logged_at AT TIME ZONE 'Africa/Nairobi')::date)) FROM erp_private.incoming_items WHERE deleted_at IS NULL AND status IN('Received','Needs Review') AND erp_private.incoming_can_see(client_id,confidentiality,is_kyc)),0)) END
$$;

CREATE FUNCTION erp_private.incoming_badge() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN erp_private.incoming_my_rank()<1 OR erp_private.incoming_my_rank()<erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role'))
  THEN jsonb_build_object('waiting',0,'overdue',0)
  ELSE (SELECT jsonb_build_object('waiting',count(*),'overdue',count(*) FILTER (WHERE i.logged_at<now()-make_interval(days=>COALESCE(erp_private.incoming_int('overdue_days'),3))))
        FROM erp_private.incoming_items i
        WHERE i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc)) END
$$;
REVOKE EXECUTE ON FUNCTION erp_private.incoming_badge() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.incoming_badge() TO erp_api;
