-- Build 2830: versioned statutory export profiles (Settings, Templates and Statutory Rules).
-- A profile says how one authority's monthly return file is produced: authority, return, period, template version, layout, rounding rule, accepted ID types,
-- how the employer housing levy is shown, and the dates it applies. The ledger and the payroll summary keep exact values; a profile only decides how a file is FORMATTED
-- when it is created, so a later template or rule change never alters an old payroll run: a month always uses the profile in force on its last day.
-- A profile is a Draft until a different Manager or Partner publishes it and records what it was checked against and when. A published profile is never edited; it is
-- ended on a date (a newer version starts the next day) or retired. Starter profiles are seeded as Drafts: nothing is released until a person confirms them.
CREATE TABLE erp_private.statutory_export_profiles(
 profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 return_code text NOT NULL CHECK(return_code IN('NSSF','SHIF','PAYE_P10')),
 authority text NOT NULL CHECK(authority IN('NSSF','SHA','KRA')),
 period_kind text NOT NULL DEFAULT 'Monthly' CHECK(period_kind='Monthly'),
 version integer NOT NULL CHECK(version>=1),
 layout_code text NOT NULL CHECK(layout_code IN('NSSF_MONTHLY_7COL_V1','SHA_SHIF_9COL_V1','KRA_P10_SIMPLIFIED_V30_0_3_SECTION_B')),
 template_version text NOT NULL CHECK(char_length(btrim(template_version)) BETWEEN 1 AND 80),
 rounding_rule text NOT NULL DEFAULT 'EXACT_2DP' CHECK(rounding_rule IN('EXACT_2DP','ROUND_UP_WHOLE')),
 rounded_columns text[] NOT NULL DEFAULT '{}',
 accepted_id_types text[] NOT NULL DEFAULT '{}' CHECK(accepted_id_types<@ ARRAY['National ID','Passport','Alien ID']),
 employer_housing_levy text NOT NULL DEFAULT 'NOT_DECLARED' CHECK(employer_housing_levy IN('SEPARATE_SHEET','NOT_DECLARED')),
 notes text CHECK(notes IS NULL OR char_length(notes)<=2000),
 effective_from date NOT NULL,
 effective_to date,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Published','Retired')),
 provenance text NOT NULL DEFAULT 'Staff' CHECK(provenance IN('Starter','Staff')),
 verified_against text CHECK(verified_against IS NULL OR char_length(btrim(verified_against)) BETWEEN 5 AND 400),
 verified_on date,
 created_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 published_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 published_at timestamptz,
 sole_partner_publish boolean NOT NULL DEFAULT false,
 ended_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 retired_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 retired_at timestamptz,
 retired_reason text CHECK(retired_reason IS NULL OR char_length(btrim(retired_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(return_code,version),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(rounding_rule='ROUND_UP_WHOLE' OR rounded_columns='{}'),
 CHECK(rounding_rule<>'ROUND_UP_WHOLE' OR cardinality(rounded_columns)>0),
 CHECK(return_code<>'PAYE_P10' OR authority='KRA'),CHECK(return_code<>'NSSF' OR authority='NSSF'),CHECK(return_code<>'SHIF' OR authority='SHA'),
 CHECK(return_code='PAYE_P10' OR employer_housing_levy='NOT_DECLARED'),
 CHECK(return_code='SHIF' OR accepted_id_types='{}'),
 CHECK(return_code<>'SHIF' OR cardinality(accepted_id_types)>0),
 CHECK(status<>'Published' OR (published_by IS NOT NULL AND published_at IS NOT NULL AND verified_against IS NOT NULL AND verified_on IS NOT NULL)),
 CHECK(status<>'Retired' OR (retired_at IS NOT NULL AND retired_reason IS NOT NULL)),
 CHECK(published_by IS NULL OR created_by IS NULL OR published_by<>created_by OR sole_partner_publish)
);
CREATE INDEX statutory_export_profiles_return_idx ON erp_private.statutory_export_profiles(return_code,status,effective_from);
CREATE INDEX statutory_export_profiles_created_idx ON erp_private.statutory_export_profiles(created_by);
CREATE INDEX statutory_export_profiles_published_idx ON erp_private.statutory_export_profiles(published_by);
CREATE INDEX statutory_export_profiles_ended_idx ON erp_private.statutory_export_profiles(ended_by);
CREATE INDEX statutory_export_profiles_retired_idx ON erp_private.statutory_export_profiles(retired_by);
ALTER TABLE erp_private.statutory_export_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.statutory_export_profiles FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.statutory_export_profiles TO erp_api;
CREATE POLICY sep_read ON erp_private.statutory_export_profiles FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND (status<>'Draft' OR (erp_private.actor()).category_code IN('PARTNER','MANAGER')));
CREATE POLICY sep_insert ON erp_private.statutory_export_profiles FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY sep_update ON erp_private.statutory_export_profiles FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.statutory_export_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.statutory_export_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('profile_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.statutory_export_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.statutory_export_profiles_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text; api boolean:=current_user='erp_api';
BEGIN
 IF api THEN me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' THEN RAISE EXCEPTION 'Save a draft; a different Manager or Partner publishes it.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_publish OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'A new profile is not published yet.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.statutory_export_profiles WHERE return_code=NEW.return_code),0)+1 THEN RAISE EXCEPTION 'Versions are numbered in order.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.return_code,NEW.authority,NEW.period_kind,NEW.version,NEW.created_by,NEW.created_at,NEW.provenance) IS DISTINCT FROM ROW(OLD.return_code,OLD.authority,OLD.period_kind,OLD.version,OLD.created_by,OLD.created_at,OLD.provenance) THEN
  RAISE EXCEPTION 'The return, its version and its author never change.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Retired' THEN RAISE EXCEPTION 'A retired profile stays as it was.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Draft' THEN
  IF api AND OLD.created_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Only the person who drafted a profile revises it. A starter profile is revised by saving a new version.' USING ERRCODE='42501'; END IF;
  IF ROW(NEW.published_by,NEW.published_at,NEW.sole_partner_publish,NEW.ended_by,NEW.ended_at,NEW.ended_reason,NEW.retired_by,NEW.retired_at,NEW.retired_reason) IS DISTINCT FROM ROW(OLD.published_by,OLD.published_at,OLD.sole_partner_publish,OLD.ended_by,OLD.ended_at,OLD.ended_reason,OLD.retired_by,OLD.retired_at,OLD.retired_reason) THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Draft' AND NEW.status='Published' THEN
  IF api THEN
   IF cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner publishes a profile.' USING ERRCODE='42501'; END IF;
   IF NEW.published_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Publishing is recorded under your own name.' USING ERRCODE='42501'; END IF;
   IF OLD.created_by IS NOT DISTINCT FROM me THEN
    IF cat<>'PARTNER' OR NOT erp_private.sole_active_partner() OR NOT NEW.sole_partner_publish THEN RAISE EXCEPTION 'A different Manager or Partner publishes a profile you drafted, unless you are your firm''s only Partner.' USING ERRCODE='42501'; END IF;
   ELSIF NEW.sole_partner_publish THEN RAISE EXCEPTION 'That flag is set only when a sole Partner publishes their own draft.' USING ERRCODE='23514';
   END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM erp_private.statutory_export_profiles o WHERE o.return_code=NEW.return_code AND o.profile_id<>NEW.profile_id AND o.status='Published'
     AND daterange(o.effective_from,coalesce(o.effective_to,'infinity'::date),'[]') && daterange(NEW.effective_from,coalesce(NEW.effective_to,'infinity'::date),'[]')) THEN
   RAISE EXCEPTION 'Another published version of this return covers some of those dates. End it the day before this one starts, then publish.' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.template_version,NEW.layout_code,NEW.rounding_rule,NEW.rounded_columns,NEW.accepted_id_types,NEW.employer_housing_levy,NEW.notes,NEW.effective_from,NEW.effective_to)
     IS DISTINCT FROM ROW(OLD.template_version,OLD.layout_code,OLD.rounding_rule,OLD.rounded_columns,OLD.accepted_id_types,OLD.employer_housing_levy,OLD.notes,OLD.effective_from,OLD.effective_to) THEN
   RAISE EXCEPTION 'Publishing does not change the profile. Save the changes in the draft first.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 -- From here the profile is published or being retired: its content is never edited.
 IF ROW(NEW.template_version,NEW.layout_code,NEW.rounding_rule,NEW.rounded_columns,NEW.accepted_id_types,NEW.employer_housing_levy,NEW.notes,NEW.effective_from,NEW.verified_against,NEW.verified_on,NEW.published_by,NEW.published_at,NEW.sole_partner_publish)
    IS DISTINCT FROM ROW(OLD.template_version,OLD.layout_code,OLD.rounding_rule,OLD.rounded_columns,OLD.accepted_id_types,OLD.employer_housing_levy,OLD.notes,OLD.effective_from,OLD.verified_against,OLD.verified_on,OLD.published_by,OLD.published_at,OLD.sole_partner_publish) THEN
  RAISE EXCEPTION 'A published profile is never edited. Save a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Published' AND NEW.status='Published' THEN
  -- The one change allowed: end it on a date, with a reason. It can be ended once and never extended.
  IF NEW.effective_to IS NOT DISTINCT FROM OLD.effective_to THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
  IF NEW.effective_to IS NULL OR (OLD.effective_to IS NOT NULL AND NEW.effective_to>=OLD.effective_to) THEN RAISE EXCEPTION 'A published profile can be ended earlier, never extended.' USING ERRCODE='23514'; END IF;
  IF NEW.effective_to<NEW.effective_from THEN RAISE EXCEPTION 'The end date cannot be before the first day.' USING ERRCODE='23514'; END IF;
  IF NEW.ended_reason IS NULL OR NEW.ended_by IS NULL OR NEW.ended_at IS NULL THEN RAISE EXCEPTION 'Say why it ends.' USING ERRCODE='23514'; END IF;
  IF api AND (cat NOT IN('PARTNER','MANAGER') OR NEW.ended_by IS DISTINCT FROM me) THEN RAISE EXCEPTION 'A Manager or Partner ends a profile, with a reason.' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='Retired' AND OLD.status IN('Draft','Published') THEN
  IF api AND (cat NOT IN('PARTNER','MANAGER') OR NEW.retired_by IS DISTINCT FROM me) THEN RAISE EXCEPTION 'A Manager or Partner retires a profile, with a reason.' USING ERRCODE='42501'; END IF;
  IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN RAISE EXCEPTION 'The dates stay as they were.' USING ERRCODE='23514'; END IF;
  -- A published profile that already produced a file is ended, not retired: months it served stay explainable.
  IF OLD.status='Published' AND EXISTS(SELECT 1 FROM erp_private.statutory_file_exports x WHERE x.profile_id=OLD.profile_id) THEN RAISE EXCEPTION 'This profile produced files. End it on a date instead of retiring it.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER statutory_export_profiles_guard BEFORE INSERT OR UPDATE ON erp_private.statutory_export_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.statutory_export_profiles_guard();
