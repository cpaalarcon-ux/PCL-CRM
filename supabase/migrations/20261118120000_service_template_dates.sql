-- Build 2845: "effective from" and "last reviewed" dates for service categories (service templates).
-- A service template is never edited once approved, so the dates are an insert-only history beside it: each row says, for one template version, from when it applies and when it was
-- last reviewed, who recorded it and why. The latest row for a template is the one in force; the earlier rows stay. The dates are shown, they do not block an engagement.
-- Any Partner or Manager may record dates for a Draft or Approved version (the same people who propose and approve). A retired version keeps the dates it had.
CREATE TABLE erp_private.service_template_dates(
 date_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_id uuid NOT NULL REFERENCES erp_private.service_templates ON DELETE RESTRICT,
 effective_from date CHECK(effective_from IS NULL OR effective_from BETWEEN DATE '2020-01-01' AND DATE '2100-12-31'),
 last_reviewed date CHECK(last_reviewed IS NULL OR last_reviewed BETWEEN DATE '2020-01-01' AND current_date+1),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(effective_from IS NOT NULL OR last_reviewed IS NOT NULL)
);
CREATE INDEX service_template_dates_template_idx ON erp_private.service_template_dates(template_id,recorded_at DESC);
CREATE INDEX service_template_dates_by_idx ON erp_private.service_template_dates(recorded_by);
ALTER TABLE erp_private.service_template_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.service_template_dates FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.service_template_dates TO erp_api;
-- Everyone who can see a template may see its dates (Supervisors set up engagements from approved templates).
CREATE POLICY std_read ON erp_private.service_template_dates FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY std_insert ON erp_private.service_template_dates FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND recorded_by=(erp_private.actor()).staff_id);
CREATE FUNCTION erp_private.service_template_dates_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF (SELECT status FROM erp_private.service_templates WHERE template_id=NEW.template_id)='Retired' THEN
  RAISE EXCEPTION 'A retired service template keeps the dates it had.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER guard BEFORE INSERT ON erp_private.service_template_dates FOR EACH ROW EXECUTE FUNCTION erp_private.service_template_dates_guard();
CREATE FUNCTION erp_private.service_template_dates_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A recorded date is part of the history and cannot be changed or removed. Record a new one.' USING ERRCODE='42501'; END;$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.service_template_dates FOR EACH ROW EXECUTE FUNCTION erp_private.service_template_dates_immutable();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.service_template_dates FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('date_id');
