// Function-level rights, grouped by ERP area. Each right names the roles that hold it by default (taken from the rights matrix)
// and the server actions it covers. A Manager or Partner can switch a right off for one person; the server then refuses those actions
// for that person. A right can only be narrowed here: it never adds access beyond the role, the firm/project scope, the maker-checker
// rules or the approval chain, which each handler still enforces on its own.
// This file is copied unchanged to the staff screen (see tests/function_rights.test.mjs); keep both copies identical.
export const STAFF_RIGHTS=Object.freeze([
 {code:'client.details',area:'clients',group:'Client records',label:'Change client details (name, PIN, sector, legal structure)',roles:['PARTNER','MANAGER'],actions:['client_save','client_classify_save','v3_identity_save']},
 {code:'client.contacts',area:'clients',group:'Client records',label:'Add or change client contacts',roles:['PARTNER','MANAGER'],actions:['contact_save']},
 {code:'client.owners',area:'clients',group:'Client records',label:'Record owners, beneficial owners, partners, directors, shareholders, trustees and the group profile',roles:['PARTNER','MANAGER'],actions:['owner_add','party_add','party_end','group_profile_save','v3_partners_add']},
 {code:'client.setup',area:'clients',group:'Client records',label:'Client set-up: activities, VAT categories and the draft tax profile',roles:['PARTNER','MANAGER'],actions:['tax_profile_save','tax_profile_dependency_preview','v3_activity_add','v3_activities_preview','v3_activities_submit','v3_vat_categories_save']},
 {code:'client.tax_verify',area:'clients',group:'Client records',label:'Verify the client tax profile',roles:['PARTNER','MANAGER'],actions:['tax_profile_verify']},
 {code:'kyc.file',area:'clients',group:'KYC',label:'Edit the KYC file and record evidence',roles:['PARTNER','MANAGER'],actions:['compliance_save','compliance_evidence_save','compliance_evidence_remove']},
 {code:'kyc.verify',area:'clients',group:'KYC',label:'Verify KYC',roles:['PARTNER','MANAGER'],actions:['compliance_verify']},
 {code:'kyc.edd',area:'clients',group:'KYC',label:'Approve enhanced due diligence',roles:['PARTNER'],actions:['edd_approve']},
 {code:'chart.propose',area:'clients',group:'Chart of accounts and mappings',label:'Propose the client chart of accounts',roles:['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'],actions:['v3_client_chart_propose']},
 {code:'chart.check',area:'clients',group:'Chart of accounts and mappings',label:'Check the client chart of accounts',roles:['PARTNER','MANAGER','SUPERVISOR'],actions:['v3_client_chart_check']},
 {code:'chart.approve',area:'clients',group:'Chart of accounts and mappings',label:'Approve the client chart of accounts',roles:['PARTNER','MANAGER'],actions:['v3_client_chart_review']},
 {code:'mapping.edit',area:'clients',group:'Chart of accounts and mappings',label:'Set up or end client account mappings',roles:['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'],actions:['v3_client_account_mapping_add','v3_client_account_mapping_end','v3_client_account_mapping_end_batch','v3_client_account_mapping_tb_preview','v3_client_account_mapping_tb_save']},
 {code:'mapping.approve',area:'clients',group:'Chart of accounts and mappings',label:'Approve client account mappings',roles:['PARTNER','MANAGER'],actions:['v3_client_account_mapping_approve','v3_client_account_mapping_approve_batch']},
 {code:'stock.setup',area:'clients',group:'Stock',label:'Set the stock policy for a client',roles:['PARTNER','MANAGER'],actions:['v3_stock_policy_add']},
 {code:'stock.prepare',area:'clients',group:'Stock',label:'Prepare and submit stock counts and valuations',roles:['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'],actions:['v3_stock_create','v3_stock_create_vat','v3_stock_save','v3_stock_submit']},
 {code:'stock.review',area:'clients',group:'Stock',label:'Review stock counts and valuations',roles:['PARTNER','MANAGER','SUPERVISOR'],actions:['v3_stock_review']},
 {code:'project.propose',area:'projects',group:'Projects',label:'Propose or draft a project for a client (a Manager or Partner activates it)',roles:['PARTNER','MANAGER','SUPERVISOR'],actions:['project_save','schedule_preview','schedule_config_preview']},
 {code:'project.activate',area:'projects',group:'Projects',label:'Activate a project and release its tasks',roles:['PARTNER','MANAGER'],actions:['engagement_save_activate','engagement_activate']},
 {code:'acct.setup',area:'projects',group:'Accounting work',label:'Accounting set-up: inventory method, stock categories and accounts',roles:['PARTNER','MANAGER'],actions:['accounting_policy_save','accounting_stock_category_add','accounting_account_add']},
 {code:'acct.prepare',area:'projects',group:'Accounting work',label:'Prepare sales, payroll and purchase imports and map the rows',roles:['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'],actions:['work_withdraw','period_import_preview','period_import_save','period_import_submit','period_import_discard','period_import_payroll_tax','ledger_supplier_save','ledger_supplier_build','ledger_bank_save','ledger_bank_suggest','ledger_bank_propose_chart','ledger_bank_fixit_read','ledger_bank_lines_map','ledger_bank_apply_rules','ledger_bank_rule_save','ledger_bank_summary_read','workbook_preview','workbook_commit','workbook_map','workbook_map_bulk','workbook_mapping_undo','workbook_split','sales_recon_create','sales_recon_save','sales_recon_submit','ledger_period_import_create','ledger_import_preview','ledger_opening_suggest','ledger_opening_structure','ledger_opening_template','ledger_import_commit','ledger_payroll_create','ledger_generate_sources','v3_mapping_select','wht_row_set','wht_line_add','wht_line_void','wht_certificate','ledger_withholding_create','purchase_ledger_credit_request','non_etims_bases','non_etims_check']},
 {code:'acct.amend_request',area:'projects',group:'Accounting work',label:'Ask to amend a confirmed sales summary entered incorrectly',roles:['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'],actions:['sales_amend_read','sales_amend_request','sales_amend_cancel']},
 {code:'acct.amend_approve',area:'projects',group:'Accounting work',label:'Approve an amendment, prepare its reversals and withdraw the old summary (a different Manager or Partner posts the reversals)',roles:['PARTNER','MANAGER'],actions:['sales_amend_decide','sales_amend_prepare','sales_amend_complete']},
 {code:'acct.sales_replace',area:'projects',group:'Accounting work',label:'Replace old invoice-based sales with category totals (a different Manager or Partner posts the reversal)',roles:['PARTNER','MANAGER'],actions:['sales_legacy_read','sales_legacy_prepare','sales_legacy_complete']},
 {code:'acct.non_etims_bases',area:'projects',group:'Accounting work',label:'Maintain non-eTIMS legal bases (a Partner approves and retires them)',roles:['PARTNER','MANAGER'],actions:['non_etims_basis_save','non_etims_basis_approve','non_etims_basis_retire']},
 {code:'fs.framework',area:'projects',group:'Accounting work',label:'Set the reporting framework and edition for a client year',roles:['PARTNER','MANAGER'],actions:['ledger_reporting_save']},
 {code:'fs.comparatives',area:'projects',group:'Accounting work',label:'Enter prior-year comparatives for a first ledger year, and approve them (approval is for Partners)',roles:['PARTNER','MANAGER'],actions:['ledger_comparatives_save','ledger_comparatives_review']},
 {code:'fs.map',area:'projects',group:'Accounting work',label:'Propose, approve or reject statement-line mappings for the annual accounts (approval is for Partners)',roles:['PARTNER','MANAGER'],actions:['ledger_statement_map_propose','ledger_statement_map_approve','ledger_statement_map_reject']},
 {code:'acct.review',area:'projects',group:'Accounting work',label:'Review and confirm imports, reconciliations and reports',roles:['PARTNER','MANAGER','SUPERVISOR'],actions:['period_import_review','sales_recon_review','ledger_report_review','ledger_close_explanation_review']},
 {code:'acct.journal_prepare',area:'projects',group:'Accounting work',label:'Prepare and submit journals, assets and stock',roles:['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'],actions:['ledger_journal_save','ledger_journal_metadata','ledger_journal_line_fix','ledger_journal_refresh','ledger_journal_submit','ledger_asset_save','ledger_asset_submit','ledger_depreciation_create','ledger_stock_propose','ledger_report_submit','ledger_close_explanation_save']},
 {code:'acct.journal_check',area:'projects',group:'Accounting work',label:'Check journals and opening balances',roles:['PARTNER','MANAGER','SUPERVISOR'],actions:['ledger_journal_check']},
 {code:'acct.journal_approve',area:'projects',group:'Accounting work',label:'Approve and post journals, and reverse entries',roles:['PARTNER','MANAGER'],actions:['ledger_journal_review','ledger_asset_review','ledger_reverse','ledger_bank_rule_review','ledger_bank_category_save','ledger_bank_category_retire']},
]);
const RIGHT_CODES=STAFF_RIGHTS.map(r=>r.code);
const BY_ACTION=new Map(STAFF_RIGHTS.flatMap(r=>r.actions.map(a=>[a,r.code])));
export const rightForAction=action=>BY_ACTION.get(String(action||''))||null;
export const rightLabel=code=>STAFF_RIGHTS.find(r=>r.code===code)?.label||code;
// The rights a role holds by default.
export const defaultStaffRights=role=>STAFF_RIGHTS.filter(r=>r.roles.includes(role)).map(r=>r.code);
// What a person can use: the role's rights, less those switched off for them, and none at all when the whole area is off.
export function effectiveStaffRights(role,deniedRights=[],areas=null){
 const denied=new Set(Array.isArray(deniedRights)?deniedRights:[]);
 return STAFF_RIGHTS.filter(r=>r.roles.includes(role)&&!denied.has(r.code)&&(!areas||areas.includes(r.area))).map(r=>r.code);
}
export const isRightCode=code=>RIGHT_CODES.includes(code);

// Entries an Assistant or Supervisor may propose instead of saving directly. A proposal is checked and then approved by a Manager or Partner,
// and the approver's own account applies it, so every existing validation still runs. Verification and approval actions are never proposable.
export const PROPOSABLE_ACTIONS=Object.freeze(['client_save','contact_save','owner_add','compliance_evidence_save']);
export const isProposableAction=action=>PROPOSABLE_ACTIONS.includes(action);
