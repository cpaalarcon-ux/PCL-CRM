-- Build 2810: client-type templates and service templates, kept apart on purpose.
--  * A client type (individual, partnership, company, NGO and similar, co-operative and other regulated) decides which facts, evidence and people the
--    client file asks for. It never selects a service. The five templates sit over the legal structure and its subtype that the client already has.
--  * A service template (tax compliance, accounting, payroll, audit and assurance, advisory and other) says which tasks a service creates. The firm's
--    Partner approves each template; an approved template is never edited, a change is a new version.
--  * An engagement set-up is the explicit choice of service, period, scope, responsible person and reviewer. Only then are tasks created, and only those
--    whose conditions the client's confirmed profile meets. The same client, service and period can be set up once.
-- Mapping or templates never confirm a fact: facts, evidence and tax profiles keep their own verification.

CREATE TABLE erp_private.client_type_templates(
 template_code text PRIMARY KEY CHECK(template_code ~ '^[A-Z][A-Z_]{2,24}$'),
 name text NOT NULL,
 controls text NOT NULL,
 regulatory_overlay boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 100
);
INSERT INTO erp_private.client_type_templates(template_code,name,controls,regulatory_overlay,sort_order) VALUES
 ('INDIVIDUAL','Individual / sole proprietor','Identity, business name, PIN, business details and applicable registrations',false,10),
 ('PARTNERSHIP','Partnership / LLP','Registration details, partners, ownership and authority to act',false,20),
 ('COMPANY','Limited company','Registration, PIN, directors, shareholders, ownership and authority to act',false,30),
 ('NONPROFIT','NGO / PBO / trust / society','Registration category, trustees or officials, governing documents and funder or regulatory details',false,40),
 ('COOPERATIVE','Co-operative / SACCO / other regulated entity','The registration, people and authority of the entity, plus the regulator and its licence or registration',true,50);

-- Which template a legal structure belongs to. '*' means every subcategory of the structure; a named subcategory wins.
-- A structure with no row here has no template: the client file says so and a Partner decides. Nothing is assumed.
CREATE TABLE erp_private.client_type_template_map(
 structure text NOT NULL,
 subtype text NOT NULL DEFAULT '*',
 template_code text NOT NULL REFERENCES erp_private.client_type_templates,
 PRIMARY KEY(structure,subtype)
);
CREATE INDEX client_type_template_map_template_idx ON erp_private.client_type_template_map(template_code);
INSERT INTO erp_private.client_type_template_map(structure,subtype,template_code) VALUES
 ('Individual','*','INDIVIDUAL'),
 ('Partnership','*','PARTNERSHIP'),
 ('Limited Company','*','COMPANY'),
 ('Non-Profit Organisation','*','NONPROFIT'),
 ('Other','Trust','NONPROFIT'),
 ('Other','Association','NONPROFIT'),
 ('Co-operative Society','*','COOPERATIVE');

-- Facts the template asks for (the field catalogue and its checks live in client-master-rules.mjs). 'If applicable' facts are shown and never block.
CREATE TABLE erp_private.client_template_fields(
 template_code text NOT NULL REFERENCES erp_private.client_type_templates,
 field_key text NOT NULL CHECK(field_key ~ '^[a-z][a-z0-9_]{1,59}$'),
 requirement text NOT NULL CHECK(requirement IN('Required','If applicable')),
 sort_order integer NOT NULL DEFAULT 100,
 PRIMARY KEY(template_code,field_key)
);
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order)
SELECT t.template_code,f.field_key,f.requirement,f.ord FROM erp_private.client_type_templates t CROSS JOIN (VALUES
 ('company_name','Required',10),('kra_pin','Required',20),('registered_address','Required',60),('contact_person','Required',70),
 ('contact_phone','Required',80),('contact_email','Required',90),('year_end','Required',100)) f(field_key,requirement,ord);
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order) VALUES
 ('INDIVIDUAL','national_id','Required',30),('INDIVIDUAL','business_name','If applicable',40),('INDIVIDUAL','business_details','Required',50),
 ('PARTNERSHIP','registration_number','Required',30),('PARTNERSHIP','authority_basis','Required',40),
 ('COMPANY','registration_number','Required',30),('COMPANY','incorporation_date','Required',40),('COMPANY','authority_basis','Required',50),
 ('NONPROFIT','registration_number','Required',30),('NONPROFIT','registration_category','Required',35),('NONPROFIT','incorporation_date','Required',40),
 ('NONPROFIT','authority_basis','Required',50),('NONPROFIT','funder_regulatory_details','If applicable',55),
 ('COOPERATIVE','registration_number','Required',30),('COOPERATIVE','incorporation_date','Required',40),('COOPERATIVE','authority_basis','Required',50),
 ('COOPERATIVE','regulator','Required',55),('COOPERATIVE','regulator_registration_number','Required',56);

