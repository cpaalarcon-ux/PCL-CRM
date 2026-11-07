-- Security and performance clean-up (review item 5).
-- 1. Server-only tables: these hold sessions, setup tokens, rate limits and internal import keys. Only the
--    server (database owner) uses them; API roles have no grants. Record that intent as explicit deny
--    policies so the security advisor no longer reports "RLS enabled, no policy". No behaviour change.
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['auth_limits','import_batches','import_row_keys','pilot_sessions','setup_tokens','staff_capabilities','workspace_features'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='erp_private' AND tablename=t AND policyname='server_only_no_api_access') THEN
   EXECUTE format('CREATE POLICY server_only_no_api_access ON erp_private.%I AS RESTRICTIVE FOR ALL TO anon, authenticated, erp_api USING (false) WITH CHECK (false)',t);
  END IF;
 END LOOP;
END$$;

-- 2. Index every foreign key in erp_private that has no leading index, so joins and cascading
--    checks on staff, document and project references do not scan whole tables.
DO $$DECLARE r record;BEGIN
 FOR r IN
  WITH fk AS (
   SELECT c.conrelid,c.conkey,t.relname
   FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE c.contype='f' AND n.nspname='erp_private'
  ),cols AS (
   SELECT fk.conrelid,fk.conkey,fk.relname,array_agg(a.attname ORDER BY k.ord) AS cols
   FROM fk CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY k(attnum,ord)
   JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k.attnum
   GROUP BY fk.conrelid,fk.conkey,fk.relname
  )
  SELECT DISTINCT format('CREATE INDEX IF NOT EXISTS %I ON erp_private.%I(%s)',
   left(relname||'_'||array_to_string(cols,'_')||'_fk_idx',63),relname,
   array_to_string(ARRAY(SELECT quote_ident(x) FROM unnest(cols) x),',')) AS ddl
  FROM cols
  WHERE NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=cols.conrelid AND (i.indkey::int2[])[0:array_length(cols.conkey,1)-1]=cols.conkey)
 LOOP EXECUTE r.ddl; END LOOP;
END$$;
