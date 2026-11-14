-- One-to-one voice and video calls in the staff chat.
-- Audio and video travel directly between the two browsers (WebRTC); this schema only carries call set-up: who is calling whom, whether it is
-- ringing, answered, declined, missed or ended, and the two session descriptions the browsers need to connect. Nothing is recorded.
-- Calls exist only inside a one-to-one chat, so anyone who can open that chat can call and be called, whatever their role.
CREATE TABLE erp_private.chat_calls (
 call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 caller_id uuid NOT NULL REFERENCES erp_private.staff_members,
 callee_id uuid NOT NULL REFERENCES erp_private.staff_members,
 media text NOT NULL DEFAULT 'audio' CHECK(media IN('audio','video')),
 status text NOT NULL DEFAULT 'Ringing' CHECK(status IN('Ringing','Answered','Declined','Missed','Ended','Failed')),
 offer_sdp text NOT NULL CHECK(length(offer_sdp) BETWEEN 50 AND 20000),
 answer_sdp text CHECK(answer_sdp IS NULL OR length(answer_sdp) BETWEEN 50 AND 20000),
 created_at timestamptz NOT NULL DEFAULT now(),answered_at timestamptz,ended_at timestamptz,
 CHECK(caller_id<>callee_id)
);
CREATE INDEX chat_calls_channel_idx ON erp_private.chat_calls(channel_id,created_at DESC);
CREATE INDEX chat_calls_caller_idx ON erp_private.chat_calls(caller_id,created_at DESC);
CREATE INDEX chat_calls_callee_idx ON erp_private.chat_calls(callee_id,created_at DESC);
-- A person can be in at most one live call as caller and one as callee; the start function also refuses a call that crosses the two.
CREATE UNIQUE INDEX chat_calls_one_live_caller ON erp_private.chat_calls(caller_id) WHERE status IN('Ringing','Answered');
CREATE UNIQUE INDEX chat_calls_one_live_callee ON erp_private.chat_calls(callee_id) WHERE status IN('Ringing','Answered');
ALTER TABLE erp_private.chat_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_call_read ON erp_private.chat_calls FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IN(caller_id,callee_id));
REVOKE ALL ON erp_private.chat_calls FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON erp_private.chat_calls TO erp_api;

-- Tell the two people a call changed. The message carries no audio set-up data: only the call id and its status. The browser then asks
-- the server for the details, which re-checks that it is one of the two people.
CREATE OR REPLACE FUNCTION erp_private.chat_call_signal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
  PERFORM realtime.send(jsonb_build_object('call_id',NEW.call_id,'status',NEW.status,'media',NEW.media),'call','pcl-user:'||NEW.callee_id::text,true);
  IF TG_OP='UPDATE' THEN PERFORM realtime.send(jsonb_build_object('call_id',NEW.call_id,'status',NEW.status,'media',NEW.media),'call','pcl-user:'||NEW.caller_id::text,true);END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_signal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER chat_call_signal AFTER INSERT OR UPDATE ON erp_private.chat_calls FOR EACH ROW EXECUTE FUNCTION erp_private.chat_call_signal();