REVOKE ALL ON FUNCTION erp_private.statutory_export_profiles_guard() FROM PUBLIC,anon,authenticated;

-- Which profile produced each released file, and what rounding it applied (exact amount, rounded amount, difference), so the file always reconciles to the ledger.
ALTER TABLE erp_private.statutory_file_exports ADD COLUMN profile_id uuid REFERENCES erp_private.statutory_export_profiles ON DELETE RESTRICT,
 ADD COLUMN profile_version integer,
 ADD COLUMN rounding jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX statutory_file_exports_profile_idx ON erp_private.statutory_file_exports(profile_id) WHERE profile_id IS NOT NULL;
CREATE OR REPLACE FUNCTION erp_private.statutory_exports_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id) THEN RAISE EXCEPTION 'The project does not belong to this client.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.period_imports i WHERE i.import_id=NEW.import_id AND i.client_id=NEW.client_id AND i.kind='Payroll' AND i.status='Confirmed') THEN RAISE EXCEPTION 'A statutory file is released only from a confirmed payroll summary of this client.' USING ERRCODE='23514'; END IF;
 IF NEW.journal_id IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.ledger_journals j WHERE j.journal_id=NEW.journal_id AND j.project_id=NEW.project_id AND j.status='Posted') THEN RAISE EXCEPTION 'A statutory file is released only against a posted payroll journal.' USING ERRCODE='23514'; END IF;
 IF NEW.profile_id IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.statutory_export_profiles s WHERE s.profile_id=NEW.profile_id AND s.return_code=NEW.file_kind AND s.layout_code=NEW.layout_code AND s.version=NEW.profile_version AND s.status='Published' AND s.effective_from<=(NEW.month+interval '1 month' - interval '1 day')::date AND (s.effective_to IS NULL OR s.effective_to>=(NEW.month+interval '1 month' - interval '1 day')::date)) THEN
  RAISE EXCEPTION 'A statutory file is released only under a published export profile in force for that month.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Starter profiles, as Drafts. They record what the owner decided on 15 Nov 2026 and what still has to be confirmed before release; none is published by this migration.
