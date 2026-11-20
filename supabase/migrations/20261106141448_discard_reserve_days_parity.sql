-- A discarded summary never reserved coverage days (only Confirmed summaries do); keep the cleanup rule identical to the repository version.
CREATE OR REPLACE FUNCTION erp_private.reserve_import_days() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status IN ('Superseded','Discarded') THEN DELETE FROM erp_private.period_import_days WHERE import_id=NEW.import_id;
 ELSIF NEW.status='Confirmed' AND OLD.status<>'Confirmed' THEN
  INSERT INTO erp_private.period_import_days(client_id,kind,source_type,coverage_day,import_id,project_id)
  SELECT NEW.client_id,NEW.kind,NEW.source_type,d::date,NEW.import_id,NEW.project_id
  FROM pg_catalog.generate_series(NEW.starts_on::timestamp,NEW.ends_on::timestamp,'1 day'::interval) d;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.reserve_import_days() FROM PUBLIC,anon,authenticated;
