-- Build 2793: a client tax profile can list the excise rules that apply to the client (which products it deals in), each with
-- the client's registration or licence reference and the dates. Only the rule key is held: the product code, unit and rate come
-- from the dated rule. Nothing is calculated. A Verified profile is already immutable (tax_profile_guard), so the list is too.
ALTER TABLE erp_private.client_tax_profiles ADD COLUMN IF NOT EXISTS excise_products jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE erp_private.client_tax_profiles DROP CONSTRAINT IF EXISTS client_tax_profiles_excise_products_check;
ALTER TABLE erp_private.client_tax_profiles ADD CONSTRAINT client_tax_profiles_excise_products_check CHECK(jsonb_typeof(excise_products)='array' AND jsonb_array_length(excise_products)<=20);