-- People the template asks for, from the existing parties register (directors, shareholders, trustees).
CREATE TABLE erp_private.client_template_parties(
 template_code text NOT NULL REFERENCES erp_private.client_type_templates,
 role text NOT NULL CHECK(role IN('Director','Shareholder','Trustee')),
 min_count integer NOT NULL DEFAULT 1 CHECK(min_count>=1),
 requirement text NOT NULL CHECK(requirement IN('Required','If applicable')),
 label text NOT NULL,
 PRIMARY KEY(template_code,role)
);
INSERT INTO erp_private.client_template_parties(template_code,role,min_count,requirement,label) VALUES
 ('COMPANY','Director',1,'Required','Directors'),
 ('COMPANY','Shareholder',1,'Required','Shareholders (holdings must add up to 100%)'),
 ('NONPROFIT','Trustee',1,'Required','Trustees or officials (recorded under Trustee)'),
 ('COOPERATIVE','Director',1,'Required','Board members (recorded under Director)');

-- Service templates: the firm's master list of what a service creates. A Partner other than the proposer approves.
CREATE TABLE erp_private.service_templates(
 template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_code text NOT NULL CHECK(template_code ~ '^[A-Z][A-Z0-9-]{2,29}$'),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 3 AND 120),
 service_group text NOT NULL CHECK(service_group IN('Tax Compliance','Accounting and Bookkeeping','Payroll','Audit and Assurance','Advisory and Other')),
 description text NOT NULL DEFAULT '',
 source text NOT NULL DEFAULT 'Staff' CHECK(source IN('Starter','Staff')),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Retired')),
 proposed_by uuid REFERENCES erp_private.staff_members,
 proposed_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 retired_by uuid REFERENCES erp_private.staff_members,
 retired_at timestamptz,
 retired_reason text CHECK(retired_reason IS NULL OR char_length(btrim(retired_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(template_code,version),
 CHECK(proposed_by IS NOT NULL OR source='Starter'),
 CHECK(status<>'Approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK(approved_by IS NULL OR proposed_by IS NULL OR approved_by<>proposed_by),
 CHECK(status<>'Retired' OR (retired_by IS NOT NULL AND retired_at IS NOT NULL AND retired_reason IS NOT NULL))
);
CREATE UNIQUE INDEX service_templates_one_approved_uidx ON erp_private.service_templates(template_code) WHERE status='Approved';
CREATE INDEX service_templates_proposed_by_idx ON erp_private.service_templates(proposed_by) WHERE proposed_by IS NOT NULL;
CREATE INDEX service_templates_approved_by_idx ON erp_private.service_templates(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX service_templates_retired_by_idx ON erp_private.service_templates(retired_by) WHERE retired_by IS NOT NULL;

CREATE TABLE erp_private.service_template_services(
 template_id uuid NOT NULL REFERENCES erp_private.service_templates ON DELETE RESTRICT,
 service_code text NOT NULL REFERENCES erp_private.services,
 PRIMARY KEY(template_id,service_code)
);
CREATE INDEX service_template_services_service_idx ON erp_private.service_template_services(service_code);

-- One task a service creates. due_basis: the service start or the end of the period; due_days after it. A task that needs a registration
-- (requires_obligation) or a licence is created only when the client's confirmed profile has it. Mandatory tasks can be dropped only with a reason by a Manager or Partner.
CREATE TABLE erp_private.service_template_tasks(
 template_id uuid NOT NULL REFERENCES erp_private.service_templates ON DELETE RESTRICT,
 task_key text NOT NULL CHECK(task_key ~ '^[a-z][a-z0-9_]{1,39}$'),
 task_name text NOT NULL CHECK(char_length(btrim(task_name)) BETWEEN 3 AND 200),
 description text NOT NULL DEFAULT '',
 stage text NOT NULL CHECK(stage IN('Acceptance','Execution','Review','Issue')),
 recurrence text NOT NULL DEFAULT 'Once' CHECK(recurrence IN('Once','Monthly','Quarterly','Annual')),
 due_basis text NOT NULL DEFAULT 'Period end' CHECK(due_basis IN('Start','Period end')),
 due_days integer NOT NULL DEFAULT 10 CHECK(due_days BETWEEN 0 AND 366),
 owner_role text NOT NULL DEFAULT 'RESPONSIBLE' CHECK(owner_role IN('RESPONSIBLE','REVIEWER')),
 mandatory boolean NOT NULL DEFAULT true,
 requires_document boolean NOT NULL DEFAULT false,
 requires_obligation text CHECK(requires_obligation IN('VAT','PAYE','TOT','Payroll','Income Tax')),
 requires_licence text REFERENCES erp_private.licence_types,
 requires_client_template text[],
 sort_order integer NOT NULL DEFAULT 100,
 PRIMARY KEY(template_id,task_key)
);
CREATE INDEX service_template_tasks_licence_idx ON erp_private.service_template_tasks(requires_licence) WHERE requires_licence IS NOT NULL;

-- The explicit set-up of one service for one client and period. It waits until the project may take tasks (an Active project, opening balances posted where the
-- ledger needs them) and is then released once; after that it never changes. A mistake is corrected with ordinary task changes.
CREATE TABLE erp_private.engagement_setups(
 setup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 template_id uuid NOT NULL REFERENCES erp_private.service_templates ON DELETE RESTRICT,
 service_code text NOT NULL REFERENCES erp_private.services,
 period_start date NOT NULL,
 period_end date NOT NULL,
 scope text NOT NULL CHECK(char_length(btrim(scope)) BETWEEN 10 AND 2000),
 responsible_staff uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewer_staff uuid NOT NULL REFERENCES erp_private.staff_members,
 client_template_code text REFERENCES erp_private.client_type_templates,
 exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'Waiting' CHECK(status IN('Waiting','Released')),
 tasks_created integer NOT NULL DEFAULT 0 CHECK(tasks_created>=0),
 skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
 applied_by uuid NOT NULL REFERENCES erp_private.staff_members,
 applied_at timestamptz NOT NULL DEFAULT now(),
 released_by uuid REFERENCES erp_private.staff_members,
 released_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'Released' OR (released_by IS NOT NULL AND released_at IS NOT NULL)),
 CHECK(period_end>=period_start),
 CHECK(responsible_staff<>reviewer_staff),
 UNIQUE(client_id,service_code,period_start,period_end)
);
CREATE INDEX engagement_setups_project_idx ON erp_private.engagement_setups(project_id);
CREATE INDEX engagement_setups_template_idx ON erp_private.engagement_setups(template_id);
CREATE INDEX engagement_setups_responsible_idx ON erp_private.engagement_setups(responsible_staff);
CREATE INDEX engagement_setups_reviewer_idx ON erp_private.engagement_setups(reviewer_staff);
CREATE INDEX engagement_setups_applied_by_idx ON erp_private.engagement_setups(applied_by);
CREATE INDEX engagement_setups_released_by_idx ON erp_private.engagement_setups(released_by) WHERE released_by IS NOT NULL;
CREATE INDEX engagement_setups_client_template_idx ON erp_private.engagement_setups(client_template_code) WHERE client_template_code IS NOT NULL;

DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('client_type_templates'),('client_type_template_map'),('client_template_fields'),('client_template_parties'),
  ('service_templates'),('service_template_services'),('service_template_tasks'),('engagement_setups')) x(tbl) LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tbl);
 END LOOP;
END $$;
GRANT SELECT ON erp_private.client_type_templates,erp_private.client_type_template_map,erp_private.client_template_fields,erp_private.client_template_parties TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.service_templates TO erp_api;
GRANT SELECT,INSERT ON erp_private.service_template_services,erp_private.service_template_tasks TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.engagement_setups TO erp_api;
CREATE POLICY ctt_read ON erp_private.client_type_templates FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY cttm_read ON erp_private.client_type_template_map FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY ctf_read ON erp_private.client_template_fields FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY ctp_read ON erp_private.client_template_parties FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY st_read ON erp_private.service_templates FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY st_insert ON erp_private.service_templates FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND proposed_by=(erp_private.actor()).staff_id);
CREATE POLICY st_update ON erp_private.service_templates FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY sts_read ON erp_private.service_template_services FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY sts_insert ON erp_private.service_template_services FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY stt_read ON erp_private.service_template_tasks FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY stt_insert ON erp_private.service_template_tasks FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY es_read ON erp_private.engagement_setups FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND erp_private.project_allowed(project_id));
CREATE POLICY es_insert ON erp_private.engagement_setups FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.client_allowed(client_id) AND erp_private.project_allowed(project_id) AND applied_by=(erp_private.actor()).staff_id);
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.service_templates FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('template_id');
CREATE POLICY es_update ON erp_private.engagement_setups FOR UPDATE TO erp_api USING(erp_private.project_editor() AND erp_private.client_allowed(client_id) AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_editor() AND erp_private.client_allowed(client_id) AND erp_private.project_allowed(project_id));
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.engagement_setups FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('setup_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.engagement_setups FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.engagement_setups_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $g$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Waiting' THEN RAISE EXCEPTION 'A set-up starts as waiting and is released separately.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.service_templates t WHERE t.template_id=NEW.template_id AND t.status='Approved') THEN RAISE EXCEPTION 'Only an approved service template can be used.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.service_template_services s WHERE s.template_id=NEW.template_id AND s.service_code=NEW.service_code) THEN RAISE EXCEPTION 'This template is not for that service.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id AND p.service_code=NEW.service_code) THEN RAISE EXCEPTION 'The project must be this client''s project for that service.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.project_id,NEW.template_id,NEW.service_code,NEW.period_start,NEW.period_end,NEW.scope,NEW.responsible_staff,NEW.reviewer_staff,NEW.client_template_code,NEW.exclusions,NEW.applied_by,NEW.applied_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.template_id,OLD.service_code,OLD.period_start,OLD.period_end,OLD.scope,OLD.responsible_staff,OLD.reviewer_staff,OLD.client_template_code,OLD.exclusions,OLD.applied_by,OLD.applied_at) THEN
  RAISE EXCEPTION 'An engagement set-up is not edited.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Released' THEN RAISE EXCEPTION 'A released set-up stays as it was.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'Released' THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $g$;
