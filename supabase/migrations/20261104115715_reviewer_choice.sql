-- Reviewer choice (4 Nov 2026 UAT): the preparer may send a report or a client chart to a named Manager or Partner.
-- The named reviewer, or any Partner, decides it; it then appears in that person's "Waiting for my review" list on Home.
ALTER TABLE erp_private.ledger_report_reviews ADD COLUMN IF NOT EXISTS requested_reviewer_id uuid REFERENCES erp_private.staff_members;
ALTER TABLE erp_private.client_chart_versions ADD COLUMN IF NOT EXISTS requested_reviewer_id uuid REFERENCES erp_private.staff_members;
CREATE INDEX IF NOT EXISTS ledger_report_reviews_requested_idx ON erp_private.ledger_report_reviews(requested_reviewer_id) WHERE requested_reviewer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_chart_versions_requested_idx ON erp_private.client_chart_versions(requested_reviewer_id) WHERE requested_reviewer_id IS NOT NULL;

-- Active Managers and Partners (other than the caller) who work for a firm that serves the client. Staff rows are
-- otherwise private, so this returns names and roles only, and only for a client the caller may see.
CREATE OR REPLACE FUNCTION erp_private.review_candidates(p_client_id uuid) RETURNS TABLE(staff_id uuid,full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT DISTINCT s.staff_id,s.full_name,s.category_code FROM erp_private.staff_members s
 JOIN erp_private.staff_firm_access f ON f.staff_id=s.staff_id AND f.deleted_at IS NULL
 JOIN erp_private.client_firm_links l ON l.firm_id=f.firm_id AND l.client_id=p_client_id AND l.deleted_at IS NULL
 WHERE erp_private.client_allowed(p_client_id) AND s.deleted_at IS NULL AND s.access_status='Active'
   AND s.category_code IN('PARTNER','MANAGER') AND s.staff_id<>(erp_private.actor()).staff_id;
$$;
CREATE OR REPLACE FUNCTION erp_private.reviewer_label(p_staff_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.full_name FROM erp_private.staff_members s WHERE s.staff_id=p_staff_id AND s.category_code IN('PARTNER','MANAGER') AND s.deleted_at IS NULL AND (erp_private.actor()).staff_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION erp_private.review_candidates(uuid),erp_private.reviewer_label(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.review_candidates(uuid),erp_private.reviewer_label(uuid) TO erp_api;
