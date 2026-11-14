-- FIRST PARTNER BOOTSTRAP: run ONCE on a brand-new production database, in the Supabase SQL editor.
--
-- What it does, in one statement (all or nothing):
--   1. Creates the firm record.
--   2. Creates the first Partner's staff record in "Pending setup" with access to the whole firm.
--   3. Issues one single-use setup link, valid 24 hours. Only its hash is stored.
-- The Partner then opens the link, chooses their own password, and signs in with the login ID below.
-- No password is stored or set here. From then on, the Partner creates every other account in the ERP (Staff area).
--
-- It REFUSES to run if any staff record already exists (the division by zero below is the refusal).
-- Replace ONLY the five values marked <<...>> in the "params" line, then run. Keep the quotes.
-- Copy the "setup_link" from the result immediately; it is shown once and cannot be recovered
-- (a new link can be issued from the ERP, or by running the re-issue statement in the runbook).

WITH params AS (
  SELECT
    '<<FIRM_CODE e.g. PCLA>>'::text            AS firm_code,       -- 2-16 capitals/digits
    '<<FIRM LEGAL NAME>>'::text                AS firm_name,
    '<<STAFF ID e.g. EP001>>'::text            AS staff_identifier,
    '<<login.id e.g. first.last>>'::text       AS login_id,        -- 3-80 chars: letters, digits . _ -
    '<<PARTNER FULL NAME>>'::text              AS full_name,
    '<<https://pcl.phamalarcon.com>>'::text    AS site_origin      -- no trailing slash
),
guard AS MATERIALIZED (
  SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM erp_private.staff_members) THEN 0 ELSE 1 END) AS ok
),
raw AS (
  SELECT encode(extensions.gen_random_bytes(32), 'hex') AS token
),
firm AS (
  INSERT INTO erp_private.firms (firm_code, legal_name)
  SELECT p.firm_code, p.firm_name FROM params p, guard WHERE guard.ok = 1
  RETURNING firm_id
),
staff AS (
  INSERT INTO erp_private.staff_members (staff_identifier, login_id, full_name, category_code, employment_type, branch_location, access_status)
  SELECT p.staff_identifier, p.login_id, p.full_name, 'PARTNER', 'Permanent', 'Nairobi', 'Pending setup' FROM params p, guard WHERE guard.ok = 1
  RETURNING staff_id
),
access AS (
  INSERT INTO erp_private.staff_firm_access (staff_id, firm_id, scope)
  SELECT staff.staff_id, firm.firm_id, 'Firm' FROM staff, firm
  RETURNING staff_id
),
tok AS (
  INSERT INTO erp_private.setup_tokens (token_hash, staff_id, issued_by, expires_at)
  SELECT encode(extensions.digest(raw.token, 'sha256'), 'hex'), staff.staff_id, NULL, now() + interval '24 hours' FROM raw, staff
  RETURNING staff_id, expires_at
)
SELECT p.site_origin || '/staff-pilot.html#setup=' || raw.token AS setup_link, tok.expires_at, p.login_id
FROM raw, tok, params p, access;
