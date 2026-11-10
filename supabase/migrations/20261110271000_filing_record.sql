-- Filing record and acknowledgment gate (build 2026-11-10.2720), step 1 of the Partner's build order of 10 Nov 2026 17:46.
-- A tax case can become Filed only when a filing record exists for it: the actual iTax filing date and acknowledgment number, with the KRA acknowledgment PDF
-- attached as locked evidence, OR an exception approved by a Manager or Partner who did not prepare the return (reason of at least 10 characters). The record
-- is immutable once written, so it is the evidence for the closure step. Nothing is sent to KRA from here and no tax rate or rule is stored or invented.
-- Cases that were already Filed before this build get a "legacy" record (no iTax number was ever captured for them); only the migration can create one.

CREATE TABLE erp_private.tax_filings(
 filing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL UNIQUE REFERENCES erp_private.tax_cases,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 kind text NOT NULL,
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 filed_on date NOT NULL,
 itax_reference text,
 prn text,
 no_prn_reason text,
 acknowledgement_status text NOT NULL CHECK(acknowledgement_status IN('ACKNOWLEDGEMENT_RECEIVED','MANAGER_EXCEPTION')),
 acknowledgement_document_id uuid REFERENCES erp_private.documents,
 exception_reason text,
 exception_approved_by uuid REFERENCES erp_private.staff_members,
 exception_approved_at timestamptz,
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 legacy boolean NOT NULL DEFAULT false,
 CHECK(legacy OR acknowledgement_status<>'ACKNOWLEDGEMENT_RECEIVED' OR (acknowledgement_document_id IS NOT NULL AND length(btrim(COALESCE(itax_reference,'')))>=3)),
 CHECK(legacy OR acknowledgement_status<>'MANAGER_EXCEPTION' OR (length(btrim(COALESCE(exception_reason,'')))>=10 AND exception_approved_by IS NOT NULL AND exception_approved_at IS NOT NULL AND exception_approved_by<>prepared_by)),
 CHECK(legacy OR length(btrim(COALESCE(prn,'')))>0 OR length(btrim(COALESCE(no_prn_reason,'')))>=10)
);
CREATE INDEX tax_filings_project_idx ON erp_private.tax_filings(project_id);
CREATE INDEX tax_filings_client_idx ON erp_private.tax_filings(client_id,kind,starts_on);
CREATE INDEX tax_filings_prepared_idx ON erp_private.tax_filings(prepared_by);
CREATE INDEX tax_filings_recorded_idx ON erp_private.tax_filings(recorded_by);
CREATE INDEX tax_filings_exception_idx ON erp_private.tax_filings(exception_approved_by) WHERE exception_approved_by IS NOT NULL;
CREATE INDEX tax_filings_document_idx ON erp_private.tax_filings(acknowledgement_document_id) WHERE acknowledgement_document_id IS NOT NULL;

-- Historical Filed cases get a legacy record so the gate can be strict from now on.
INSERT INTO erp_private.tax_filings(case_id,project_id,client_id,kind,starts_on,ends_on,prepared_by,filed_on,prn,no_prn_reason,acknowledgement_status,acknowledgement_document_id,recorded_by,legacy)
SELECT c.case_id,c.project_id,p.client_id,c.kind,c.starts_on,c.ends_on,c.prepared_by,COALESCE(c.filing_date,c.ends_on),
 NULLIF(w.details->'filing'->>'prn',''),NULLIF(w.details->'filing'->>'no_prn_reason',''),'ACKNOWLEDGEMENT_RECEIVED',w.filing_document_id,COALESCE(c.reviewed_by,c.prepared_by),true
FROM erp_private.tax_cases c JOIN erp_private.projects p USING(project_id)
LEFT JOIN LATERAL (SELECT * FROM erp_private.task_procedures x WHERE x.case_id=c.case_id AND x.profile='Tax filing' ORDER BY x.created_at DESC NULLS LAST LIMIT 1) w ON true
WHERE c.status='Filed';

ALTER TABLE erp_private.tax_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.tax_filings FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.tax_filings TO erp_api;
CREATE POLICY tax_filings_read ON erp_private.tax_filings FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY tax_filings_insert ON erp_private.tax_filings FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND recorded_by=(erp_private.actor()).staff_id);

