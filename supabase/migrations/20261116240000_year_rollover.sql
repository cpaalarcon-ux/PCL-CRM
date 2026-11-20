-- Build 2835: year rollover and Continue Setup.
-- 1. client_year_rollovers: one record per client per new year. It does not change the prior year. It points at the Draft chart version and the Draft mappings it created
--    from the approved ones in force at the end of the prior year, so the usual approvals (a different Manager or Partner approves a chart; mappings are approved) still
--    apply. A Manager or Partner who did not start the rollover reviews it, and only after the source year is closed (or its year-end trial balance is recorded), because
--    the opening balances come from there. Reviewing does not post anything.
-- Duplicates are already refused by the database (one client per KRA PIN: client_pin_unique; one engagement set-up per client, service and dates; one accounting year per
-- client and end date). Continue Setup is the way to find the existing record first.
CREATE TABLE erp_private.client_year_rollovers(
 rollover_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 source_period_id uuid NOT NULL REFERENCES erp_private.ledger_periods ON DELETE RESTRICT,
 new_starts_on date NOT NULL,
 new_ends_on date NOT NULL CHECK(new_ends_on>new_starts_on),
 source_chart_version_id uuid NOT NULL REFERENCES erp_private.client_chart_versions ON DELETE RESTRICT,
 new_chart_version_id uuid NOT NULL REFERENCES erp_private.client_chart_versions ON DELETE RESTRICT,
 source_mapping_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
 new_mapping_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
 changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(changes)='array'),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Reviewed','Withdrawn')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_review boolean NOT NULL DEFAULT false,
 withdraw_reason text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(cardinality(source_mapping_ids)=cardinality(new_mapping_ids)),
 CHECK(status<>'Reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND char_length(btrim(coalesce(review_note,'')))>=10 AND (reviewed_by<>created_by OR sole_partner_review))),
 CHECK(status<>'Withdrawn' OR char_length(btrim(coalesce(withdraw_reason,'')))>=10)
);
CREATE UNIQUE INDEX client_year_rollover_live ON erp_private.client_year_rollovers(client_id,new_starts_on) WHERE status<>'Withdrawn';
CREATE INDEX client_year_rollover_source_idx ON erp_private.client_year_rollovers(source_period_id);
CREATE INDEX client_year_rollover_chart_src_idx ON erp_private.client_year_rollovers(source_chart_version_id);
CREATE INDEX client_year_rollover_chart_new_idx ON erp_private.client_year_rollovers(new_chart_version_id);
CREATE INDEX client_year_rollover_by_idx ON erp_private.client_year_rollovers(created_by);
CREATE INDEX client_year_rollover_rev_idx ON erp_private.client_year_rollovers(reviewed_by) WHERE reviewed_by IS NOT NULL;
ALTER TABLE erp_private.client_year_rollovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_year_rollovers FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.client_year_rollovers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_year_rollovers TO erp_api;
CREATE POLICY client_year_rollovers_read ON erp_private.client_year_rollovers FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY client_year_rollovers_insert ON erp_private.client_year_rollovers FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY client_year_rollovers_update ON erp_private.client_year_rollovers FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_year_rollovers FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_year_rollovers FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('rollover_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_year_rollovers FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.client_year_rollover_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE src erp_private.ledger_periods; ch erp_private.client_chart_versions; a erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO src FROM erp_private.ledger_periods WHERE period_id=NEW.source_period_id;
  IF src.period_id IS NULL OR src.client_id<>NEW.client_id THEN RAISE EXCEPTION 'The source year belongs to another client.' USING ERRCODE='23514'; END IF;
  IF NEW.new_starts_on<>src.ends_on+1 THEN RAISE EXCEPTION 'The new year must start the day after the source year ends.' USING ERRCODE='23514'; END IF;
  SELECT * INTO ch FROM erp_private.client_chart_versions WHERE version_id=NEW.source_chart_version_id;
  IF ch.version_id IS NULL OR ch.client_id<>NEW.client_id OR ch.status<>'Approved' THEN RAISE EXCEPTION 'Roll forward from an approved chart version of this client.' USING ERRCODE='23514'; END IF;
  SELECT * INTO ch FROM erp_private.client_chart_versions WHERE version_id=NEW.new_chart_version_id;
  IF ch.version_id IS NULL OR ch.client_id<>NEW.client_id OR ch.status<>'Draft' OR ch.effective_from<>NEW.new_starts_on THEN RAISE EXCEPTION 'The new chart version must be a draft of this client starting with the new year.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.source_period_id,NEW.new_starts_on,NEW.new_ends_on,NEW.source_chart_version_id,NEW.new_chart_version_id,NEW.source_mapping_ids,NEW.new_mapping_ids,NEW.changes,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.client_id,OLD.source_period_id,OLD.new_starts_on,OLD.new_ends_on,OLD.source_chart_version_id,OLD.new_chart_version_id,OLD.source_mapping_ids,OLD.new_mapping_ids,OLD.changes,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A rollover record is never edited. Withdraw it and start again.' USING ERRCODE='23514'; END IF;
 IF OLD.status<>'Draft' THEN RAISE EXCEPTION 'This rollover is closed.' USING ERRCODE='23514'; END IF;
 a:=erp_private.actor();
 IF NEW.status='Reviewed' THEN
  IF NEW.reviewed_by IS DISTINCT FROM a.staff_id OR a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner reviews the rollover.' USING ERRCODE='42501'; END IF;
  IF a.staff_id=OLD.created_by AND NOT (NEW.sole_partner_review AND erp_private.sole_active_partner()) THEN RAISE EXCEPTION 'A different Manager or Partner reviews the rollover.' USING ERRCODE='42501'; END IF;
  SELECT * INTO src FROM erp_private.ledger_periods WHERE period_id=OLD.source_period_id;
  IF src.status<>'Closed' AND NOT EXISTS(SELECT 1 FROM erp_private.client_year_tbs t WHERE t.client_id=OLD.client_id AND t.tb_kind='Year-end' AND t.as_of=src.ends_on AND t.status='Current') THEN
   RAISE EXCEPTION 'Close the source year, or record its year-end trial balance, before reviewing: the opening balances come from it.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status<>'Withdrawn' THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_year_rollover_guard BEFORE INSERT OR UPDATE ON erp_private.client_year_rollovers FOR EACH ROW EXECUTE FUNCTION erp_private.client_year_rollover_guard();
REVOKE ALL ON FUNCTION erp_private.client_year_rollover_guard() FROM PUBLIC,anon,authenticated;
