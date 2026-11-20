-- Build 2795, part 1: excise duty rules join VAT and credit (withholding tax) rules as rules that only the designated Tax Lead (the APPROVE_TAX_RULES right) can
-- confirm and approve. A Partner without the right cannot. The person who prepared the rule still cannot confirm or approve it. Requested by the user in chat; the
-- Partner decision to keep this is still to be recorded by a Partner (open decisions register, item 8). Reversing it is one edit to the list below.
CREATE OR REPLACE FUNCTION erp_private.tax_rule_lead_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
 IF NEW.tax_type IN('VAT','Withholding tax','Excise duty') AND (
    (NEW.status='Approved' AND OLD.status IS DISTINCT FROM 'Approved')
    OR (NEW.legal_review_status='Confirmed' AND OLD.legal_review_status IS DISTINCT FROM 'Confirmed')) THEN
  IF NOT erp_private.tax_rules_approver() THEN
   IF NEW.tax_type='Excise duty' THEN
    RAISE EXCEPTION 'Excise duty rules can only be confirmed and approved by the designated Tax Manager who holds the APPROVE_TAX_RULES permission. Ask an Engagement Partner to assign the Tax Manager and switch the permission on.' USING ERRCODE='42501';
   END IF;
   RAISE EXCEPTION 'VAT and credit rules can only be confirmed and approved by the designated Tax Manager who holds the APPROVE_TAX_RULES permission. Ask an Engagement Partner to assign the Tax Manager and switch the permission on.' USING ERRCODE='42501';
  END IF;
  IF NEW.created_by IS NOT NULL AND NEW.created_by=(erp_private.actor()).staff_id THEN
   RAISE EXCEPTION 'The person who prepared this tax rule cannot confirm or approve it.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- Build 2795, part 2: the return task for an excise schedule. One live task per schedule; the task is an ordinary task in the client's engagement,
-- created through the same project gate and assignment rules as any other task. Links are never edited or deleted.
CREATE TABLE erp_private.excise_schedule_tasks(
 link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 schedule_id uuid NOT NULL REFERENCES erp_private.excise_schedules,
 task_id uuid NOT NULL REFERENCES erp_private.tasks,
 due_basis text NOT NULL CHECK(due_basis IN('CONFIRMED','TASK_DATE_FALLBACK')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX excise_schedule_tasks_schedule_uq ON erp_private.excise_schedule_tasks(schedule_id);
CREATE UNIQUE INDEX excise_schedule_tasks_task_uq ON erp_private.excise_schedule_tasks(task_id);
CREATE INDEX excise_schedule_tasks_created_by_idx ON erp_private.excise_schedule_tasks(created_by);
ALTER TABLE erp_private.excise_schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.excise_schedule_tasks FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.excise_schedule_tasks TO erp_api;
CREATE POLICY excise_task_link_read ON erp_private.excise_schedule_tasks FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.excise_schedules s WHERE s.schedule_id=excise_schedule_tasks.schedule_id));
CREATE POLICY excise_task_link_insert ON erp_private.excise_schedule_tasks FOR INSERT TO erp_api WITH CHECK(created_by=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND EXISTS(SELECT 1 FROM erp_private.excise_schedules s WHERE s.schedule_id=excise_schedule_tasks.schedule_id AND s.status<>'Withdrawn'));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.excise_schedule_tasks FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.excise_schedule_tasks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('link_id');
CREATE FUNCTION erp_private.excise_task_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A link between a schedule and its task cannot be changed.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER excise_task_link_guard BEFORE UPDATE ON erp_private.excise_schedule_tasks FOR EACH ROW EXECUTE FUNCTION erp_private.excise_task_link_guard();
