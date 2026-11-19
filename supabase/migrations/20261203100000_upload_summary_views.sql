-- Build 2901: the preparer-must-view-summary gate. Each time a staff member opens "Summary of this upload" the view is recorded: who, when, and a fingerprint of what the summary showed (rows and net by group).
-- Sending a tax case for review (tax_submit) is refused until the case's preparer has a recorded view of the current summary. If the upload changes later, the fingerprint changes and the summary must be opened again.
-- Insert-only: a view is never edited or deleted. It maps, approves and posts nothing.
CREATE TABLE erp_private.upload_summary_views(
 view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 viewed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 viewed_at timestamptz NOT NULL DEFAULT now(),
 fingerprint text NOT NULL CHECK(char_length(fingerprint) BETWEEN 1 AND 4000),
 mapped_rows integer NOT NULL CHECK(mapped_rows>=0),
 draft_rows integer NOT NULL CHECK(draft_rows>=0)
);
CREATE INDEX upload_summary_views_lookup_idx ON erp_private.upload_summary_views(project_id,viewed_by,viewed_at DESC);
CREATE INDEX upload_summary_views_client_idx ON erp_private.upload_summary_views(client_id);
CREATE INDEX upload_summary_views_viewed_by_idx ON erp_private.upload_summary_views(viewed_by);
COMMENT ON TABLE erp_private.upload_summary_views IS 'Who opened the upload summary, when, and what it showed. The tax-case submit step requires the preparer to have a view of the current summary. Insert-only.';
ALTER TABLE erp_private.upload_summary_views ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.upload_summary_views FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.upload_summary_views FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.upload_summary_views TO erp_api;
CREATE POLICY upload_summary_views_read ON erp_private.upload_summary_views FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY upload_summary_views_add ON erp_private.upload_summary_views FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN' AND viewed_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.upload_summary_views FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT ON erp_private.upload_summary_views FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('view_id');
CREATE FUNCTION erp_private.upload_summary_views_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'A recorded view of the upload summary cannot be changed.' USING ERRCODE='23514'; END IF;
 IF NEW.client_id IS DISTINCT FROM (SELECT p.client_id FROM erp_private.projects p WHERE p.project_id=NEW.project_id) THEN RAISE EXCEPTION 'The view must belong to the same client as the project.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER upload_summary_views_guard BEFORE INSERT OR UPDATE ON erp_private.upload_summary_views FOR EACH ROW EXECUTE FUNCTION erp_private.upload_summary_views_guard();
