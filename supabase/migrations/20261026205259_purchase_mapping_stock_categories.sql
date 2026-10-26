-- Client-owned choices for the purchase mapping dropdown. Existing mappings remain intact.
CREATE TABLE erp_private.stock_categories (
 category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 activity_id uuid REFERENCES erp_private.client_activities,
 inventory_use text NOT NULL CHECK(inventory_use IN ('Goods for resale','Construction raw materials','Other inventory')),
 stock_class text NOT NULL CHECK(length(btrim(stock_class)) BETWEEN 1 AND 100 AND stock_class=btrim(stock_class)),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_categories_choice_idx ON erp_private.stock_categories(client_id,coalesce(activity_id,'00000000-0000-0000-0000-000000000000'::uuid),inventory_use,lower(stock_class));
CREATE INDEX stock_categories_activity_idx ON erp_private.stock_categories(activity_id);
CREATE INDEX stock_categories_creator_idx ON erp_private.stock_categories(created_by);
ALTER TABLE erp_private.stock_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.stock_categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.stock_categories FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON erp_private.stock_categories TO erp_api;
CREATE POLICY scoped_read ON erp_private.stock_categories FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id) AND (select (erp_private.actor()).category_code)<>'INTERN');
CREATE POLICY scoped_insert ON erp_private.stock_categories FOR INSERT TO erp_api
 WITH CHECK(erp_private.client_allowed(client_id) AND (select erp_private.is_leader())
  AND created_by=(select (erp_private.actor()).staff_id)
  AND (activity_id IS NULL OR EXISTS(SELECT 1 FROM erp_private.client_activities a WHERE a.activity_id=stock_categories.activity_id AND a.client_id=stock_categories.client_id)));
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.stock_categories FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER audit AFTER INSERT ON erp_private.stock_categories FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('category_id');