INSERT INTO erp_private.statutory_export_profiles(return_code,authority,version,layout_code,template_version,rounding_rule,rounded_columns,accepted_id_types,employer_housing_levy,notes,effective_from,provenance)
VALUES
('NSSF','NSSF',1,'NSSF_MONTHLY_7COL_V1','NSSF return, 7 columns (sample supplied 15 Nov 2026)','ROUND_UP_WHOLE',ARRAY['GROSS PAY'],'{}','NOT_DECLARED','Owner decision 15 Nov 2026: keep exact amounts internally and round up to the nearest shilling only in this export; the rounding difference is stored. Check against the current downloadable NSSF return specification (contribution rates changed for Year 4 from February 2026) before publishing.','2026-01-01','Starter'),
('SHIF','SHA',1,'SHA_SHIF_9COL_V1','SHA employer upload, 9 columns (sample supplied 15 Nov 2026)','EXACT_2DP','{}',ARRAY['National ID','Passport','Alien ID'],'NOT_DECLARED','Owner decision 15 Nov 2026: two decimals until the SHA employer upload confirms otherwise. National ID, Passport and Alien ID are accepted; check the accepted identifiers against the SHA employer upload before publishing.','2026-01-01','Starter'),
('PAYE_P10','KRA',1,'KRA_P10_SIMPLIFIED_V30_0_3_SECTION_B','KRA P10 simplified v30.0.3 (sample supplied 15 Nov 2026)','EXACT_2DP','{}','{}','SEPARATE_SHEET','Owner decision 15 Nov 2026: Section E item 7 stays the employee housing levy only; the employer share is shown separately with the employee share and the total (Sheet M). Confirm the Sheet M layout against KRA''s current housing levy guidance before publishing.','2026-01-01','Starter');
