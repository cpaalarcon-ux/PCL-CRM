-- Build 2861: measurement register. The report of how long set-ups take (client set-up from the first fact to ready; service set-up from applied to released)
-- now keeps the firm's baseline: how long the same job took the old way, and the reduction the firm is aiming for. A Partner records it with the source of the figure.
-- A baseline is never edited. A new one ends the old with a reason, so every past report can be read against the figure that was in force.
CREATE TABLE erp_private.setup_baselines(
 baseline_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 measure text NOT NULL CHECK(measure IN('Client set-up','Service set-up')),
 baseline_minutes integer NOT NULL CHECK(baseline_minutes BETWEEN 1 AND 100000),
 target_reduction_percent integer NOT NULL DEFAULT 90 CHECK(target_reduction_percent BETWEEN 1 AND 99),
 source text NOT NULL CHECK(char_length(btrim(source)) BETWEEN 5 AND 500),
 effective_from date NOT NULL DEFAULT current_date,
 set_by uuid NOT NULL REFERENCES erp_private.staff_members,set_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 CHECK((ended_by IS NULL)=(ended_at IS NULL) AND (ended_at IS NULL)=(ended_reason IS NULL))
);
CREATE UNIQUE INDEX setup_baselines_live_uidx ON erp_private.setup_baselines(measure) WHERE ended_at IS NULL;
CREATE INDEX setup_baselines_set_by_idx ON erp_private.setup_baselines(set_by);
CREATE INDEX setup_baselines_ended_by_idx ON erp_private.setup_baselines(ended_by) WHERE ended_by IS NOT NULL;
CREATE FUNCTION erp_private.setup_baselines_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended baseline is history and cannot change.' USING ERRCODE='23514'; END IF;
  IF (NEW.baseline_id,NEW.measure,NEW.baseline_minutes,NEW.target_reduction_percent,NEW.source,NEW.effective_from,NEW.set_by,NEW.set_at) IS DISTINCT FROM (OLD.baseline_id,OLD.measure,OLD.baseline_minutes,OLD.target_reduction_percent,OLD.source,OLD.effective_from,OLD.set_by,OLD.set_at)
   THEN RAISE EXCEPTION 'A baseline is not edited. End it with a reason and record a new one.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER setup_baselines_guard BEFORE INSERT OR UPDATE ON erp_private.setup_baselines FOR EACH ROW EXECUTE FUNCTION erp_private.setup_baselines_guard();
ALTER TABLE erp_private.setup_baselines ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.setup_baselines FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.setup_baselines TO erp_api;
CREATE POLICY setup_baselines_read ON erp_private.setup_baselines FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR'));
CREATE POLICY setup_baselines_insert ON erp_private.setup_baselines FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND set_by=(erp_private.actor()).staff_id);
CREATE POLICY setup_baselines_update ON erp_private.setup_baselines FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.setup_baselines FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.setup_baselines FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('baseline_id');
