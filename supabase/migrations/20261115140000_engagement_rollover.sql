-- Build 2811: an engagement set-up can be rolled forward to the next period.
-- A rolled set-up remembers the set-up it came from and the open items it carried (facts only: what the item was and why it was stuck; never a status or a completion).
-- The database now also refuses two set-ups of the same service for the same client whose periods overlap, so no task can be made twice for the same time.
ALTER TABLE erp_private.engagement_setups ADD COLUMN rolled_from uuid REFERENCES erp_private.engagement_setups ON DELETE RESTRICT;
ALTER TABLE erp_private.engagement_setups ADD COLUMN carried jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE erp_private.engagement_setups ADD CONSTRAINT engagement_setups_carried_check CHECK(jsonb_typeof(carried)='array' AND jsonb_array_length(carried)<=50);
CREATE INDEX engagement_setups_rolled_from_idx ON erp_private.engagement_setups(rolled_from) WHERE rolled_from IS NOT NULL;
CREATE UNIQUE INDEX engagement_setups_one_roll_uidx ON erp_private.engagement_setups(rolled_from) WHERE rolled_from IS NOT NULL;

CREATE OR REPLACE FUNCTION erp_private.engagement_setups_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $g$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Waiting' THEN RAISE EXCEPTION 'A set-up starts as waiting and is released separately.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.service_templates t WHERE t.template_id=NEW.template_id AND t.status='Approved') THEN RAISE EXCEPTION 'Only an approved service template can be used.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.service_template_services s WHERE s.template_id=NEW.template_id AND s.service_code=NEW.service_code) THEN RAISE EXCEPTION 'This template is not for that service.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id AND p.service_code=NEW.service_code) THEN RAISE EXCEPTION 'The project must be this client''s project for that service.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.engagement_setups o WHERE o.client_id=NEW.client_id AND o.service_code=NEW.service_code AND o.period_start<=NEW.period_end AND o.period_end>=NEW.period_start) THEN
   RAISE EXCEPTION 'This service is already set up for part of that period.' USING ERRCODE='23514';
  END IF;
  IF NEW.rolled_from IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.engagement_setups o WHERE o.setup_id=NEW.rolled_from AND o.client_id=NEW.client_id AND o.service_code=NEW.service_code AND o.status='Released' AND o.period_end<NEW.period_start) THEN
   RAISE EXCEPTION 'A roll-forward follows a released set-up of the same client and service.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.project_id,NEW.template_id,NEW.service_code,NEW.period_start,NEW.period_end,NEW.scope,NEW.responsible_staff,NEW.reviewer_staff,NEW.client_template_code,NEW.exclusions,NEW.applied_by,NEW.applied_at,NEW.rolled_from,NEW.carried)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.template_id,OLD.service_code,OLD.period_start,OLD.period_end,OLD.scope,OLD.responsible_staff,OLD.reviewer_staff,OLD.client_template_code,OLD.exclusions,OLD.applied_by,OLD.applied_at,OLD.rolled_from,OLD.carried) THEN
  RAISE EXCEPTION 'An engagement set-up is not edited.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Released' THEN RAISE EXCEPTION 'A released set-up stays as it was.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'Released' THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $g$;
