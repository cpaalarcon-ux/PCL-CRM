-- Build 2816: who approves a master service template.
-- Owner decision (15 Nov): the Managing Partner, or a Manager who holds the right, approves a draft template when they did not propose it.
-- A Partner may approve a template they proposed only when they are the only active Partner in their firm, and that is recorded on the template.
-- Retiring a template stays with a Partner. The database repeats these rules.
ALTER TABLE erp_private.service_templates ADD COLUMN sole_partner_approval boolean NOT NULL DEFAULT false;
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.service_templates'::regclass AND contype='c' AND pg_get_constraintdef(oid) ~ 'approved_by <> proposed_by' LOOP
  EXECUTE format('ALTER TABLE erp_private.service_templates DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE erp_private.service_templates ADD CONSTRAINT service_templates_approver_check CHECK(approved_by IS NULL OR proposed_by IS NULL OR approved_by<>proposed_by OR sole_partner_approval);
-- Staff rows are visible only to the person and seniors, so "is this the only Partner" is answered by a function that reads them for the caller.
CREATE FUNCTION erp_private.sole_active_partner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (erp_private.actor()).category_code='PARTNER'
  AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=(erp_private.actor()).staff_id AND f.deleted_at IS NULL)
  AND NOT EXISTS(
   SELECT 1 FROM erp_private.staff_firm_access mine
   JOIN erp_private.staff_firm_access other ON other.firm_id=mine.firm_id AND other.deleted_at IS NULL AND other.staff_id<>mine.staff_id
   JOIN erp_private.staff_members m ON m.staff_id=other.staff_id AND m.category_code='PARTNER' AND m.access_status='Active' AND m.deleted_at IS NULL
   WHERE mine.staff_id=(erp_private.actor()).staff_id AND mine.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION erp_private.sole_active_partner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.sole_active_partner() TO erp_api;
DROP POLICY st_update ON erp_private.service_templates;
CREATE POLICY st_update ON erp_private.service_templates FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE OR REPLACE FUNCTION erp_private.service_templates_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' AND current_user='erp_api' THEN RAISE EXCEPTION 'Propose a draft; a Partner or an authorised Manager approves it separately.' USING ERRCODE='42501'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  IF NEW.template_code IS NOT NULL AND NEW.version>1 AND NOT EXISTS(SELECT 1 FROM erp_private.service_templates o WHERE o.template_code=NEW.template_code AND o.version=NEW.version-1) THEN
   RAISE EXCEPTION 'A new version follows the previous one.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.template_code,NEW.version,NEW.name,NEW.service_group,NEW.description,NEW.source,NEW.proposed_by,NEW.proposed_at) IS DISTINCT FROM ROW(OLD.template_code,OLD.version,OLD.name,OLD.service_group,OLD.description,OLD.source,OLD.proposed_by,OLD.proposed_at) THEN
  RAISE EXCEPTION 'A service template is never edited. Propose a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Retired' THEN RAISE EXCEPTION 'A retired service template stays as it was.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Approved' THEN
  IF current_user='erp_api' THEN
   IF cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Partner or an authorised Manager approves a service template.' USING ERRCODE='42501'; END IF;
   IF NEW.approved_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Approval is recorded under your own name.' USING ERRCODE='42501'; END IF;
   IF OLD.proposed_by IS NOT NULL AND OLD.proposed_by=me THEN
    IF cat<>'PARTNER' OR NOT erp_private.sole_active_partner() OR NOT NEW.sole_partner_approval THEN
     RAISE EXCEPTION 'A different Partner or Manager approves a template you proposed, unless you are your firm''s only Partner.' USING ERRCODE='42501';
    END IF;
   ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves a template they proposed.' USING ERRCODE='23514';
   END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.service_template_tasks t WHERE t.template_id=NEW.template_id) OR NOT EXISTS(SELECT 1 FROM erp_private.service_template_services s WHERE s.template_id=NEW.template_id) THEN
   RAISE EXCEPTION 'A template needs at least one task and one service before it is approved.' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.status='Retired' AND OLD.status IN('Draft','Approved') THEN
  -- A Partner retires a template with a reason. When an approval replaces the approved version, whoever approves records that retirement.
  IF current_user='erp_api' AND (NEW.retired_by IS DISTINCT FROM me OR NOT (cat='PARTNER' OR (cat='MANAGER' AND OLD.status='Approved' AND NEW.retired_reason LIKE 'Replaced by version %'))) THEN
   RAISE EXCEPTION 'A Partner retires a service template, with a reason.' USING ERRCODE='42501';
  END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.sole_partner_approval IS DISTINCT FROM OLD.sole_partner_approval THEN
  RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
