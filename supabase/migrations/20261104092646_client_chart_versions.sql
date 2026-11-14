-- Step 2 of the entity / industry chart of accounts design: an approved, dated chart per client.
-- A Manager or Partner proposes a version (core + entity layer + the client's industry packs +
-- extra accounts with reasons); a different Manager or Partner approves or returns it. Once a
-- version is approved, the server limits that client's account choices and postings to it from
-- its effective date. Versions are never edited or deleted; a change is a new version.
CREATE TABLE erp_private.client_chart_versions(
 version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 effective_from date NOT NULL,
 entity_type text NOT NULL CHECK(entity_type IN('Limited company','Partnership','Sole proprietor','Other legal entity')),
 packs text[] NOT NULL CHECK(cardinality(packs)>0 AND packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Other']::text[]),
 accounts text[] NOT NULL CHECK(cardinality(accounts)>0),
 extra_accounts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(extra_accounts)='array'),
 note text,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status='Draft' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>prepared_by AND length(btrim(coalesce(review_note,'')))>=10))
);
CREATE UNIQUE INDEX client_chart_one_draft ON erp_private.client_chart_versions(client_id) WHERE status='Draft';
CREATE INDEX client_chart_versions_client_idx ON erp_private.client_chart_versions(client_id,status,effective_from);
CREATE INDEX client_chart_versions_prepared_by_idx ON erp_private.client_chart_versions(prepared_by);
CREATE INDEX client_chart_versions_reviewed_by_idx ON erp_private.client_chart_versions(reviewed_by);

ALTER TABLE erp_private.client_chart_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_chart_versions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_chart_versions TO erp_api;
CREATE POLICY client_chart_versions_read ON erp_private.client_chart_versions FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id));
CREATE POLICY client_chart_versions_insert ON erp_private.client_chart_versions FOR INSERT TO erp_api
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY client_chart_versions_update ON erp_private.client_chart_versions FOR UPDATE TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'))
 WITH CHECK(erp_private.client_allowed(client_id));

CREATE OR REPLACE FUNCTION erp_private.client_chart_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF (NEW.client_id,NEW.effective_from,NEW.entity_type,NEW.packs,NEW.accounts,NEW.extra_accounts,NEW.note,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM (OLD.client_id,OLD.effective_from,OLD.entity_type,OLD.packs,OLD.accounts,OLD.extra_accounts,OLD.note,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'A client chart version cannot be edited; propose a new version' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'Draft' OR NEW.status NOT IN('Approved','Returned') THEN RAISE EXCEPTION 'Only a draft chart version can be approved or returned' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' AND (a.category_code NOT IN('PARTNER','MANAGER') OR a.staff_id=OLD.prepared_by OR NEW.reviewed_by IS DISTINCT FROM a.staff_id) THEN
  RAISE EXCEPTION 'A different Manager or Partner must review the client chart' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.client_chart_version_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_chart_version_guard() TO erp_api;
CREATE TRIGGER client_chart_version_guard BEFORE UPDATE ON erp_private.client_chart_versions FOR EACH ROW EXECUTE FUNCTION erp_private.client_chart_version_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_chart_versions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_chart_versions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('version_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_chart_versions FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
