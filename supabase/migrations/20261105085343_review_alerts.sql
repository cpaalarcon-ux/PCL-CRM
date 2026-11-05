-- Review alerts. When someone submits an item for independent review, the Managers and Partners who can decide it are notified; when it is
-- decided, the preparer is told the result. The Home "Waiting for my review" list is the working list; these notifications are the nudge.
-- Recipients follow the same rule as the review list: Managers and Partners with access to the client, never the person acting; when the
-- preparer named a reviewer, that reviewer and every Partner.
CREATE OR REPLACE FUNCTION erp_private.notify_reviewers(p_client uuid,p_what text,p_key text,p_requested uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me_id uuid:=(erp_private.actor()).staff_id;me_name text;cname text;n integer;
BEGIN
 IF me_id IS NULL THEN RETURN 0;END IF;
 SELECT full_name INTO me_name FROM erp_private.staff_members WHERE staff_id=me_id;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=p_client;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 SELECT r.staff_id,'Review needed: '||left(p_what,200)||' for '||coalesce(cname,'a client')||', prepared by '||coalesce(me_name,'a colleague')||'. Open Home, Waiting for my review.',left(p_key,200)||':'||r.staff_id::text
 FROM erp_private.review_candidates(p_client) r
 WHERE p_requested IS NULL OR r.staff_id=p_requested OR r.category_code='PARTNER'
 ON CONFLICT (event_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END;$$;
REVOKE ALL ON FUNCTION erp_private.notify_reviewers(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.notify_reviewers(uuid,text,text,uuid) TO erp_api;

CREATE OR REPLACE FUNCTION erp_private.notify_outcome(p_to uuid,p_client uuid,p_what text,p_status text,p_note text,p_key text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me_id uuid:=(erp_private.actor()).staff_id;me_name text;cname text;
BEGIN
 IF me_id IS NULL OR p_to IS NULL OR p_to=me_id THEN RETURN;END IF;
 SELECT full_name INTO me_name FROM erp_private.staff_members WHERE staff_id=me_id;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=p_client;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 VALUES(p_to,'Your '||left(p_what,200)||' for '||coalesce(cname,'a client')||' was '||lower(p_status)||' by '||coalesce(me_name,'a reviewer')||CASE WHEN btrim(coalesce(p_note,''))<>'' THEN ': '||left(btrim(p_note),160) ELSE '.' END,left(p_key,200)||':'||p_to::text)
 ON CONFLICT (event_key) DO NOTHING;
END;$$;
REVOKE ALL ON FUNCTION erp_private.notify_outcome(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.notify_outcome(uuid,uuid,text,text,text,text) TO erp_api;
