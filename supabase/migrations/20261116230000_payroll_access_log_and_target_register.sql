-- Build 2835.
-- 1. Payroll access log: a record, kept for the firm, of each time a person opened payroll identity or salary data (the payroll register, a payroll run, the client confirmation,
--    or a payroll file). Insert-only. The row is written by the server in the same transaction as the read; a person cannot write it for someone else, edit it or delete it.
--    Only a Manager or Partner who can see the client may read the log.
-- 2. Measurement register for the 95% target: timed or estimated minutes per activity (a baseline before the ERP, then current periods), with rework, first-pass and
--    missed-deadline marks. A comparison is shown only after three periods, and a reduction is a measure, not a promise.
CREATE TABLE erp_private.payroll_access_log(
 log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 import_id uuid REFERENCES erp_private.period_imports ON DELETE RESTRICT,
 surface text NOT NULL CHECK(surface IN('Payroll register','Payroll run','Payroll review','Client confirmation','Confirmation PDF','Payroll file')),
 detail text CHECK(detail IS NULL OR char_length(detail)<=300),
 read_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 read_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_access_client_idx ON erp_private.payroll_access_log(client_id,read_at DESC);
CREATE INDEX payroll_access_project_idx ON erp_private.payroll_access_log(project_id);
CREATE INDEX payroll_access_import_idx ON erp_private.payroll_access_log(import_id) WHERE import_id IS NOT NULL;
CREATE INDEX payroll_access_reader_idx ON erp_private.payroll_access_log(read_by,read_at DESC);

CREATE TABLE erp_private.target_measurements(
 measurement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid REFERENCES erp_private.clients ON DELETE RESTRICT,
 activity text NOT NULL CHECK(activity IN('Client setup','Engagement setup','Period opening','Payroll preparation','Bank and receipts routing','VAT return preparation','Annual statements','Year rollover','Review pack','Other')),
 kind text NOT NULL CHECK(kind IN('Baseline','Current')),
 period_label text NOT NULL CHECK(period_label ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 minutes numeric(8,1) NOT NULL CHECK(minutes>0 AND minutes<=20000),
 method text NOT NULL CHECK(method IN('Timed','Timesheet','Estimated')),
 note text CHECK(note IS NULL OR char_length(note)<=1000),
 first_pass boolean,
 rework_minutes numeric(8,1) NOT NULL DEFAULT 0 CHECK(rework_minutes>=0 AND rework_minutes<=20000),
 missed_deadline boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Voided')),
 void_reason text, voided_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT, voided_at timestamptz,
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind='Current' OR (first_pass IS NULL AND rework_minutes=0 AND NOT missed_deadline)),
 CHECK(kind='Baseline' OR first_pass IS NOT NULL),
 CHECK(method<>'Estimated' OR (note IS NOT NULL AND char_length(btrim(note))>=10)),
 CHECK(status='Active' OR (void_reason IS NOT NULL AND char_length(btrim(void_reason))>=10 AND voided_by IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE INDEX target_measure_activity_idx ON erp_private.target_measurements(activity,kind,period_label);
CREATE INDEX target_measure_client_idx ON erp_private.target_measurements(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX target_measure_by_idx ON erp_private.target_measurements(recorded_by);
CREATE INDEX target_measure_void_idx ON erp_private.target_measurements(voided_by) WHERE voided_by IS NOT NULL;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['payroll_access_log','target_measurements'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
END LOOP; END $$;
GRANT SELECT,INSERT ON erp_private.payroll_access_log TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.target_measurements TO erp_api;
CREATE POLICY payroll_access_log_read ON erp_private.payroll_access_log FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY payroll_access_log_insert ON erp_private.payroll_access_log FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND read_by=(erp_private.actor()).staff_id);
CREATE POLICY target_measurements_read ON erp_private.target_measurements FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY target_measurements_insert ON erp_private.target_measurements FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND recorded_by=(erp_private.actor()).staff_id AND status='Active' AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY target_measurements_void ON erp_private.target_measurements FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND (client_id IS NULL OR erp_private.client_allowed(client_id))) WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR'));

CREATE FUNCTION erp_private.payroll_access_log_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'The payroll access log is never edited.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER payroll_access_no_update BEFORE UPDATE ON erp_private.payroll_access_log FOR EACH ROW EXECUTE FUNCTION erp_private.payroll_access_log_immutable();

-- A project must belong to the same client the log row names, and an import to the same project.
CREATE FUNCTION erp_private.payroll_access_log_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.projects WHERE project_id=NEW.project_id AND client_id=NEW.client_id) THEN RAISE EXCEPTION 'The engagement belongs to another client.' USING ERRCODE='23514'; END IF;
 IF NEW.import_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.period_imports WHERE import_id=NEW.import_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'The payroll run belongs to another engagement.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_access_log_guard BEFORE INSERT ON erp_private.payroll_access_log FOR EACH ROW EXECUTE FUNCTION erp_private.payroll_access_log_guard();

-- A measurement is never edited: it is voided with a reason and entered again. A current-period entry needs a baseline for the same activity (the client's own, or the firm-wide one).
CREATE FUNCTION erp_private.target_measurement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.kind='Current' AND NOT EXISTS(SELECT 1 FROM erp_private.target_measurements b WHERE b.kind='Baseline' AND b.status='Active' AND b.activity=NEW.activity AND (b.client_id IS NULL OR b.client_id IS NOT DISTINCT FROM NEW.client_id)) THEN
   RAISE EXCEPTION 'Record the baseline for this activity first, so the comparison is against how long it took before.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Active' AND NEW.status='Voided' AND ROW(NEW.client_id,NEW.activity,NEW.kind,NEW.period_label,NEW.minutes,NEW.method,NEW.note,NEW.first_pass,NEW.rework_minutes,NEW.missed_deadline,NEW.recorded_by,NEW.recorded_at) IS NOT DISTINCT FROM ROW(OLD.client_id,OLD.activity,OLD.kind,OLD.period_label,OLD.minutes,OLD.method,OLD.note,OLD.first_pass,OLD.rework_minutes,OLD.missed_deadline,OLD.recorded_by,OLD.recorded_at) AND NEW.voided_by=(erp_private.actor()).staff_id THEN
  RETURN NEW; END IF;
 RAISE EXCEPTION 'A measurement is never edited. Void it with a reason and enter it again.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER target_measurement_guard BEFORE INSERT OR UPDATE ON erp_private.target_measurements FOR EACH ROW EXECUTE FUNCTION erp_private.target_measurement_guard();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.target_measurements FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('measurement_id');
REVOKE ALL ON FUNCTION erp_private.payroll_access_log_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.payroll_access_log_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.target_measurement_guard() FROM PUBLIC,anon,authenticated;