CREATE FUNCTION erp_private.tax_filing_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE c erp_private.tax_cases;v_actor uuid;v_cat text;d erp_private.documents;v_today date;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.case_id;
 IF NEW.legacy THEN
  IF v_actor IS NOT NULL THEN RAISE EXCEPTION 'Legacy filing records are created only by the migration' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF c.case_id IS NULL OR c.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'The filing must belong to this tax case and its engagement' USING ERRCODE='23514'; END IF;
 IF c.status<>'Locked' THEN RAISE EXCEPTION 'Only an independently reviewed, locked tax case can be recorded as filed' USING ERRCODE='23514'; END IF;
 NEW.client_id:=(SELECT client_id FROM erp_private.projects WHERE project_id=c.project_id);NEW.kind:=c.kind;NEW.starts_on:=c.starts_on;NEW.ends_on:=c.ends_on;NEW.prepared_by:=c.prepared_by;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 IF NEW.filed_on>v_today OR NEW.filed_on<c.ends_on THEN RAISE EXCEPTION 'Check the actual filing date against the return period' USING ERRCODE='23514'; END IF;
 IF NEW.acknowledgement_status='ACKNOWLEDGEMENT_RECEIVED' THEN
  SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.acknowledgement_document_id AND project_id=NEW.project_id AND deleted_at IS NULL;
  IF d.document_id IS NULL OR d.mime_type<>'application/pdf' THEN RAISE EXCEPTION 'Attach the KRA acknowledgment as PDF evidence for this engagement' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.acknowledgement_document_id IS NOT NULL THEN RAISE EXCEPTION 'An exception is recorded instead of an acknowledgment document' USING ERRCODE='23514'; END IF;
  IF v_cat NOT IN('PARTNER','MANAGER') OR NEW.exception_approved_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Only the signed-in Manager or Partner approving the exception can record it' USING ERRCODE='42501'; END IF;
  IF v_actor IN(c.prepared_by,c.reviewed_by) THEN RAISE EXCEPTION 'A Manager or Partner who did not prepare or review this return must approve the exception' USING ERRCODE='42501'; END IF;
  NEW.exception_approved_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_filing_guard BEFORE INSERT ON erp_private.tax_filings FOR EACH ROW EXECUTE FUNCTION erp_private.tax_filing_guard();
CREATE TRIGGER tax_filing_immutable BEFORE UPDATE OR DELETE ON erp_private.tax_filings FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER tax_filing_audit AFTER INSERT ON erp_private.tax_filings FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('filing_id');

-- An exception is unusual, so every Partner is told once.
CREATE FUNCTION erp_private.tax_filing_exception_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_name text;
BEGIN
 IF NEW.acknowledgement_status='MANAGER_EXCEPTION' AND NOT NEW.legacy THEN
  SELECT company_name INTO v_name FROM erp_private.clients WHERE client_id=NEW.client_id;
  PERFORM erp_private.alert_partners('filing-exception:'||NEW.filing_id,format('A %s return for %s (%s to %s) was recorded as filed on an approved exception, without the KRA acknowledgment. Please review the reason.',NEW.kind,COALESCE(v_name,'a client'),NEW.starts_on,NEW.ends_on));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_filing_exception_alert AFTER INSERT ON erp_private.tax_filings FOR EACH ROW EXECUTE FUNCTION erp_private.tax_filing_exception_alert();

-- The case can become Filed only with a matching filing record.
CREATE OR REPLACE FUNCTION erp_private.tax_filing_approval_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='Filed' AND OLD.status<>'Filed' THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.task_procedures w WHERE w.case_id=NEW.case_id AND w.profile='Tax filing' AND w.stage='Ready to file' AND w.approval_document_id IS NOT NULL AND w.details->'approval' IS NOT NULL) THEN RAISE EXCEPTION 'Written approval and filing evidence required through the task workspace' USING ERRCODE='23514';END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.tax_filings f WHERE f.case_id=NEW.case_id AND f.filed_on IS NOT DISTINCT FROM NEW.filing_date) THEN RAISE EXCEPTION 'A filing record with the iTax acknowledgment, or an approved exception, is required' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;$$;

