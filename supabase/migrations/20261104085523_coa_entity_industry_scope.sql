-- Step 1 of the entity / industry chart of accounts design (Partner design doc, 4 Nov 2026).
-- 1. Every catalog account carries the legal entity types and industry packs it applies to
--    (an empty list = applies to all). Nothing is filtered by these tags yet (Step 2).
-- 2. Retail becomes its own industry pack.
-- 3. Industry accounts missing from the master chart are added as Draft: a Partner activates
--    each one from the chart of accounts screen ("Approve account"). Draft accounts cannot be posted.

ALTER TABLE erp_private.account_catalog
  ADD COLUMN IF NOT EXISTS entity_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS industry_packs text[] NOT NULL DEFAULT '{}';

ALTER TABLE erp_private.account_catalog
  ADD CONSTRAINT account_catalog_entity_types_check
    CHECK (entity_types <@ ARRAY['Limited company','Partnership','Sole proprietor']::text[]),
  ADD CONSTRAINT account_catalog_industry_packs_check
    CHECK (industry_packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Other']::text[]);

COMMENT ON COLUMN erp_private.account_catalog.entity_types IS 'Legal entity types the account applies to; empty = all entity types.';
COMMENT ON COLUMN erp_private.account_catalog.industry_packs IS 'Industry packs the account belongs to; empty = core account for every client.';

-- Scope tags are classification, not account identity: allow them to change on an Active account,
-- through the API only by a Partner. Every other column of an Active account stays immutable.
CREATE OR REPLACE FUNCTION erp_private.accounting_control_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF TG_TABLE_NAME='account_catalog' THEN
  IF TG_OP='UPDATE' AND OLD.status='Active' THEN
   IF (to_jsonb(NEW)-ARRAY['entity_types','industry_packs','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['entity_types','industry_packs','revision','updated_at']) THEN RAISE EXCEPTION 'Active account identity is immutable; add another code' USING ERRCODE='23514';END IF;
   IF current_user='erp_api' AND a.category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required to change account scope' USING ERRCODE='42501';END IF;
  END IF;
  IF NEW.status='Active' AND current_user='erp_api' AND a.category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='sales_reconciliations' THEN
  IF TG_OP='INSERT' THEN
   IF current_user='erp_api' AND (NEW.status<>'Draft' OR NEW.prepared_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Create your own draft review' USING ERRCODE='42501';END IF;
  ELSE
   IF OLD.status='Locked' THEN RAISE EXCEPTION 'Approved reconciliation is immutable' USING ERRCODE='23514';END IF;
   IF (NEW.project_id,NEW.review_type,NEW.starts_on,NEW.ends_on,NEW.prepared_by) IS DISTINCT FROM (OLD.project_id,OLD.review_type,OLD.starts_on,OLD.ends_on,OLD.prepared_by) THEN RAISE EXCEPTION 'Reconciliation identity is immutable' USING ERRCODE='23514';END IF;
   IF OLD.status='Submitted' THEN
    IF NEW.status NOT IN ('Locked','Returned') THEN RAISE EXCEPTION 'Reviewer must return submitted work' USING ERRCODE='23514';END IF;
    IF current_user='erp_api' AND (a.staff_id=OLD.prepared_by OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR length(btrim(coalesce(NEW.review_note,'')))=0) THEN RAISE EXCEPTION 'Independent review and conclusion required' USING ERRCODE='42501';END IF;
    IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_note','review_snapshot','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_note','review_snapshot','revision','updated_at']) THEN RAISE EXCEPTION 'Return work before changing submitted values' USING ERRCODE='23514';END IF;
   ELSE
    IF current_user='erp_api' AND a.staff_id IS DISTINCT FROM OLD.prepared_by THEN RAISE EXCEPTION 'Assigned preparer must change the draft' USING ERRCODE='42501';END IF;
    IF NEW.status NOT IN ('Draft','Submitted') THEN RAISE EXCEPTION 'Submit before approval' USING ERRCODE='23514';END IF;
   END IF;
  END IF;
 END IF;RETURN NEW;
END;$function$;

-- Entity layer (existing accounts)
UPDATE erp_private.account_catalog SET entity_types = ARRAY['Limited company']
 WHERE code IN ('30000','30010','31000','20140','60150','64150');
UPDATE erp_private.account_catalog SET entity_types = ARRAY['Sole proprietor']
 WHERE code IN ('35000','35010');
UPDATE erp_private.account_catalog SET entity_types = ARRAY['Partnership']
 WHERE code IN ('36000','36010','36020');

-- Industry layer (existing accounts)
UPDATE erp_private.account_catalog SET industry_packs = ARRAY['Hospitality'] WHERE code = '21608';
UPDATE erp_private.account_catalog SET industry_packs = ARRAY['Wholesale','Retail'] WHERE code IN ('50110','50130');

-- Retail pack on client activities
ALTER TABLE erp_private.client_activities DROP CONSTRAINT IF EXISTS client_activities_pack_code_check;
ALTER TABLE erp_private.client_activities
  ADD CONSTRAINT client_activities_pack_code_check
  CHECK (pack_code IN ('Wholesale','Retail','Hospitality','Consultancy','Construction','Other'));

-- New industry accounts, Draft until a Partner approves each one
INSERT INTO erp_private.account_catalog
  (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,industry_packs)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-04-IND','Draft',industry_packs
FROM (VALUES
 ('10260','Till, card and mobile-money clearing','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','POS Z-reports / settlement statements','Clears to bank on settlement',ARRAY['Retail','Hospitality']),
 ('10270','Contract assets - unbilled work','Current assets',null,'ASSET','Statement of financial position','Balance sheet','Valuation certificates / progress reports','IFRS 15 over-time revenue not yet billed',ARRAY['Construction']),
 ('10280','Retention receivable','Current assets',null,'ASSET','Statement of financial position','Balance sheet','Interim certificates / contract terms','Released on practical completion and defects period',ARRAY['Construction']),
 ('10290','Unbilled fees - work in progress','Current assets',null,'ASSET','Statement of financial position','Balance sheet','Timesheets / engagement terms','Cut-off review at period end',ARRAY['Consultancy']),
 ('10300','Guest ledger and corporate-account receivables','Current assets',null,'ASSET','Statement of financial position','Balance sheet','Property system guest folios / city ledger','',ARRAY['Hospitality']),
 ('20150','Gift vouchers and layby deposits','Liabilities',null,'LIAB','Statement of financial position','Balance sheet','Voucher register / layby cards','Revenue only on redemption or delivery',ARRAY['Retail']),
 ('20160','Contract liabilities - billed in advance','Liabilities',null,'LIAB','Statement of financial position','Balance sheet','Certificates / invoices / progress reports','Billings ahead of work performed',ARRAY['Construction']),
 ('20170','Retention payable to subcontractors','Liabilities',null,'LIAB','Statement of financial position','Balance sheet','Subcontract terms / certificates','',ARRAY['Construction']),
 ('20180','Provision for defects and rectification','Liabilities',null,'LIAB','Statement of financial position','Balance sheet','Contract terms / engineer reports','Movement not deductible until incurred - tax review',ARRAY['Construction']),
 ('20190','Advance booking deposits','Liabilities',null,'LIAB','Statement of financial position','Balance sheet','Booking system / receipts','Revenue when the stay or event takes place',ARRAY['Hospitality']),
 ('21615','Construction levy payable','Tax / statutory liabilities',null,'LIAB','Statement of financial position','Tax control','NCA assessment / receipt','Keep in Draft until the NCA rate and threshold are confirmed with an official citation (design doc Decision 1)',ARRAY['Construction']),
 ('40150','Trade discounts and volume rebates allowed','Revenue',null,'REV','Profit or loss','Income / turnover','Credit notes / rebate agreements','Reduces turnover',ARRAY['Wholesale','Retail']),
 ('40160','Contract revenue - construction','Revenue',null,'REV','Profit or loss','Income / turnover','Contracts / certificates / eTIMS','Recognised over time per contract',ARRAY['Construction']),
 ('40170','Contract variations and claims revenue','Revenue',null,'REV','Profit or loss','Income / turnover','Approved variations / claims','Only when approved or highly probable',ARRAY['Construction']),
 ('40180','Professional fee income','Revenue',null,'REV','Profit or loss','Income / turnover','Engagement letters / invoices / eTIMS','WHT credits to 10130',ARRAY['Consultancy']),
 ('40190','Recharged disbursements income','Revenue',null,'REV','Profit or loss','Income / turnover','Disbursement schedules / invoices','',ARRAY['Consultancy']),
 ('40200','Rooms revenue','Revenue',null,'REV','Profit or loss','Income / turnover','Property system / eTIMS','Tourism levy base - review',ARRAY['Hospitality']),
 ('40210','Food revenue','Revenue',null,'REV','Profit or loss','Income / turnover','POS / eTIMS','',ARRAY['Hospitality']),
 ('40220','Beverage revenue','Revenue',null,'REV','Profit or loss','Income / turnover','POS / eTIMS','Excise and licensing review',ARRAY['Hospitality']),
 ('40230','Conference and events revenue','Revenue',null,'REV','Profit or loss','Income / turnover','Event contracts / eTIMS','',ARRAY['Hospitality']),
 ('40240','Service charge income','Revenue',null,'REV','Profit or loss','Income / turnover','POS / payroll distribution records','Check distribution to staff and PAYE',ARRAY['Hospitality']),
 ('50160','Site materials consumed','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Site issue notes / stores records','',ARRAY['Construction']),
 ('50170','Food and beverage cost of sales','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Kitchen and bar stock records','',ARRAY['Hospitality']),
 ('61260','Subcontractor costs - contracts','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Subcontracts / certificates / WHT records','',ARRAY['Construction']),
 ('61270','Plant and equipment hire - sites','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Hire agreements / invoices','',ARRAY['Construction']),
 ('61280','Linen, crockery and guest supplies','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Invoices / stores records','',ARRAY['Hospitality']),
 ('61290','Professional indemnity insurance','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Policy schedule / invoice','',ARRAY['Consultancy'])
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes,industry_packs)
ON CONFLICT (code) DO NOTHING;