-- Each person may listen only to their own call topic.
CREATE OR REPLACE FUNCTION erp_private.pcl_user_realtime_allowed(topic_name text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
 IF auth.uid() IS NULL OR topic_name !~ '^pcl-user:[0-9a-f-]{36}$' THEN RETURN false;END IF;
 BEGIN sid:=substring(topic_name FROM 10)::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN false;END;
 RETURN sid IS NOT NULL AND sid=(erp_private.actor()).staff_id;
END;$$;
REVOKE ALL ON FUNCTION erp_private.pcl_user_realtime_allowed(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION erp_private.pcl_user_realtime_allowed(text) TO authenticated;
DO $$BEGIN
 IF to_regclass('realtime.messages') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY pcl_user_broadcast_read ON realtime.messages FOR SELECT TO authenticated USING(extension=''broadcast'' AND erp_private.pcl_user_realtime_allowed(realtime.topic()))';
 END IF;
END;$$;

-- A line in the chat for every call that ends: a missed call is unread for the person who missed it. The wording names people so it
-- reads the same whichever of the two wrote it (the chat's author rule means the person acting writes the line).
CREATE OR REPLACE FUNCTION erp_private.chat_call_log(p_call erp_private.chat_calls,p_body text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;mid uuid;
BEGIN
 IF me IS NULL OR me NOT IN(p_call.caller_id,p_call.callee_id) THEN RETURN;END IF;
 INSERT INTO erp_private.discussion_messages(channel_id,request_id,author_id,body) VALUES(p_call.channel_id,gen_random_uuid(),me,p_body) RETURNING message_id INTO mid;
 PERFORM erp_private.discussion_notify(mid);
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_log(erp_private.chat_calls,text) FROM PUBLIC,anon,authenticated,service_role;

-- Close one call and write its line. Safe to repeat: a call that already ended is returned unchanged.
CREATE OR REPLACE FUNCTION erp_private.chat_call_close(p_call uuid,p_status text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c erp_private.chat_calls;caller_name text;callee_name text;secs int;kind text;icon text;
BEGIN
 UPDATE erp_private.chat_calls SET status=p_status,ended_at=now() WHERE call_id=p_call AND status IN('Ringing','Answered') RETURNING * INTO c;
 IF NOT FOUND THEN RETURN (SELECT status FROM erp_private.chat_calls WHERE call_id=p_call);END IF;
 SELECT full_name INTO caller_name FROM erp_private.staff_members WHERE staff_id=c.caller_id;
 SELECT full_name INTO callee_name FROM erp_private.staff_members WHERE staff_id=c.callee_id;
 kind:=CASE c.media WHEN 'video' THEN 'video call' ELSE 'voice call' END;icon:=CASE c.media WHEN 'video' THEN '📹' ELSE '📞' END;
 secs:=GREATEST(0,floor(extract(epoch FROM (c.ended_at-coalesce(c.answered_at,c.ended_at)))))::int;
 PERFORM erp_private.chat_call_log(c,CASE p_status
  WHEN 'Missed' THEN icon||' Missed '||kind||' from '||coalesce(caller_name,'a colleague')
  WHEN 'Declined' THEN icon||' '||coalesce(callee_name,'A colleague')||' declined the '||kind
  WHEN 'Failed' THEN icon||' The '||kind||' could not connect'
  ELSE icon||' '||upper(left(kind,1))||substr(kind,2)||' · '||(secs/60)||':'||lpad((secs%60)::text,2,'0') END);
 RETURN p_status;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_close(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

-- Calls nobody finished: ringing for over a minute is missed; answered for over six hours is ended. Only calls the caller of this function
-- is part of get a chat line; anyone else's stale call is closed quietly so it cannot block them.
CREATE OR REPLACE FUNCTION erp_private.chat_call_expire(p_staff uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;me uuid:=(erp_private.actor()).staff_id;
BEGIN
 FOR r IN SELECT call_id,caller_id,callee_id,status FROM erp_private.chat_calls
  WHERE (caller_id=p_staff OR callee_id=p_staff) AND ((status='Ringing' AND created_at<now()-interval '60 seconds') OR (status='Answered' AND answered_at<now()-interval '6 hours'))
 LOOP
  IF me IN(r.caller_id,r.callee_id) THEN PERFORM erp_private.chat_call_close(r.call_id,CASE r.status WHEN 'Ringing' THEN 'Missed' ELSE 'Ended' END);
  ELSE UPDATE erp_private.chat_calls SET status=CASE r.status WHEN 'Ringing' THEN 'Missed' ELSE 'Ended' END,ended_at=now() WHERE call_id=r.call_id;END IF;
 END LOOP;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_expire(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION erp_private.chat_call_start(p_channel uuid,p_offer text,p_media text DEFAULT 'audio') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;c erp_private.discussion_channels;other uuid;nm text;id uuid;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again to start a call.' USING ERRCODE='42501';END IF;
 IF p_media NOT IN('audio','video') OR (p_media='video')<>(position('m=video' IN p_offer)>0) THEN RAISE EXCEPTION 'The call type does not match the call set-up data.';END IF;
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id=p_channel;
 IF NOT FOUND OR c.kind<>'Direct' OR NOT erp_private.discussion_allowed(p_channel) THEN RAISE EXCEPTION 'Voice calls are available in one-to-one chats only.';END IF;
 other:=CASE WHEN c.dm_low=me THEN c.dm_high ELSE c.dm_low END;
 SELECT full_name INTO nm FROM erp_private.staff_members s WHERE s.staff_id=other AND s.deleted_at IS NULL AND s.access_status='Active' AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date);
 IF nm IS NULL THEN RAISE EXCEPTION 'This colleague is not available for calls.';END IF;
 PERFORM erp_private.chat_call_expire(me);PERFORM erp_private.chat_call_expire(other);
 IF EXISTS(SELECT 1 FROM erp_private.chat_calls WHERE status IN('Ringing','Answered') AND (caller_id IN(me,other) OR callee_id IN(me,other))) THEN
  RAISE EXCEPTION 'You or % is already on a call. Try again when it ends.',nm;
 END IF;
 INSERT INTO erp_private.chat_calls(channel_id,caller_id,callee_id,media,offer_sdp) VALUES(p_channel,me,other,p_media,p_offer) RETURNING call_id INTO id;
 RETURN id;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_start(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.chat_call_start(uuid,text,text) TO erp_api;

CREATE OR REPLACE FUNCTION erp_private.chat_call_answer(p_call uuid,p_answer text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;
BEGIN
 PERFORM erp_private.chat_call_expire(me);
 UPDATE erp_private.chat_calls SET status='Answered',answer_sdp=p_answer,answered_at=now() WHERE call_id=p_call AND callee_id=me AND status='Ringing';
 IF NOT FOUND THEN RAISE EXCEPTION 'This call is no longer ringing.';END IF;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_answer(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.chat_call_answer(uuid,text) TO erp_api;

-- outcome: hangup (either person), decline (the person being called), failed (the browsers could not connect).
CREATE OR REPLACE FUNCTION erp_private.chat_call_finish(p_call uuid,p_outcome text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;c erp_private.chat_calls;target text;
BEGIN
 SELECT * INTO c FROM erp_private.chat_calls WHERE call_id=p_call;
 IF NOT FOUND OR me IS NULL OR me NOT IN(c.caller_id,c.callee_id) THEN RAISE EXCEPTION 'This call is not available to your account.' USING ERRCODE='42501';END IF;
 IF p_outcome NOT IN('hangup','decline','failed') THEN RAISE EXCEPTION 'Unknown call outcome.';END IF;
 IF c.status NOT IN('Ringing','Answered') THEN RETURN c.status;END IF;
 target:=CASE
  WHEN p_outcome='failed' THEN 'Failed'
  WHEN c.status='Answered' THEN 'Ended'
  WHEN p_outcome='decline' AND me=c.callee_id THEN 'Declined'
  WHEN me=c.callee_id THEN 'Declined'
  ELSE 'Missed' END;
 RETURN erp_private.chat_call_close(p_call,target);
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_finish(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.chat_call_finish(uuid,text) TO erp_api;

-- Calls for the screen: the one ringing for me, or one by id. Stale calls are closed first. SDPs go only to the person who needs them.
CREATE OR REPLACE FUNCTION erp_private.chat_call_view(p_call uuid DEFAULT NULL) RETURNS TABLE(call_id uuid,channel_id uuid,media text,status text,role text,other_name text,offer_sdp text,answer_sdp text,created_at timestamptz,answered_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;
BEGIN
 IF me IS NULL THEN RETURN;END IF;
 PERFORM erp_private.chat_call_expire(me);
 RETURN QUERY SELECT v.call_id,v.channel_id,v.media,v.status,CASE WHEN v.caller_id=me THEN 'caller' ELSE 'callee' END,
  (SELECT s.full_name FROM erp_private.staff_members s WHERE s.staff_id=CASE WHEN v.caller_id=me THEN v.callee_id ELSE v.caller_id END),
  CASE WHEN v.callee_id=me THEN v.offer_sdp END,CASE WHEN v.caller_id=me THEN v.answer_sdp END,v.created_at,v.answered_at
  FROM erp_private.chat_calls v
  WHERE me IN(v.caller_id,v.callee_id) AND CASE WHEN p_call IS NULL THEN v.callee_id=me AND v.status='Ringing' ELSE v.call_id=p_call END
  ORDER BY v.created_at DESC LIMIT 1;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_view(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.chat_call_view(uuid) TO erp_api;
