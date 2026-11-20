-- Amendments linked to the locked original (build 2026-11-10.2720), step 2 of the Partner's build order of 10 Nov 2026 17:46.
-- A filed return is never edited. A correction is a NEW tax case for the same client, obligation and period, numbered 1, 2, 3 ... and linked to the case it
-- amends (amends_case_id), with a written reason. This resolves the "one return per period" collision: the unique key and the return identity now include the
-- amendment number, while the original (number 0) still reserves the period exactly as before. An amendment can only be started from a FILED case that has no
-- newer amendment, and only one amendment can be open at a time. It goes through the same review, client approval and filing-record gates as any return.
-- No tax rate or rule is stored or invented here.

ALTER TABLE erp_private.tax_cases
 ADD COLUMN amendment_no integer NOT NULL DEFAULT 0 CHECK(amendment_no>=0),
 ADD COLUMN amends_case_id uuid REFERENCES erp_private.tax_cases,
 ADD COLUMN amendment_reason text,
 ADD CONSTRAINT tax_cases_amendment_shape CHECK(
  (amendment_no=0 AND amends_case_id IS NULL AND amendment_reason IS NULL)
  OR (amendment_no>0 AND amends_case_id IS NOT NULL AND length(btrim(COALESCE(amendment_reason,'')))>=10));
CREATE INDEX tax_cases_amends_idx ON erp_private.tax_cases(amends_case_id) WHERE amends_case_id IS NOT NULL;

ALTER TABLE erp_private.tax_cases DROP CONSTRAINT tax_cases_project_id_kind_starts_on_ends_on_key;
ALTER TABLE erp_private.tax_cases ADD CONSTRAINT tax_cases_period_amendment_key UNIQUE(project_id,kind,starts_on,ends_on,amendment_no);

ALTER TABLE erp_private.tax_return_identities ADD COLUMN amendment_no integer NOT NULL DEFAULT 0;
ALTER TABLE erp_private.tax_return_identities DROP CONSTRAINT tax_return_identities_pkey;
ALTER TABLE erp_private.tax_return_identities ADD PRIMARY KEY(client_id,kind,starts_on,ends_on,amendment_no);

CREATE OR REPLACE FUNCTION erp_private.return_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE cid uuid;prior erp_private.tax_cases;
BEGIN
 SELECT client_id INTO cid FROM erp_private.projects WHERE project_id=NEW.project_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text||':'||NEW.kind,0));
 IF NEW.amendment_no=0 THEN
  IF EXISTS(SELECT 1 FROM erp_private.tax_return_identities WHERE client_id=cid AND kind=NEW.kind AND amendment_no=0 AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on) THEN RAISE EXCEPTION 'A return identity already overlaps for this client, obligation and period; use the responsible engagement' USING ERRCODE='23505';END IF;
 ELSE
  SELECT * INTO prior FROM erp_private.tax_cases WHERE case_id=NEW.amends_case_id;
  IF prior.case_id IS NULL OR prior.project_id<>NEW.project_id OR prior.kind<>NEW.kind OR prior.starts_on<>NEW.starts_on OR prior.ends_on<>NEW.ends_on THEN RAISE EXCEPTION 'An amendment must be for the same client, obligation and period as the return it amends' USING ERRCODE='23514';END IF;
  IF prior.status<>'Filed' THEN RAISE EXCEPTION 'Only a filed return can be amended' USING ERRCODE='23514';END IF;
  IF NEW.amendment_no<>prior.amendment_no+1 THEN RAISE EXCEPTION 'Amend the latest filed version of this return' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM erp_private.tax_cases o WHERE o.project_id=NEW.project_id AND o.kind=NEW.kind AND o.starts_on=NEW.starts_on AND o.ends_on=NEW.ends_on AND o.case_id<>NEW.case_id AND o.status<>'Filed') THEN RAISE EXCEPTION 'This return already has an amendment in progress' USING ERRCODE='23505';END IF;
 END IF;
 INSERT INTO erp_private.tax_return_identities(client_id,kind,starts_on,ends_on,amendment_no,case_id,project_id) VALUES(cid,NEW.kind,NEW.starts_on,NEW.ends_on,NEW.amendment_no,NEW.case_id,NEW.project_id);
 RETURN NEW;
END;$$;

-- Which version a case is, and what it amends, can never change after the case exists.
CREATE FUNCTION erp_private.amendment_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (NEW.amendment_no,NEW.amends_case_id,NEW.amendment_reason) IS DISTINCT FROM (OLD.amendment_no,OLD.amends_case_id,OLD.amendment_reason) THEN RAISE EXCEPTION 'The amendment number, the case it amends and the reason cannot change' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER zz_amendment_identity BEFORE UPDATE ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.amendment_identity_guard();
REVOKE ALL ON FUNCTION erp_private.amendment_identity_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.amendment_identity_guard() TO erp_api;