CREATE TRIGGER engagement_setups_guard BEFORE INSERT OR UPDATE ON erp_private.engagement_setups FOR EACH ROW EXECUTE FUNCTION erp_private.engagement_setups_guard();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.service_templates FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

-- Template rules the database repeats: tasks and services belong to a draft only; approval is by a Partner who did not propose it; an approved template is never edited.
CREATE FUNCTION erp_private.service_template_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE st text;
BEGIN
 SELECT status INTO st FROM erp_private.service_templates WHERE template_id=NEW.template_id;
 IF st IS DISTINCT FROM 'Draft' THEN RAISE EXCEPTION 'Only a draft service template can take tasks or services. Propose a new version instead.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_template_services_guard BEFORE INSERT ON erp_private.service_template_services FOR EACH ROW EXECUTE FUNCTION erp_private.service_template_child_guard();
CREATE TRIGGER service_template_tasks_guard BEFORE INSERT ON erp_private.service_template_tasks FOR EACH ROW EXECUTE FUNCTION erp_private.service_template_child_guard();

CREATE FUNCTION erp_private.service_templates_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' AND current_user='erp_api' THEN RAISE EXCEPTION 'Propose a draft; a Partner approves it separately.' USING ERRCODE='42501'; END IF;
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
   IF cat<>'PARTNER' THEN RAISE EXCEPTION 'A Partner approves a service template.' USING ERRCODE='42501'; END IF;
   IF NEW.approved_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Approval is recorded under your own name.' USING ERRCODE='42501'; END IF;
   IF OLD.proposed_by IS NOT NULL AND OLD.proposed_by=me THEN RAISE EXCEPTION 'A different Partner approves a template you proposed.' USING ERRCODE='42501'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.service_template_tasks t WHERE t.template_id=NEW.template_id) OR NOT EXISTS(SELECT 1 FROM erp_private.service_template_services s WHERE s.template_id=NEW.template_id) THEN
   RAISE EXCEPTION 'A template needs at least one task and one service before it is approved.' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.status='Retired' AND OLD.status IN('Draft','Approved') THEN
  IF current_user='erp_api' AND (cat<>'PARTNER' OR NEW.retired_by IS DISTINCT FROM me) THEN RAISE EXCEPTION 'A Partner retires a service template, with a reason.' USING ERRCODE='42501'; END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
  RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_templates_guard BEFORE INSERT OR UPDATE ON erp_private.service_templates FOR EACH ROW EXECUTE FUNCTION erp_private.service_templates_guard();

