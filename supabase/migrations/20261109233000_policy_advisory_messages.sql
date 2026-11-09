-- Final decision (9 Nov 2026): only ASSISTANT_DATA_ENTRY is a hard gate. Every other Partner policy is advisory: when its review date passes it
-- shows a red warning to the Partners and nothing is blocked. The daily scan now words its alerts to match.
-- A policy signed again after it expired (or after go-live + 14 days) gets a full review cycle (365 days) from the signing date (next_policy_review, unchanged).
CREATE OR REPLACE FUNCTION erp_private.policy_review_scan() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;n integer:=0;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;gate boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.system_settings WHERE key='GO_LIVE_DATE' AND value IS NOT NULL) THEN RETURN 0; END IF;
 FOR r IN SELECT policy_code,policy_name,review_due_date FROM erp_private.system_policies WHERE status='Signed_Off' AND review_due_date IS NOT NULL AND review_due_date<=today LOOP
  UPDATE erp_private.system_policies SET status='Expired' WHERE policy_code=r.policy_code;
  gate:=r.policy_code='ASSISTANT_DATA_ENTRY';
  PERFORM erp_private.alert_partners('policy-expired:'||r.policy_code||':'||r.review_due_date,
   CASE WHEN gate THEN format('%s has expired because its review was due on %s. Sign it again in Settings. Assistant data entry is blocked until then.',r.policy_name,r.review_due_date)
        ELSE format('%s has expired because its review was due on %s. It is advisory, so nothing is blocked. Review it and sign it again in Settings to clear the warning.',r.policy_name,r.review_due_date) END);
  n:=n+1;
 END LOOP;
 FOR r IN SELECT policy_code,policy_name,review_due_date FROM erp_private.system_policies WHERE status='Signed_Off' AND review_due_date IS NOT NULL AND review_due_date>today AND review_due_date<=today+3 LOOP
  PERFORM erp_private.alert_partners('policy-warning:'||r.policy_code||':'||r.review_due_date,format('%s is due for review on %s. Review it and sign it again before it expires.',r.policy_name,r.review_due_date));
  UPDATE erp_private.system_policies SET review_warned_at=now() WHERE policy_code=r.policy_code AND review_warned_at IS NULL;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