-- The procedure guard is unchanged except that filing evidence is now the filing record (an acknowledgment or an approved exception).
CREATE OR REPLACE FUNCTION erp_private.task_procedure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t erp_private.tasks;c erp_private.tax_cases;d uuid;target_client uuid;
BEGIN
 SELECT * INTO t FROM erp_private.tasks WHERE task_id=NEW.task_id;
 IF t.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'Procedure project mismatch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.stage='Closed' THEN RAISE EXCEPTION 'Closed work is immutable; record a separate correction' USING ERRCODE='23514';END IF;
  IF (NEW.task_id,NEW.project_id) IS DISTINCT FROM (OLD.task_id,OLD.project_id) THEN RAISE EXCEPTION 'Procedure identity is fixed' USING ERRCODE='23514';END IF;
  IF OLD.stage NOT IN('Pending preparer','Pending client documents') AND (NEW.profile,NEW.case_id,NEW.reviewer_id,NEW.contact_id) IS DISTINCT FROM (OLD.profile,OLD.case_id,OLD.reviewer_id,OLD.contact_id) AND NEW.stage<>'Pending preparer' THEN RAISE EXCEPTION 'Return work before changing setup' USING ERRCODE='23514';END IF;
  IF OLD.approval_document_id IS NOT NULL AND OLD.details->'approval' IS NOT NULL AND (NEW.approval_document_id,NEW.details->'approval') IS DISTINCT FROM (OLD.approval_document_id,OLD.details->'approval') THEN RAISE EXCEPTION 'Written approval is immutable' USING ERRCODE='23514';END IF;
 END IF;
 IF t.template_key IN('monthly-vat','monthly-paye','monthly-tot') AND NEW.profile<>'Tax filing' THEN RAISE EXCEPTION 'Statutory filing gates cannot be disabled' USING ERRCODE='23514';END IF;
 IF NEW.case_id IS NOT NULL THEN
  SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.case_id;
  IF c.project_id IS DISTINCT FROM NEW.project_id OR NEW.profile<>'Tax filing' THEN RAISE EXCEPTION 'Tax case must match this filing project' USING ERRCODE='23514';END IF;
  IF t.template_key IN('monthly-vat','monthly-paye','monthly-tot') AND (c.starts_on IS DISTINCT FROM t.period_start OR c.ends_on IS DISTINCT FROM t.period_end OR lower(c.kind) IS DISTINCT FROM replace(t.template_key,'monthly-','')) THEN RAISE EXCEPTION 'Tax type and return period must match the generated filing task' USING ERRCODE='23514';END IF;
 END IF;
 SELECT client_id INTO target_client FROM erp_private.projects WHERE project_id=NEW.project_id;
 IF NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_contacts WHERE contact_id=NEW.contact_id AND client_id=target_client AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Use this client representative' USING ERRCODE='23514';END IF;
 FOREACH d IN ARRAY ARRAY[NEW.approval_document_id,NEW.filing_document_id,NEW.payment_document_id,NEW.deliverable_document_id] LOOP
  IF d IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=d AND project_id=NEW.project_id AND deleted_at IS NULL AND is_locked) THEN RAISE EXCEPTION 'Evidence must be locked within the same project' USING ERRCODE='23514';END IF;
 END LOOP;
 IF NEW.stage IN('Ready to file','Ready to deliver','Filed - pending payment') AND (NEW.approval_document_id IS NULL OR NEW.contact_id IS NULL OR NEW.details->'approval' IS NULL) THEN RAISE EXCEPTION 'Written client approval required' USING ERRCODE='23514';END IF;
 IF NEW.stage='Ready to file' AND (NEW.case_id IS NULL OR c.status<>'Locked') THEN RAISE EXCEPTION 'Reviewed locked tax case required' USING ERRCODE='23514';END IF;
 IF NEW.stage='Filed - pending payment' AND (c.status IS DISTINCT FROM 'Filed' OR NOT EXISTS(SELECT 1 FROM erp_private.tax_filings f WHERE f.case_id=NEW.case_id)) THEN RAISE EXCEPTION 'Filing and acknowledgment required' USING ERRCODE='23514';END IF;
 IF NEW.stage='Closed' AND NEW.profile<>'Supporting task' AND (NEW.closed_by IS NULL OR NEW.closed_at IS NULL OR (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') OR NEW.closed_by=NEW.prepared_by) THEN RAISE EXCEPTION 'Independent Manager closure required' USING ERRCODE='42501';END IF;
 IF NEW.stage='Closed' AND NEW.profile='Tax filing' AND (NOT EXISTS(SELECT 1 FROM erp_private.tax_filings f WHERE f.case_id=NEW.case_id) OR c.status IS DISTINCT FROM 'Filed' OR (NEW.payment_document_id IS NULL AND coalesce(NEW.details->>'payment_outcome','')<>'Not payable')) THEN RAISE EXCEPTION 'Verify filing and payment or a documented nil liability' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;

REVOKE ALL ON FUNCTION erp_private.tax_filing_guard(),erp_private.tax_filing_exception_alert() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_filing_guard() TO erp_api;
REVOKE ALL ON FUNCTION erp_private.tax_filing_exception_alert() FROM erp_api;
