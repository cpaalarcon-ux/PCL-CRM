-- Tax Manager role gate and annual due-date rules (build 2026-11-10.2770), from the Partner's written answers of 10 Nov 2026 20:16.
-- 1. Until a named individual is formally assigned, the Tax Manager is a ROLE ASSIGNED TO AN ENGAGEMENT: a Partner assigns one active Manager as the Tax Manager of a
--    client engagement (project). The APPROVE_TAX_RULES permission belongs to the TAX_MANAGER role and is switched on by a Partner (it starts OFF). A tax rule can then be
--    approved only by a person who is the assigned Tax Manager on at least one engagement while the permission is on. The earlier individual right (a Partner granting
--    APPROVE_TAX_RULES to a named Manager) still works and counts the same way. VAT and credit rules still need this person; a Partner alone cannot approve them.
-- 2. Annual KRA due dates are suggested from rules held in a table (due_month_offset and external_deadline_day, plus the internal date), never hard-coded. The values are
--    the Partner's; they show "Suggested" until a Partner confirms them. The Tax Team still confirms each annual period's date by hand in the due-date gate.

-- 1. Engagement Tax Manager and the role permission --------------------------------------------------------------------------------------
CREATE TABLE erp_private.engagement_tax_managers(
 assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 assigned_by uuid NOT NULL REFERENCES erp_private.staff_members,
 assigned_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(char_length(btrim(reason))>=10),
 ended_at timestamptz, ended_by uuid REFERENCES erp_private.staff_members, end_reason text,
 revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND char_length(btrim(coalesce(end_reason,'')))>=10))
);
CREATE UNIQUE INDEX engagement_tax_manager_one_live ON erp_private.engagement_tax_managers(project_id) WHERE ended_at IS NULL;
CREATE INDEX engagement_tax_manager_staff_idx ON erp_private.engagement_tax_managers(staff_id) WHERE ended_at IS NULL;
CREATE INDEX engagement_tax_manager_assigned_by_idx ON erp_private.engagement_tax_managers(assigned_by);
CREATE INDEX engagement_tax_manager_ended_by_idx ON erp_private.engagement_tax_managers(ended_by) WHERE ended_by IS NOT NULL;

CREATE TABLE erp_private.tax_role_permissions(
 permission_key text NOT NULL CHECK(permission_key IN('APPROVE_TAX_RULES')),
 role_code text NOT NULL CHECK(role_code IN('TAX_MANAGER')),
 allowed boolean NOT NULL DEFAULT false,
 source_note text NOT NULL CHECK(char_length(btrim(source_note))>=10),
 changed_by uuid REFERENCES erp_private.staff_members,
 changed_at timestamptz,
 revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(permission_key,role_code)
);
CREATE INDEX tax_role_permissions_changed_by_idx ON erp_private.tax_role_permissions(changed_by) WHERE changed_by IS NOT NULL;
INSERT INTO erp_private.tax_role_permissions(permission_key,role_code,allowed,source_note) VALUES('APPROVE_TAX_RULES','TAX_MANAGER',false,'Not enabled. A Partner switches this on after assigning the Tax Manager.');

CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.engagement_tax_managers FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.tax_role_permissions FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.engagement_tax_managers FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.tax_role_permissions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.engagement_tax_managers FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('assignment_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.tax_role_permissions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('permission_key');
ALTER TABLE erp_private.engagement_tax_managers ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.engagement_tax_managers FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.tax_role_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.tax_role_permissions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.engagement_tax_managers,erp_private.tax_role_permissions TO erp_api;
CREATE POLICY engagement_tax_managers_read ON erp_private.engagement_tax_managers FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND erp_private.project_allowed(project_id));
CREATE POLICY tax_role_permissions_read ON erp_private.tax_role_permissions FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER'));