-- Starter templates for the five service groups. They are drafts, marked as the starter set. Nothing is created from them until a Partner approves them.
INSERT INTO erp_private.service_templates(template_id,template_code,version,name,service_group,description,source) VALUES
 ('00000000-0000-4000-8000-0000000a0001','TAX-MONTHLY',1,'Tax compliance, monthly','Tax Compliance','Monthly VAT and PAYE working for a client, created only for the registrations the client''s confirmed tax profile shows. Internal work targets; confirm statutory dates before filing.','Starter'),
 ('00000000-0000-4000-8000-0000000a0002','ACC-MONTHLY',1,'Accounting and bookkeeping, monthly','Accounting and Bookkeeping','Monthly bookkeeping and month-end review.','Starter'),
 ('00000000-0000-4000-8000-0000000a0003','PAYROLL-MONTHLY',1,'Payroll, monthly','Payroll','Monthly payroll run, review and statutory schedules.','Starter'),
 ('00000000-0000-4000-8000-0000000a0004','AUDIT-ANNUAL',1,'Audit and assurance, one engagement','Audit and Assurance','Acceptance, planning, fieldwork, completion and issue for one engagement period.','Starter'),
 ('00000000-0000-4000-8000-0000000a0005','ADVISORY-PROJECT',1,'Advisory and other, one engagement','Advisory and Other','Scoping, work, review and issue for one piece of advisory or other work.','Starter');

