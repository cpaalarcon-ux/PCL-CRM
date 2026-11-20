-- Build 2821: Template Library. Managers and Partners upload the firm's upload templates (sales, purchases, VAT and withholding, bank analysis, payroll, trial balance,
-- non-eTIMS expenditure, other) as numbered versions. A version is a Draft until a different Manager or Partner publishes it (a Partner who is the firm's only Partner
-- may publish what they uploaded, and that is recorded). A published version is never edited; a newer version replaces it and the old one is Retired with the reason.
-- Imports record the version in force on the day, so any later question of "which template was this loaded with" has an answer.
CREATE TABLE erp_private.import_templates(
 template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_key text NOT NULL CHECK(template_key IN('SALES','PURCHASES','VAT_WHT','BANK_ANALYSIS','PAYROLL','TRIAL_BALANCE','NON_ETIMS','OTHER')),
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 3 AND 120),
 version integer NOT NULL CHECK(version>=1),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Published','Retired')),
 importer_profile text CHECK(importer_profile IS NULL OR char_length(btrim(importer_profile)) BETWEEN 1 AND 80),
 required_columns jsonb NOT NULL CHECK(jsonb_typeof(required_columns)='array' AND jsonb_array_length(required_columns) BETWEEN 1 AND 60),
 validation_notes text CHECK(validation_notes IS NULL OR char_length(validation_notes)<=2000),
 effective_from date NOT NULL,
 effective_to date,
 file_name text NOT NULL CHECK(char_length(btrim(file_name)) BETWEEN 1 AND 200),
 mime_type text NOT NULL CHECK(char_length(mime_type)<=120),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 file_base64 text NOT NULL CHECK(char_length(file_base64) BETWEEN 4 AND 2800000),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 published_by uuid REFERENCES erp_private.staff_members,published_at timestamptz,sole_partner_publish boolean NOT NULL DEFAULT false,
 retired_by uuid REFERENCES erp_private.staff_members,retired_at timestamptz,retired_reason text CHECK(retired_reason IS NULL OR char_length(btrim(retired_reason)) BETWEEN 5 AND 500),
 revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_key,version),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(status='Draft' OR (published_by IS NOT NULL AND published_at IS NOT NULL) OR (status='Retired' AND published_by IS NULL AND retired_by IS NOT NULL)),
 CHECK(published_by IS NULL OR published_by<>created_by OR sole_partner_publish),
 CHECK(status<>'Retired' OR (retired_by IS NOT NULL AND retired_at IS NOT NULL AND retired_reason IS NOT NULL))
);
CREATE UNIQUE INDEX import_templates_one_published_uidx ON erp_private.import_templates(template_key) WHERE status='Published';
CREATE INDEX import_templates_created_by_idx ON erp_private.import_templates(created_by);
CREATE INDEX import_templates_published_by_idx ON erp_private.import_templates(published_by) WHERE published_by IS NOT NULL;
CREATE INDEX import_templates_retired_by_idx ON erp_private.import_templates(retired_by) WHERE retired_by IS NOT NULL;
ALTER TABLE erp_private.import_templates ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.import_templates FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.import_templates TO erp_api;
CREATE POLICY it_read ON erp_private.import_templates FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN') AND (status<>'Draft' OR (erp_private.actor()).category_code IN('PARTNER','MANAGER')));
CREATE POLICY it_insert ON erp_private.import_templates FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY it_update ON erp_private.import_templates FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.import_templates FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.import_templates FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('template_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.import_templates FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.import_templates_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' THEN RAISE EXCEPTION 'Upload a draft; a different Manager or Partner publishes it.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_publish THEN RAISE EXCEPTION 'That flag is set only when a sole Partner publishes.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.import_templates WHERE template_key=NEW.template_key),0)+1 THEN RAISE EXCEPTION 'Versions are numbered in order.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.template_key,NEW.version,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.template_key,OLD.version,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'The template, its version and its uploader never change.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Retired' THEN RAISE EXCEPTION 'A retired template version stays as it was.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Draft' THEN
  IF current_user='erp_api' AND OLD.created_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Only the person who uploaded a draft revises it.' USING ERRCODE='42501'; END IF;
  IF ROW(NEW.published_by,NEW.published_at,NEW.sole_partner_publish,NEW.retired_by,NEW.retired_at,NEW.retired_reason) IS DISTINCT FROM ROW(OLD.published_by,OLD.published_at,OLD.sole_partner_publish,OLD.retired_by,OLD.retired_at,OLD.retired_reason) THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.name,NEW.importer_profile,NEW.required_columns,NEW.validation_notes,NEW.effective_from,NEW.effective_to,NEW.file_name,NEW.mime_type,NEW.file_sha256,NEW.file_base64)
    IS DISTINCT FROM ROW(OLD.name,OLD.importer_profile,OLD.required_columns,OLD.validation_notes,OLD.effective_from,OLD.effective_to,OLD.file_name,OLD.mime_type,OLD.file_sha256,OLD.file_base64) THEN
  RAISE EXCEPTION 'A published template is never edited. Upload a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' AND NEW.status='Published' THEN
  IF current_user='erp_api' THEN
   IF cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner publishes a template.' USING ERRCODE='42501'; END IF;
   IF NEW.published_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Publishing is recorded under your own name.' USING ERRCODE='42501'; END IF;
   IF OLD.created_by=me THEN
    IF cat<>'PARTNER' OR NOT erp_private.sole_active_partner() OR NOT NEW.sole_partner_publish THEN
     RAISE EXCEPTION 'A different Manager or Partner publishes a template you uploaded, unless you are your firm''s only Partner.' USING ERRCODE='42501';
    END IF;
   ELSIF NEW.sole_partner_publish THEN RAISE EXCEPTION 'That flag is set only when a sole Partner publishes their own upload.' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSIF NEW.status='Retired' AND OLD.status IN('Draft','Published') THEN
  IF current_user='erp_api' AND (cat NOT IN('PARTNER','MANAGER') OR NEW.retired_by IS DISTINCT FROM me) THEN RAISE EXCEPTION 'A Manager or Partner retires a template, with a reason.' USING ERRCODE='42501'; END IF;
  IF ROW(NEW.published_by,NEW.published_at,NEW.sole_partner_publish) IS DISTINCT FROM ROW(OLD.published_by,OLD.published_at,OLD.sole_partner_publish) THEN RAISE EXCEPTION 'The publication stays as it was.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_templates_guard BEFORE INSERT OR UPDATE ON erp_private.import_templates FOR EACH ROW EXECUTE FUNCTION erp_private.import_templates_guard();
-- Which version was in force when a file was loaded. Empty means no published template existed for that kind on the day.
ALTER TABLE erp_private.period_imports ADD COLUMN template_id uuid REFERENCES erp_private.import_templates;
CREATE INDEX period_imports_template_idx ON erp_private.period_imports(template_id) WHERE template_id IS NOT NULL;
ALTER TABLE erp_private.bank_total_batches ADD COLUMN template_id uuid REFERENCES erp_private.import_templates;
CREATE INDEX bank_total_batches_template_idx ON erp_private.bank_total_batches(template_id) WHERE template_id IS NOT NULL;
-- A colleague's name for display. staff_members is readable only for oneself and those one manages, so a plain join would drop rows written by someone else.
CREATE FUNCTION erp_private.staff_name(p_staff_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.full_name FROM erp_private.staff_members s WHERE s.staff_id=p_staff_id AND s.deleted_at IS NULL AND (erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN');
$$;
REVOKE ALL ON FUNCTION erp_private.staff_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.staff_name(uuid) TO erp_api;
