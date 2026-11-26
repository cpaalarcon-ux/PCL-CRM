-- Agora calls use the existing private call lifecycle without exchanging peer SDP.
-- Existing WebRTC calls keep their offers and answers.
ALTER TABLE erp_private.chat_calls ALTER COLUMN offer_sdp DROP NOT NULL;
ALTER TABLE erp_private.chat_calls ADD CONSTRAINT chat_calls_answer_transport
 CHECK (offer_sdp IS NOT NULL OR answer_sdp IS NULL);

CREATE OR REPLACE FUNCTION erp_private.chat_call_start(p_channel uuid,p_offer text,p_media text DEFAULT 'audio') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;c erp_private.discussion_channels;other uuid;nm text;id uuid;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again to start a call.' USING ERRCODE='42501';END IF;
 IF p_media IS NULL OR p_media NOT IN('audio','video') OR (p_offer IS NOT NULL AND (p_media='video')<>(position('m=video' IN p_offer)>0)) THEN RAISE EXCEPTION 'The call type does not match the call set-up data.';END IF;
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
 UPDATE erp_private.chat_calls SET status='Answered',answer_sdp=p_answer,answered_at=now() WHERE call_id=p_call AND callee_id=me AND status='Ringing'
  AND (offer_sdp IS NULL)=(p_answer IS NULL);
 IF NOT FOUND THEN RAISE EXCEPTION 'This call is no longer ringing.';END IF;
END;$$;
REVOKE ALL ON FUNCTION erp_private.chat_call_answer(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.chat_call_answer(uuid,text) TO erp_api;
