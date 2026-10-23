-- Connected testing release. Existing evidence and engagement activation gates remain intact.
CREATE TABLE erp_private.sectors (
 sector_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE CHECK(length(btrim(name)) BETWEEN 2 AND 100),
 parent_id uuid REFERENCES erp_private.sectors, system_default boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX sectors_parent_idx ON erp_private.sectors(parent_id);
CREATE UNIQUE INDEX sectors_name_ci ON erp_private.sectors(lower(name));
INSERT INTO erp_private.sectors(name,system_default) SELECT unnest(ARRAY['Agribusiness','Financial Services','Energy','Healthcare','NGO','Public Sector','SME/Startup','Legal','Education','Construction','Real Estate','Hospitality & Tourism','Manufacturing','Wholesale & Retail','Transport & Logistics','Information Technology','Telecommunications','Professional Services','Media & Creative Industries','Mining & Quarrying','Water & Waste Management','Personal Services']),true;
ALTER TABLE erp_private.clients DROP CONSTRAINT clients_primary_sector_check;
ALTER TABLE erp_private.clients ADD CONSTRAINT clients_sector_fk FOREIGN KEY(primary_sector) REFERENCES erp_private.sectors(name);
CREATE INDEX clients_sector_idx ON erp_private.clients(primary_sector);