INSERT INTO erp_private.service_template_services(template_id,service_code)
SELECT t.template_id,s.service_code FROM erp_private.service_templates t JOIN erp_private.services s ON
 (t.template_code='TAX-MONTHLY' AND s.service_code='TAX-COMP')
 OR (t.template_code='ACC-MONTHLY' AND s.service_code IN('ACC-BOOK','ACC-REP','ACC-MGMT'))
 OR (t.template_code='PAYROLL-MONTHLY' AND s.service_code='ACC-PAY')
 OR (t.template_code='AUDIT-ANNUAL' AND s.service_code LIKE 'AUD-%')
 OR (t.template_code='ADVISORY-PROJECT' AND s.service_code NOT LIKE 'AUD-%' AND s.service_code NOT IN('TAX-COMP','ACC-BOOK','ACC-REP','ACC-MGMT','ACC-PAY'))
WHERE t.source='Starter';

INSERT INTO erp_private.service_template_tasks(template_id,task_key,task_name,description,stage,recurrence,due_basis,due_days,owner_role,mandatory,requires_document,requires_obligation,sort_order) VALUES
 ('00000000-0000-4000-8000-0000000a0001','sales','Collect and upload sales for the month','Net sales from the client''s eTIMS or sales records.','Execution','Monthly','Period end',5,'RESPONSIBLE',true,true,NULL,10),
 ('00000000-0000-4000-8000-0000000a0001','purchases','Collect and upload purchases for the month','Purchase invoices and expense evidence.','Execution','Monthly','Period end',5,'RESPONSIBLE',true,true,NULL,20),
 ('00000000-0000-4000-8000-0000000a0001','vat_working','Prepare VAT return working','Created only when the confirmed tax profile shows VAT.','Execution','Monthly','Period end',12,'RESPONSIBLE',true,false,'VAT',30),
 ('00000000-0000-4000-8000-0000000a0001','vat_review','Review VAT return working','Independent review before filing.','Review','Monthly','Period end',15,'REVIEWER',true,false,'VAT',40),
 ('00000000-0000-4000-8000-0000000a0001','paye_working','Prepare PAYE return working','Created only when the confirmed tax profile shows PAYE.','Execution','Monthly','Period end',6,'RESPONSIBLE',true,false,'PAYE',50),
 ('00000000-0000-4000-8000-0000000a0001','paye_review','Review PAYE return working','Independent review before filing.','Review','Monthly','Period end',8,'REVIEWER',true,false,'PAYE',60),
 ('00000000-0000-4000-8000-0000000a0001','tot_working','Prepare turnover tax working','Created only when the confirmed tax profile shows turnover tax.','Execution','Monthly','Period end',12,'RESPONSIBLE',true,false,'TOT',70),
 ('00000000-0000-4000-8000-0000000a0001','income_tax','Prepare income tax computation','Created only when the confirmed tax profile shows income tax.','Execution','Annual','Period end',120,'RESPONSIBLE',true,false,'Income Tax',80),
 ('00000000-0000-4000-8000-0000000a0002','bank_statements','Collect bank statements for the month','','Execution','Monthly','Period end',5,'RESPONSIBLE',true,true,NULL,10),
 ('00000000-0000-4000-8000-0000000a0002','bank_rec','Reconcile bank accounts','','Execution','Monthly','Period end',10,'RESPONSIBLE',true,false,NULL,20),
 ('00000000-0000-4000-8000-0000000a0002','ledger_review','Review postings and trial balance','','Review','Monthly','Period end',14,'REVIEWER',true,false,NULL,30),
 ('00000000-0000-4000-8000-0000000a0002','month_pack','Month-end accounts pack for the client','Optional for clients who do not want a monthly pack.','Issue','Monthly','Period end',18,'RESPONSIBLE',false,false,NULL,40),
 ('00000000-0000-4000-8000-0000000a0003','register','Confirm employee changes for the month','New employees, leavers and salary changes, each with an effective date and reason.','Execution','Monthly','Period end',2,'RESPONSIBLE',true,false,NULL,10),
 ('00000000-0000-4000-8000-0000000a0003','run','Prepare the payroll run','Roll the register into a draft run and complete it.','Execution','Monthly','Period end',4,'RESPONSIBLE',true,false,NULL,20),
 ('00000000-0000-4000-8000-0000000a0003','review','Review and approve the payroll run','Independent review.','Review','Monthly','Period end',6,'REVIEWER',true,false,NULL,30),
 ('00000000-0000-4000-8000-0000000a0003','statutory','Prepare statutory payment schedules','Created only when the confirmed tax profile shows PAYE.','Execution','Monthly','Period end',8,'RESPONSIBLE',true,false,'PAYE',40),
 ('00000000-0000-4000-8000-0000000a0004','acceptance','Acceptance and independence checks','','Acceptance','Once','Start',5,'RESPONSIBLE',true,false,NULL,10),
 ('00000000-0000-4000-8000-0000000a0004','planning','Planning and risk assessment','','Execution','Once','Start',30,'RESPONSIBLE',true,false,NULL,20),
 ('00000000-0000-4000-8000-0000000a0004','fieldwork','Fieldwork and working papers','','Execution','Once','Period end',60,'RESPONSIBLE',true,false,NULL,30),
 ('00000000-0000-4000-8000-0000000a0004','completion','Completion review','','Review','Once','Period end',75,'REVIEWER',true,false,NULL,40),
 ('00000000-0000-4000-8000-0000000a0004','report','Issue the signed report','','Issue','Once','Period end',90,'REVIEWER',true,false,NULL,50),
 ('00000000-0000-4000-8000-0000000a0005','scoping','Agree scope and deliverables with the client','','Acceptance','Once','Start',5,'RESPONSIBLE',true,false,NULL,10),
 ('00000000-0000-4000-8000-0000000a0005','work','Carry out the work','','Execution','Once','Start',30,'RESPONSIBLE',true,false,NULL,20),
 ('00000000-0000-4000-8000-0000000a0005','review','Review the draft deliverable','','Review','Once','Start',40,'REVIEWER',true,false,NULL,30),
 ('00000000-0000-4000-8000-0000000a0005','issue','Issue the final deliverable','','Issue','Once','Start',45,'RESPONSIBLE',true,false,NULL,40);
