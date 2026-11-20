-- Purchase credit notes with no original invoice. They stay outside mapping, posting and totals (no suspense liability is created).
-- 1. A permanent log of each request sent to the client for the missing original invoice number and date.
-- 2. A daily scan: when a credit note has waited more than 30 days from its own date, the engagement gets one open task and the
--    preparer, project owner and the preparer's manager are notified. The task is never changed by the scan; staff complete it.
CREATE TABLE erp_private.credit_note_requests(
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 requested_at timestamptz NOT NULL DEFAULT now(),
 credit_count integer NOT NULL CHECK(credit_count>0),
 net_amount numeric(18,2) NOT NULL,vat_amount numeric(18,2) NOT NULL,gross_amount numeric(18,2) NOT NULL,
 oldest_credit_date date,
 items jsonb NOT NULL,
 message text NOT NULL CHECK(length(btrim(message)) BETWEEN 20 AND 4000)
);
CREATE INDEX credit_note_requests_project_idx ON erp_private.credit_note_requests(project_id,requested_at DESC);
CREATE INDEX credit_note_requests_staff_idx ON erp_private.credit_note_requests(requested_by);
ALTER TABLE erp_private.credit_note_requests ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.credit_note_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_request_read ON erp_private.credit_note_requests FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY credit_request_add ON erp_private.credit_note_requests FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND requested_by=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code<>'INTERN');
REVOKE ALL ON erp_private.credit_note_requests FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT ON erp_private.credit_note_requests TO erp_api;
CREATE TRIGGER credit_note_requests_immutable BEFORE UPDATE OR DELETE ON erp_private.credit_note_requests FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

-- Outstanding pending credits per project with their own date. The rule matches purchase-pending.ts: a credit stops being pending
-- when a later upload supplies both the original invoice and its date for the same row.
CREATE FUNCTION erp_private.outstanding_pending_credits() RETURNS TABLE(project_id uuid,credit_date date,gross numeric)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 WITH outstanding AS (
  SELECT DISTINCT ON (b.project_id,r.raw_values->'_pending_purchase'->>'key',r.raw_values->'_pending_purchase'->'match')
   b.project_id,r.raw_values->'_pending_purchase'->'row' AS n,b.period_start
  FROM erp_private.workbook_rejections r JOIN erp_private.workbook_batches b USING(batch_id) JOIN erp_private.documents d USING(document_id)
  WHERE b.archived_at IS NULL AND d.archived_at IS NULL AND r.raw_values ? '_pending_purchase'
   AND NOT EXISTS(SELECT 1 FROM erp_private.workbook_rows w JOIN erp_private.workbook_batches wb USING(batch_id)
    WHERE wb.archived_at IS NULL AND w.project_id=b.project_id AND w.dataset='Purchases' AND w.parent_row_id IS NULL
     AND w.row_key=r.raw_values->'_pending_purchase'->>'key' AND w.normalized @> (r.raw_values->'_pending_purchase'->'match')
     AND coalesce(w.normalized->>'original_invoice','')<>'' AND coalesce(w.normalized->>'original_invoice_date','')<>'')
  ORDER BY b.project_id,r.raw_values->'_pending_purchase'->>'key',r.raw_values->'_pending_purchase'->'match',b.created_at DESC)
 SELECT o.project_id,
  CASE WHEN o.n->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (o.n->>'date')::date ELSE o.period_start END,
  CASE WHEN o.n->>'gross' ~ '^-?\d+(\.\d+)?$' THEN (o.n->>'gross')::numeric ELSE 0 END
 FROM outstanding o;
$$;
REVOKE ALL ON FUNCTION erp_private.outstanding_pending_credits() FROM PUBLIC,anon,authenticated,service_role,erp_api;

CREATE FUNCTION erp_private.run_orphan_credit_alerts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;owner uuid;mgr uuid;n integer:=0;ym text:=to_char((now() AT TIME ZONE 'Africa/Nairobi')::date,'YYYY-MM');msg text;
BEGIN
 FOR r IN SELECT c.project_id,count(*)::int credits,count(*) FILTER(WHERE c.credit_date<(now() AT TIME ZONE 'Africa/Nairobi')::date-30)::int overdue,
   min(c.credit_date) FILTER(WHERE c.credit_date<(now() AT TIME ZONE 'Africa/Nairobi')::date-30) oldest,
   coalesce(sum(c.gross) FILTER(WHERE c.credit_date<(now() AT TIME ZONE 'Africa/Nairobi')::date-30),0) gross,
   p.project_name,p.owner_staff_id
  FROM erp_private.outstanding_pending_credits() c JOIN erp_private.projects p ON p.project_id=c.project_id
  WHERE p.status='Active' AND p.deleted_at IS NULL
  GROUP BY c.project_id,p.project_name,p.owner_staff_id HAVING count(*) FILTER(WHERE c.credit_date<(now() AT TIME ZONE 'Africa/Nairobi')::date-30)>0
 LOOP
  owner:=coalesce((SELECT s.assigned_to FROM erp_private.project_schedules s JOIN erp_private.project_assignments x ON x.project_id=s.project_id AND x.staff_id=s.assigned_to WHERE s.project_id=r.project_id AND s.deleted_at IS NULL AND s.assigned_to IS NOT NULL LIMIT 1),
   (SELECT x.staff_id FROM erp_private.project_assignments x WHERE x.project_id=r.project_id AND x.staff_id=r.owner_staff_id));
  msg:=r.overdue||' purchase credit note(s) have waited more than 30 days for the original invoice number and date (oldest '||to_char(r.oldest,'DD Mon YYYY')||', gross KES '||to_char(r.gross,'FM999,999,999,990.00')||') on '||r.project_name||'. They are excluded from mapping, posting and VAT totals. Open Purchase ledgers, Credit notes pending, and send the request to the client.';
  IF owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.project_id=r.project_id AND t.recurring_key LIKE 'orphan-credit:%' AND t.deleted_at IS NULL AND t.status NOT IN ('Completed','Cancelled')) THEN
   INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,status,recurring_key)
   VALUES(r.project_id,owner,'Chase original invoices for credit notes older than 30 days',msg||' Complete this task when none remain pending.','Pending','orphan-credit:'||ym) ON CONFLICT(project_id,recurring_key) DO NOTHING;
   IF FOUND THEN n:=n+1;END IF;
  END IF;
  SELECT s.manager_id INTO mgr FROM erp_private.staff_members s WHERE s.staff_id=owner;
  INSERT INTO erp_private.notifications(recipient_id,message,event_key)
  SELECT DISTINCT x.sid,left(msg,900),'orphan-credit:'||r.project_id||':'||ym||':'||x.sid FROM (VALUES(owner),(r.owner_staff_id),(mgr)) AS x(sid) WHERE x.sid IS NOT NULL
  ON CONFLICT(event_key) DO NOTHING;
 END LOOP;
 RETURN n;
END;$$;
REVOKE ALL ON FUNCTION erp_private.run_orphan_credit_alerts() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('orphan-credit-alerts','10 3 * * *','select erp_private.run_orphan_credit_alerts()');
