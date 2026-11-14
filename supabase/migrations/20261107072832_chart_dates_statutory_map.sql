-- Client chart: (1) effective-date rule uses "starts on or before and ends on or after" for the verified tax profile and obligations,
-- (2) statutory tags come from a table instead of a fixed list, so a new obligation needs data, not code.
-- No account is re-tagged here and no tax rate is stored.

CREATE TABLE erp_private.statutory_tag_obligations(
 map_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tag text NOT NULL CHECK(tag ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 obligation_code text NOT NULL CHECK(length(btrim(obligation_code))>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tag,obligation_code)
);
COMMENT ON TABLE erp_private.statutory_tag_obligations IS 'Which client tax obligations switch a statutory account tag on. A tag is only used by the chart once an active account carries it.';

INSERT INTO erp_private.statutory_tag_obligations(tag,obligation_code) VALUES
 ('VAT','VAT'),
 ('PAYE','PAYE'),('PAYE','NSSF'),('PAYE','SHIF'),('PAYE','Housing levy'),('PAYE','NITA'),
 ('TOT','TOT'),
 ('INSTALMENT','Instalment tax'),('INSTALMENT','Advance tax'),
 ('WHT','WHT'),('WHT','Withholding income tax credits received'),
 ('EXCISE','Excise duty'),
 ('NCA','NCA levy'),
 ('TOURISM','Tourism levy'),('TOURISM','Catering levy'),
 ('SEPT','SEPT');

ALTER TABLE erp_private.statutory_tag_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.statutory_tag_obligations FORCE ROW LEVEL SECURITY;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.statutory_tag_obligations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.statutory_tag_obligations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('map_id');
REVOKE ALL ON erp_private.statutory_tag_obligations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.statutory_tag_obligations TO erp_api;
CREATE POLICY statutory_map_read ON erp_private.statutory_tag_obligations FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY statutory_map_add ON erp_private.statutory_tag_obligations FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY statutory_map_edit ON erp_private.statutory_tag_obligations FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');

-- The fixed VAT/PAYE check on the catalogue becomes a check against the map.
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT account_catalog_statutory_tags_check;
CREATE FUNCTION erp_private.catalog_statutory_tags_valid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF cardinality(NEW.statutory_tags)>0 AND EXISTS(
   SELECT 1 FROM unnest(NEW.statutory_tags) g(t) WHERE NOT EXISTS(SELECT 1 FROM erp_private.statutory_tag_obligations m WHERE m.tag=g.t)) THEN
  RAISE EXCEPTION 'Unknown statutory tag. Add the tag and the obligation codes that switch it on to the statutory tag map first.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.catalog_statutory_tags_valid() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER account_catalog_statutory_tags BEFORE INSERT OR UPDATE OF statutory_tags ON erp_private.account_catalog FOR EACH ROW EXECUTE FUNCTION erp_private.catalog_statutory_tags_valid();

-- 'yes' / 'unconfirmed' / 'no' per tag in use. A profile or obligation counts only when it is in force ON the chart date
-- (starts on or before it and ends on or after it); one that starts later cannot shape an earlier chart.
CREATE OR REPLACE FUNCTION erp_private.client_statutory_status(p_client uuid,p_from date)
RETURNS TABLE(tag text,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE verified boolean;
BEGIN
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'This record is not available to your account.' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM erp_private.client_tax_profiles v WHERE v.client_id=p_client AND v.status='Verified' AND v.deleted_at IS NULL
   AND v.effective_from<=p_from AND v.effective_to>=p_from) INTO verified;
 RETURN QUERY
 SELECT m.tag,CASE
   WHEN EXISTS(SELECT 1 FROM erp_private.client_tax_obligations o JOIN erp_private.client_tax_profiles p USING(profile_id)
     WHERE o.client_id=p_client AND o.is_selected AND p.deleted_at IS NULL AND o.effective_from<=p_from AND o.effective_to>=p_from
       AND o.obligation_code=ANY(m.codes) AND o.applicable='YES') THEN 'yes'
   WHEN NOT verified OR EXISTS(SELECT 1 FROM erp_private.client_tax_obligations o JOIN erp_private.client_tax_profiles p USING(profile_id)
     WHERE o.client_id=p_client AND o.is_selected AND p.deleted_at IS NULL AND o.effective_from<=p_from AND o.effective_to>=p_from
       AND o.obligation_code=ANY(m.codes) AND o.applicable='TO_CONFIRM') THEN 'unconfirmed'
   ELSE 'no' END
 FROM (SELECT t.tag,array_agg(t.obligation_code) codes FROM erp_private.statutory_tag_obligations t
        WHERE EXISTS(SELECT 1 FROM erp_private.account_catalog a WHERE t.tag=ANY(a.statutory_tags)) GROUP BY t.tag) m
 ORDER BY m.tag;
END $$;
REVOKE ALL ON FUNCTION erp_private.client_statutory_status(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_statutory_status(uuid,date) TO erp_api;
