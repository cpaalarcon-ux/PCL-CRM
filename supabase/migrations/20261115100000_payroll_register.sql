-- Build 2804: the payroll register. One record of who is on a client's payroll and what they are paid, kept apart from each month's payroll run.
-- A month starts as a draft taken from the register (recurring pay rolls forward; variable items are entered new each month). Pay changes are new
-- effective-dated rows with a reason and are never edited, so an earlier month can always be explained. Each month's run is its own saved summary
-- (period_imports), so a later register change never alters a payroll that was already submitted or approved.
CREATE TABLE erp_private.client_payroll_people(
 person_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 1 AND 160),
 kra_pin text CHECK(kra_pin IS NULL OR kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
 national_id text CHECK(national_id IS NULL OR char_length(btrim(national_id)) BETWEEN 1 AND 30),
 employment_type text NOT NULL DEFAULT 'Permanent' CHECK(employment_type IN('Permanent','Contract','Casual')),
 relationship text NOT NULL DEFAULT 'Employee' CHECK(relationship IN('Employee','Casual worker','Director','Shareholder','Family member')), -- owners and partners are paid through Drawings, never payroll
 resident text CHECK(resident IS NULL OR resident IN('Resident','Non-resident')),
 phone text CHECK(phone IS NULL OR phone ~ '^\+?\d{9,13}$'),
 approval_reference text CHECK(approval_reference IS NULL OR char_length(btrim(approval_reference)) BETWEEN 1 AND 300),
 related_basis text CHECK(related_basis IS NULL OR char_length(btrim(related_basis)) BETWEEN 1 AND 500),
 started_on date NOT NULL,
 left_on date,
 left_reason text CHECK(left_reason IS NULL OR char_length(btrim(left_reason)) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Left')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Active' AND left_on IS NULL AND left_reason IS NULL) OR (status='Left' AND left_on IS NOT NULL AND left_on>=started_on AND left_reason IS NOT NULL)),
 CHECK((employment_type='Casual')=(relationship='Casual worker'))
);
CREATE UNIQUE INDEX client_payroll_people_pin_uidx ON erp_private.client_payroll_people(client_id,kra_pin) WHERE kra_pin IS NOT NULL AND status='Active';
CREATE UNIQUE INDEX client_payroll_people_id_uidx ON erp_private.client_payroll_people(client_id,national_id) WHERE national_id IS NOT NULL AND status='Active';
CREATE INDEX client_payroll_people_client_idx ON erp_private.client_payroll_people(client_id,status);
CREATE INDEX client_payroll_people_created_by_idx ON erp_private.client_payroll_people(created_by);

CREATE TABLE erp_private.client_payroll_pay(
 pay_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 person_id uuid NOT NULL REFERENCES erp_private.client_payroll_people ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 gross numeric(14,2) NOT NULL CHECK(gross>=0),
 taxable_benefits numeric(14,2) NOT NULL DEFAULT 0 CHECK(taxable_benefits>=0),
 other_pension numeric(14,2) NOT NULL DEFAULT 0 CHECK(other_pension>=0),
 mortgage_interest numeric(14,2) NOT NULL DEFAULT 0 CHECK(mortgage_interest>=0),
 postretirement_medical numeric(14,2) NOT NULL DEFAULT 0 CHECK(postretirement_medical>=0),
 effective_from date NOT NULL,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 10 AND 500),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(person_id,effective_from)
);
CREATE INDEX client_payroll_pay_client_idx ON erp_private.client_payroll_pay(client_id,person_id,effective_from);
CREATE INDEX client_payroll_pay_created_by_idx ON erp_private.client_payroll_pay(created_by);

ALTER TABLE erp_private.client_payroll_people ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_payroll_people FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_payroll_pay ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_payroll_pay FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_payroll_people TO erp_api;
GRANT SELECT,INSERT ON erp_private.client_payroll_pay TO erp_api;
CREATE POLICY payroll_people_read ON erp_private.client_payroll_people FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY payroll_people_insert ON erp_private.client_payroll_people FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY payroll_people_update ON erp_private.client_payroll_people FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE POLICY payroll_pay_read ON erp_private.client_payroll_pay FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY payroll_pay_insert ON erp_private.client_payroll_pay FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_payroll_people FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_payroll_pay FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_payroll_people FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('person_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.client_payroll_pay FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('pay_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_payroll_people FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.client_payroll_people_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Active' THEN RAISE EXCEPTION 'A person is added as active. Mark them as left separately, with a reason.' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.client_id,NEW.created_by,NEW.started_on) IS DISTINCT FROM ROW(OLD.client_id,OLD.created_by,OLD.started_on) THEN
   RAISE EXCEPTION 'The client, start date and who added the person cannot be changed.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='Left' THEN RAISE EXCEPTION 'A person who has left stays as recorded. If they return, add them again with a new start date.' USING ERRCODE='23514'; END IF;
  IF NEW.status='Left' AND EXISTS(SELECT 1 FROM erp_private.client_payroll_pay p WHERE p.person_id=NEW.person_id AND p.effective_from>NEW.left_on) THEN
   RAISE EXCEPTION 'A pay change is dated after the leaving date. Choose a later leaving date.' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_payroll_people_guard BEFORE INSERT OR UPDATE ON erp_private.client_payroll_people FOR EACH ROW EXECUTE FUNCTION erp_private.client_payroll_people_guard();

CREATE FUNCTION erp_private.client_payroll_pay_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE pr erp_private.client_payroll_people;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'A pay record is never edited. Add a new pay change with its own effective date and reason.' USING ERRCODE='23514'; END IF;
 SELECT * INTO pr FROM erp_private.client_payroll_people WHERE person_id=NEW.person_id;
 IF pr.person_id IS NULL OR pr.client_id<>NEW.client_id THEN RAISE EXCEPTION 'This pay change does not belong to that client.' USING ERRCODE='23514'; END IF;
 IF NEW.effective_from<pr.started_on THEN RAISE EXCEPTION 'Pay cannot take effect before the person started.' USING ERRCODE='23514'; END IF;
 IF pr.status='Left' AND NEW.effective_from>pr.left_on THEN RAISE EXCEPTION 'This person has left, so pay cannot take effect after the leaving date.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_payroll_pay_guard BEFORE INSERT OR UPDATE ON erp_private.client_payroll_pay FOR EACH ROW EXECUTE FUNCTION erp_private.client_payroll_pay_guard();