CREATE FUNCTION erp_private.tax_manager_assign(p_project uuid,p_staff uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;t erp_private.staff_members;rid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner assigns the Tax Manager.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'That engagement is unavailable to your account.' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM erp_private.staff_members WHERE staff_id=p_staff AND deleted_at IS NULL;
 IF t.staff_id IS NULL OR t.access_status<>'Active' THEN RAISE EXCEPTION 'Choose an active staff member.' USING ERRCODE='23514'; END IF;
 IF t.category_code<>'MANAGER' THEN RAISE EXCEPTION 'The Tax Manager is a Manager. A Supervisor, Assistant or Intern cannot hold this role.' USING ERRCODE='23514'; END IF;
 IF char_length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why this Manager is the Tax Manager for the engagement (at least 10 characters).' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.engagement_tax_managers WHERE project_id=p_project AND ended_at IS NULL) THEN RAISE EXCEPTION 'This engagement already has a Tax Manager. End that assignment first.' USING ERRCODE='23505'; END IF;
 INSERT INTO erp_private.engagement_tax_managers(project_id,staff_id,assigned_by,reason) VALUES(p_project,p_staff,a.staff_id,btrim(p_reason)) RETURNING assignment_id INTO rid;
 RETURN rid;
END $$;
CREATE FUNCTION erp_private.tax_manager_end(p_assignment uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;g erp_private.engagement_tax_managers;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner ends a Tax Manager assignment.' USING ERRCODE='42501'; END IF;
 SELECT * INTO g FROM erp_private.engagement_tax_managers WHERE assignment_id=p_assignment AND ended_at IS NULL FOR UPDATE;
 IF g.assignment_id IS NULL THEN RAISE EXCEPTION 'That assignment is not current.' USING ERRCODE='23514'; END IF;
 IF NOT erp_private.project_allowed(g.project_id) THEN RAISE EXCEPTION 'That engagement is unavailable to your account.' USING ERRCODE='42501'; END IF;
 IF char_length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why the assignment ends (at least 10 characters).' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.engagement_tax_managers SET ended_at=now(),ended_by=a.staff_id,end_reason=btrim(p_reason) WHERE assignment_id=p_assignment;
END $$;
CREATE FUNCTION erp_private.tax_role_permission_set(p_allowed boolean,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner changes what the Tax Manager role may do.' USING ERRCODE='42501'; END IF;
 IF p_allowed IS NULL THEN RAISE EXCEPTION 'Choose on or off.' USING ERRCODE='23514'; END IF;
 IF char_length(btrim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Say who decided this and where it is written (at least 10 characters).' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.tax_role_permissions SET allowed=p_allowed,source_note=btrim(p_note),changed_by=a.staff_id,changed_at=now() WHERE permission_key='APPROVE_TAX_RULES' AND role_code='TAX_MANAGER';
END $$;

-- The gate. True for (a) a person holding the individual APPROVE_TAX_RULES right, or (b) the assigned Tax Manager of a current engagement while the Partner has switched the
-- TAX_MANAGER role's permission on. A Partner is never in this group by being a Partner, and a non-Manager can never be.
CREATE OR REPLACE FUNCTION erp_private.tax_rules_approver() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND (
  EXISTS(SELECT 1 FROM erp_private.staff_capabilities x
         WHERE x.staff_id=(erp_private.actor()).staff_id AND x.capability='APPROVE_TAX_RULES' AND x.deleted_at IS NULL
          AND (x.expires_on IS NULL OR x.expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date))
  OR ((erp_private.actor()).category_code='MANAGER'
      AND EXISTS(SELECT 1 FROM erp_private.tax_role_permissions rp WHERE rp.permission_key='APPROVE_TAX_RULES' AND rp.role_code='TAX_MANAGER' AND rp.allowed)
      AND EXISTS(SELECT 1 FROM erp_private.engagement_tax_managers e JOIN erp_private.projects p ON p.project_id=e.project_id
                 WHERE e.staff_id=(erp_private.actor()).staff_id AND e.ended_at IS NULL AND p.deleted_at IS NULL)))
$$;
-- Clearer wording for the refusal.
DO $patch$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('erp_private.tax_rule_lead_guard()'::regprocedure);
 IF position('the designated Tax Lead (the APPROVE_TAX_RULES right). Ask an Engagement Partner to grant it to the Tax Manager.' IN d)=0 THEN RAISE EXCEPTION 'tax_rule_lead_guard changed'; END IF;
 EXECUTE replace(d,'the designated Tax Lead (the APPROVE_TAX_RULES right). Ask an Engagement Partner to grant it to the Tax Manager.','the designated Tax Manager who holds the APPROVE_TAX_RULES permission. Ask an Engagement Partner to assign the Tax Manager and switch the permission on.');
END $patch$;

-- 2. Annual due-date rules ---------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.annual_due_rules(
 rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tax_kind text NOT NULL CHECK(tax_kind IN('Individual','Company','Partnership')),
 due_month_offset integer NOT NULL CHECK(due_month_offset BETWEEN 1 AND 12),
 external_deadline_day integer NOT NULL CHECK(external_deadline_day BETWEEN 1 AND 31),
 internal_month_offset integer NOT NULL CHECK(internal_month_offset BETWEEN 0 AND 12),
 internal_deadline_day integer NOT NULL CHECK(internal_deadline_day BETWEEN 1 AND 31),
 applies_from_period_end date,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed')),
 source_note text NOT NULL CHECK(char_length(btrim(source_note))>=10),
 confirmed_by uuid REFERENCES erp_private.staff_members, confirmed_at timestamptz,
 revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(rule_status<>'Confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX annual_due_rules_one ON erp_private.annual_due_rules(tax_kind,coalesce(applies_from_period_end,'0001-01-01'::date));
CREATE INDEX annual_due_rules_confirmed_by_idx ON erp_private.annual_due_rules(confirmed_by) WHERE confirmed_by IS NOT NULL;
-- Values are the Partner's written answer of 10 Nov 2026 20:16. The Individual rule starts with the 2026 year of income (period end 31 Dec 2026) because the four-month rule is
-- reported to apply from the 2026 year of income; earlier individual periods get no suggested date. This still needs the Tax Lead to check it against the Finance Act 2026.
INSERT INTO erp_private.annual_due_rules(tax_kind,due_month_offset,external_deadline_day,internal_month_offset,internal_deadline_day,applies_from_period_end,source_note) VALUES
 ('Individual',4,30,3,31,'2026-12-31','Partner answer of 10 Nov 2026 20:16: due 30 April after a 31 December year end, internal 31 March. Starts with the 2026 year of income; not yet checked against the Finance Act 2026.'),
 ('Company',6,30,5,31,NULL,'Partner answer of 10 Nov 2026 20:16: due six months after the financial year end (30 June for 31 December), internal 31 May. Not yet checked by the Tax Lead.'),
 ('Partnership',6,30,5,31,NULL,'Partner answer of 10 Nov 2026 20:16: same as companies, six months after the financial year end, internal 31 May. Not yet checked by the Tax Lead.');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.annual_due_rules FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.annual_due_rules FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.annual_due_rules FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('rule_id');
ALTER TABLE erp_private.annual_due_rules ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.annual_due_rules FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.annual_due_rules TO erp_api;
CREATE POLICY annual_due_rules_read ON erp_private.annual_due_rules FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER'));

-- The month and day: add the months to the period end, then take the stated day, or the last day of that month if it is shorter.
CREATE FUNCTION erp_private.rule_date(p_ends date,p_months integer,p_day integer) RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT make_date(extract(year FROM m)::int,extract(month FROM m)::int,least(p_day,extract(day FROM (m+interval '1 month'-interval '1 day'))::int))
 FROM (SELECT (date_trunc('month',p_ends)+make_interval(months=>p_months))::date AS m) x
$$;
CREATE FUNCTION erp_private.annual_due_rule_row(p_kind text,p_ends date) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT r.rule_id FROM erp_private.annual_due_rules r WHERE r.tax_kind=p_kind AND (r.applies_from_period_end IS NULL OR p_ends>=r.applies_from_period_end)
 ORDER BY r.applies_from_period_end DESC NULLS LAST LIMIT 1
$$;
-- The suggested KRA date for any tax kind: monthly kinds as before, annual kinds from the rules table.
CREATE FUNCTION erp_private.period_due_suggest_kind(p_kind text,p_ends date) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN erp_private.period_due_class(p_kind)='ANNUAL'
  THEN (SELECT erp_private.rule_date(p_ends,r.due_month_offset,r.external_deadline_day) FROM erp_private.annual_due_rules r WHERE r.rule_id=erp_private.annual_due_rule_row(p_kind,p_ends))
  ELSE erp_private.period_due_suggest(erp_private.period_due_class(p_kind),p_ends) END
$$;
CREATE FUNCTION erp_private.period_due_internal_kind(p_kind text,p_ends date) RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT erp_private.rule_date(p_ends,r.internal_month_offset,r.internal_deadline_day) FROM erp_private.annual_due_rules r WHERE r.rule_id=erp_private.annual_due_rule_row(p_kind,p_ends) AND erp_private.period_due_class(p_kind)='ANNUAL'
$$;
CREATE FUNCTION erp_private.period_due_rule_text(p_kind text,p_ends date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE erp_private.period_due_class(p_kind)
  WHEN 'PAYE' THEN '9th of the following month' WHEN 'VAT' THEN '20th of the following month'
  WHEN 'ANNUAL' THEN (SELECT format('%s: %s months after the period end, on day %s (%s)',r.tax_kind,r.due_month_offset,r.external_deadline_day,CASE r.rule_status WHEN 'Confirmed' THEN 'rule confirmed by a Partner' ELSE 'rule suggested, not yet confirmed by a Partner' END) FROM erp_private.annual_due_rules r WHERE r.rule_id=erp_private.annual_due_rule_row(p_kind,p_ends)) END
$$;

-- Partner-only: change a rule's numbers (withdraws any confirmation) and record its confirmation with a written source.
CREATE FUNCTION erp_private.annual_due_rule_set(p_rule uuid,p_offset integer,p_day integer,p_int_offset integer,p_int_day integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change an annual due-date rule.' USING ERRCODE='42501'; END IF;
 IF p_offset NOT BETWEEN 1 AND 12 OR p_int_offset NOT BETWEEN 0 AND 12 THEN RAISE EXCEPTION 'Months after the period end must be between 1 and 12 (internal 0 to 12).' USING ERRCODE='23514'; END IF;
 IF p_day NOT BETWEEN 1 AND 31 OR p_int_day NOT BETWEEN 1 AND 31 THEN RAISE EXCEPTION 'The day of the month must be between 1 and 31.' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.annual_due_rules SET due_month_offset=p_offset,external_deadline_day=p_day,internal_month_offset=p_int_offset,internal_deadline_day=p_int_day,rule_status='Suggested',confirmed_by=NULL,confirmed_at=NULL WHERE rule_id=p_rule;
 IF NOT FOUND THEN RAISE EXCEPTION 'That rule does not exist.' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION erp_private.annual_due_rule_confirm(p_rule uuid,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can confirm an annual due-date rule.' USING ERRCODE='42501'; END IF;
 IF char_length(btrim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Say who confirmed this and where it is written (at least 10 characters).' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.annual_due_rules SET rule_status='Confirmed',confirmed_by=(erp_private.actor()).staff_id,confirmed_at=now(),source_note=btrim(p_note) WHERE rule_id=p_rule;
 IF NOT FOUND THEN RAISE EXCEPTION 'That rule does not exist.' USING ERRCODE='23514'; END IF;
END $$;

-- The due-date gate now suggests annual dates from the rules (the Tax Team still confirms each one).
DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.period_due_confirm(uuid,date,date,text,date,boolean)'::regprocedure);
 o:='sug:=erp_private.period_due_suggest(cls,p_end);'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'confirm patch 1'; END IF; d:=replace(d,o,'sug:=erp_private.period_due_suggest_kind(p_kind,p_end);');
 o:='CASE cls WHEN ''PAYE'' THEN ''9th of the following month'' WHEN ''VAT'' THEN ''20th of the following month'' END'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'confirm patch 2'; END IF; d:=replace(d,o,'erp_private.period_due_rule_text(p_kind,p_end)');
 EXECUTE d;
 d:=pg_get_functiondef('erp_private.period_due_fallback(uuid,date,date,text,text)'::regprocedure);
 o:='erp_private.period_due_suggest(cls,p_end)'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'fallback patch 1'; END IF; d:=replace(d,o,'erp_private.period_due_suggest_kind(p_kind,p_end)');
 o:='CASE cls WHEN ''PAYE'' THEN ''9th of the following month'' WHEN ''VAT'' THEN ''20th of the following month'' END'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'fallback patch 2'; END IF; d:=replace(d,o,'erp_private.period_due_rule_text(p_kind,p_end)');
 EXECUTE d;
 d:=pg_get_functiondef('erp_private.period_due_state(uuid,date,date,text)'::regprocedure);
 o:='erp_private.period_due_suggest(x.cls,p_end),'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'state patch 1'; END IF; d:=replace(d,o,'erp_private.period_due_suggest_kind(p_kind,p_end),''internal_suggestion'',erp_private.period_due_internal_kind(p_kind,p_end),');
 o:='CASE x.cls WHEN ''PAYE'' THEN ''9th of the following month'' WHEN ''VAT'' THEN ''20th of the following month'' END'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'state patch 2'; END IF; d:=replace(d,o,'erp_private.period_due_rule_text(p_kind,p_end)');
 EXECUTE d;
END $patch$;

REVOKE ALL ON FUNCTION erp_private.tax_manager_assign(uuid,uuid,text),erp_private.tax_manager_end(uuid,text),erp_private.tax_role_permission_set(boolean,text),erp_private.rule_date(date,integer,integer),erp_private.annual_due_rule_row(text,date),erp_private.period_due_suggest_kind(text,date),erp_private.period_due_internal_kind(text,date),erp_private.period_due_rule_text(text,date),erp_private.annual_due_rule_set(uuid,integer,integer,integer,integer),erp_private.annual_due_rule_confirm(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_manager_assign(uuid,uuid,text),erp_private.tax_manager_end(uuid,text),erp_private.tax_role_permission_set(boolean,text),erp_private.rule_date(date,integer,integer),erp_private.annual_due_rule_row(text,date),erp_private.period_due_suggest_kind(text,date),erp_private.period_due_internal_kind(text,date),erp_private.period_due_rule_text(text,date),erp_private.annual_due_rule_set(uuid,integer,integer,integer,integer),erp_private.annual_due_rule_confirm(uuid,text) TO erp_api;
