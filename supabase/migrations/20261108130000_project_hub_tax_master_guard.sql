-- Keep one non-deleted tax compilation master per client and handling firm.
-- Resolve any existing duplicate masters deliberately before applying this migration.
DO $$
DECLARE
  duplicate_master record;
BEGIN
  SELECT client_id, handling_firm_id, count(*) AS project_count
    INTO duplicate_master
  FROM erp_private.projects
  WHERE tax_master IS TRUE
    AND deleted_at IS NULL
  GROUP BY client_id, handling_firm_id
  HAVING count(*) > 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot enforce one tax master project per client and firm: client %, firm %, non-deleted projects %. Review and resolve these projects before retrying.',
      duplicate_master.client_id,
      duplicate_master.handling_firm_id,
      duplicate_master.project_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS projects_one_tax_master_per_client_firm_uq
  ON erp_private.projects (client_id, handling_firm_id)
  WHERE tax_master IS TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_active_firm_hub_cursor_idx
  ON erp_private.projects (handling_firm_id, created_at DESC, project_id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_active_hub_cursor_idx
  ON erp_private.projects (created_at DESC, project_id DESC)
  WHERE deleted_at IS NULL;
