// Staff-level switches narrow existing API access. Area, role, record scope and
// workflow checks still run independently. Keep the browser and Edge copies identical.
const leaders=['PARTNER','MANAGER'];
const staff=[...leaders,'SUPERVISOR','ASSISTANT'];
const team=[...staff,'INTERN'];
const office=[...team,'ADMIN'];
const partner=['PARTNER'];
const key=(group,operation)=>group+'.'+operation;

const groups=[
 ['invoice','billing_wip','Invoices',leaders,{
  view:['invoice_pdf','billing_by_task'], create:['invoice_save'], edit:['invoice_edit'],
  submit:['invoice_submit'], review:['invoice_check'], post:['invoice_post'], void:['invoice_void'], etims:['invoice_etims_record'], reset:['invoice_reset_to_draft'],
 }, {reset:['PARTNER']}],
 ['creditnote','billing_wip','Credit notes on firm invoices',leaders,{
  view:['credit_note_pdf'], create:['credit_note_save'], submit:['credit_note_submit'], approve:['credit_note_issue','credit_note_return'], void:['credit_note_void'], etims:['credit_note_etims_record'],
 },{approve:['PARTNER'],void:['PARTNER']}],
 ['receipt','billing_wip','Receipts and advances',leaders,{
  view:[], create:['payment_add','advance_receive'], apply:['advance_apply'], reverse:['payment_reverse'], move:['advance_refund','advance_transfer'],
 }],
 ['fee','billing_wip','Recurring fees',leaders,{view:[],create:['fee_schedule_add'],edit:['fee_schedule_state'],generate:['fee_schedule_generate_due']},{create:partner}],
 ['wip','billing_wip','Budgets and WIP',leaders,{view:['wip_report','client_card_wip','metrics_wip','metrics_realization','metrics_summary'],create:['budget_add'],edit:['staff_rate_add']},{create:partner,edit:partner}],
 ['statement','billing_wip','Statements',leaders,{view:['statement']}],
 ['journal','projects','Journals and opening balances',staff,{
  view:['ledger_journal_read','ledger_account_read'],
  create:['ledger_journal_save','ledger_import_commit','ledger_generate_sources','ledger_period_import_create','ledger_payroll_create','ledger_payroll_journal_create','ledger_depreciation_create','ledger_stock_propose','ledger_withholding_create','ledger_supplier_build'],
  edit:['ledger_journal_metadata','ledger_journal_line_fix','ledger_journal_refresh'], submit:['ledger_journal_submit'],
  review:['ledger_journal_check'],post:['ledger_journal_review'],reverse:['ledger_reverse','sales_amend_prepare','sales_legacy_prepare'],
 },{review:[...leaders,'SUPERVISOR'],post:leaders,reverse:leaders}],
 ['client','clients','Client records',staff,{view:['client_register_page'],create:['client_save','client_master_import'],edit:['client_classify_save','v3_identity_save']}],
 ['onboardbatch','clients','Client onboarding batches (MLRO template)',staff,{view:['onboarding_batch_read','onboarding_batch_pdf'],create:['onboarding_template_propose'],review:['onboarding_batch_check'],mlro:['onboarding_batch_checks_save','onboarding_batch_ratings_save','onboarding_batch_accept','onboarding_batch_sign']},{review:[...leaders,'SUPERVISOR'],mlro:[...leaders,'SUPERVISOR']}],
 ['clientvault','clients','KRA credential vault',staff,{view:['client_vault_list','client_vault_reveal'],edit:['client_vault_update','client_vault_permissions']},{edit:leaders}],
 ['clientpipeline','clients','Client set-up status',leaders,{view:['client_setup_pipeline_read'],edit:[]}],
 ['clientonboard','clients','Client onboarding allocation',leaders,{view:['client_onboarding_alloc_read','client_onboarding_alloc_clients'],edit:['client_onboarding_alloc_assign','client_onboarding_alloc_remove','client_onboarding_alloc_move']}],
 ['clientteam','clients','Client team',staff,{view:['client_team_read','client_team_defaults'],edit:['client_team_add','client_team_end','client_team_handover']},{edit:leaders}],
 ['contacts','clients','Client contacts',staff,{view:[],create:['contact_save']}],
 ['kycfile','clients','KYC and ownership',staff,{view:[],edit:['compliance_save','compliance_evidence_save','compliance_evidence_remove','owner_add','party_add','party_end','group_profile_save'],review:['compliance_verify'],approve:['edd_approve']},{review:leaders,approve:partner}],
 ['project','projects','Projects',team,{view:[],create:['project_save'],edit:[],post:['engagement_save_activate','engagement_activate']},{create:[...leaders,'SUPERVISOR'],edit:[...leaders,'SUPERVISOR'],post:leaders}],
 ['monthwork','projects','Monthly work periods',staff,{view:['month_work_read'],create:['month_work_open','month_work_new_week','month_work_add_task'],edit:['month_work_submit'],review:['month_work_clear']},{create:[...leaders,'SUPERVISOR'],review:[...leaders,'SUPERVISOR']}],
 ['teamqueue','projects','Team queue',[...leaders,'SUPERVISOR'],{view:['team_queue_read'],edit:[]}],
 ['task','projects','Tasks and assignments',team,{view:['task_workload_list','task_pool_list','task_recipients','task_handover_list'],create:['task_create'],edit:['task_workload_candidates','task_workload_apply','task_status','task_pool_send','task_handover_request','task_pool_claim'],review:['task_handover_decide','task_handover_reallocate','task_hours_set']}],
 ['leave','time_hr','Leave',team,{view:[],create:['leave_request'],review:['leave_review']},{review:leaders}],
 ['attendance','time_hr','Attendance',team,{view:[],edit:['attendance_correct']},{edit:leaders}],
 ['files','documents','Documents',team,{view:['download','document_links','document_review_list','document_review_states'],create:['upload'],edit:['document_archive','document_link_add','document_link_remove'],review:['document_review_submit'],grant:['document_grantees','document_grant_add','document_grant_revoke']},{review:[...leaders,'SUPERVISOR'],grant:leaders}],
 ['messenger','communications','Messenger',office,{view:['discussion_list','discussion_mentionable','discussion_messages','discussion_open','discussion_candidates','discussion_read','discussion_group_overview','discussion_shared_link','discussion_attachment_download','discussion_call_config','discussion_call_get','discussion_call_pending'],create:['discussion_send','discussion_react','discussion_attachment_upload','discussion_attachment_discard','discussion_call_start','discussion_call_answer','discussion_call_end'],manage:['discussion_staff_directory','discussion_group_create','discussion_group_members_set']},{manage:['ADMIN']}],
 ['letters','communications','Client communications',staff,{view:['communication_resolve','communication_qr','communication_letter_pdf','client_timeline'],create:['communication_save'],edit:[],post:['communication_issue']}],
 ['audit','audit','Audit files',staff,{view:['audit_workspace','audit_tb_lines'],create:['audit_file_save','audit_lead_create','audit_report_draft'],edit:['audit_workpaper_save','audit_tb_import','audit_tb_map','audit_materiality_save','audit_risk_save','audit_adjustment_save','audit_population_save','audit_completion_save'],submit:['audit_report_submit','audit_workpaper_submit','audit_adjustment_submit','audit_population_submit'],review:['audit_materiality_approve','audit_report_review','audit_workpaper_review','audit_adjustment_review','audit_population_review','audit_completion_review','audit_tb_confirm']}],
 ['lead','leads','Leads and pipeline',staff,{view:[],create:['lead_save'],edit:[],approve:['lead_convert']},{edit:[...leaders,'SUPERVISOR'],approve:leaders}],
 ['staff','staff_access','Staff accounts', [...leaders,'ADMIN'],{view:[],create:['staff_save','master_staff_import'],edit:['staff_disable'],setup:['account_link','manager_password_reset_targets']}],
 ['access','staff_access','Access settings',[...leaders,'ADMIN'],{view:['staff_access_read'],edit:['staff_access_save'],grant:['staff_right_grant','staff_right_revoke']},{grant:partner}],
 ['settings','settings','Settings and approvals',[...leaders,'ADMIN'],{view:['settings_hub_read','settings_approvals_read','settings_approval_items_read','settings_starter_proposals_read'],edit:['sector_save','firm_save','rate_save','settings_starter_propose'],approve:['settings_approval_batch_approve','rate_approve']},{approve:leaders}],
];

// Route families cover the existing submodules that expose multiple screens and RPCs.
const families=[
 ['clientsetup','clients','Client setup and lifecycle',staff,['client_setup_','client_lifecycle','client_year_rollover_','client_understanding_','client_pf_','client_scope_','bulk_setup_','v3_identity_','v3_activity_','v3_activities_','v3_vat_']],
 ['chart','clients','Chart, accounts and mappings',staff,['v3_client_','v3_category_','v3_bank_','client_routing_','v3_books_pack_']],
 ['stock','clients','Stock and valuation',staff,['v3_stock_']],
 ['compliance','clients','Compliance and due diligence',staff,['aml_','compliance_','kyc_proposal_','client_comm_','client_holder_','licence_','v3_partners_']],
 ['imports','projects','Imports and source reconciliation',staff,['accounting_','bookkeeping_','workbook_','period_import_','sales_recon_','bank_totals_','purchase_accounts_','routing_map_','purchase_ledger_','non_etims_','ledger_bank_','ledger_supplier_']],
 ['workflow','projects','Engagement and workflow',team,['engagement_','procedure_','task_','partner_escalation_','schedule_','project_','work_period_','service_template_','service_category_','form_draft_']],
 ['taxwork','projects','Tax returns and filings',staff,['tax_','wht_','whtvat_','withholding_','kra_','statutory_file_','excise_schedule_','payroll_','due_date_','obligation_']],
 ['accounting','projects','Client ledgers and accounts',staff,['ledger_','delete_redo_','period_pack_','reporting_','sales_','v3_mapping_','v3_review_','v3_export_']],
 ['agreed','projects','Agreed-upon procedures',staff,['aup_']],
 ['timesheet','time_hr','Timesheets and timers',team,['timesheet_','timer_']],
 ['hr','time_hr','People, attendance and staffing',team,['view_staff_','presence_','attendance_','clock','roster_','credential_','performance_']],
 ['incoming','documents','Incoming documents',team,['incoming_']],
 ['docrequest','documents','Document requests',staff,['doc_request_']],
 ['physical','documents','Physical files and evidence',staff,['physical_file_','evidence_']],
 ['support','communications','Client support and tickets',office,['client_support_','ticket_']],
 ['concern','communications','Concerns and restricted reports',staff,['concern_','sar_']],
 ['auditwork','audit','Workpapers, evidence and reports',staff,['audit_']],
 ['forensic','audit','Forensic work',staff,['forensic_']],
 ['reference','settings','Reference documents and practice settings',[...leaders,'ADMIN'],['reference_','practice_','firm_','holiday_','deadline_','go_live_','policy_','release_']],
 ['taxsetting','settings','Tax rules and role assignments',leaders,['rate_','tax_manager_','tax_role_','annual_due_rule_']],
 ['access','staff_access','Access settings',[...leaders,'ADMIN'],['staff_right']],
];

const otherAreas=[
 ['clientops','clients','Other client functions',staff],['projectops','projects','Other project functions',team],
 ['hrops','time_hr','Other time and HR functions',team],['docops','documents','Other document functions',team],
 ['commsops','communications','Other communications functions',office],['financeops','billing_wip','Other finance functions',leaders],
 ['auditops','audit','Other audit functions',staff],['leadops','leads','Other lead functions',staff],
 ['staffops','staff_access','Other staff administration functions',[...leaders,'ADMIN']],
 ['settingops','settings','Other settings functions',[...leaders,'ADMIN']],
];
const operationOf=action=>{
 if(/_(?:approve|confirm|verify|decide|issue|post|lock|file|activate|review|reject|resolve|sign|close|finalize|release|supersede|check|return)$/.test(action))return 'review';
 if(/_(?:submit|propose|send|request)$/.test(action))return 'submit';
 if(/_(?:read|list|get|page|queue|preview|template|options|menu|report|directory|search|export|download|overview|catalog|candidates|summary|backlog|impact|checklist)$/.test(action))return 'view';
 if(/_(?:add|new|create|record|import|upload|start|receive|open|raise|generate|copy)$/.test(action))return 'create';
 return 'edit';
};

const captions={
 view:'View',create:'Create / record',edit:'Edit',submit:'Submit',review:'Check / return',post:'Post / activate',approve:'Approve',
 void:'Void',etims:'Record eTIMS reference',reset:'Reset to draft',apply:'Apply advance',reverse:'Reverse',move:'Refund / transfer',
 generate:'Generate invoice drafts',grant:'Grant / revoke',manage:'Manage groups',setup:'Issue setup link',
};

// Check / return is a reviewer's function: the independent check is never given to the person who prepares work. Unless a group says otherwise,
// only Supervisors, Managers and Partners hold it by default. Submitting work for review is a separate right that preparers keep.
const reviewers=[...leaders,'SUPERVISOR'];
const defaultRoles=(operation,roles)=>operation==='review'?roles.filter(role=>reviewers.includes(role)):roles;
const rightRows=(group,area,label,roles,actions,defaults={})=>
 Object.entries(actions).map(([operation,routes])=>({code:key(group,operation),area,group:label,label:captions[operation],roles:defaults[operation]||defaultRoles(operation,roles),routes,view:key(group,'view')}));
const familyActions={view:[],create:[],edit:[],submit:[],review:[]};
const rights=new Map(groups.flatMap(args=>rightRows(...args)).map(r=>[r.code,r]));
for(const [code,area,label,roles] of [...families,...otherAreas]){
 for(const right of rightRows(code,area,label,roles,familyActions))if(!rights.has(right.code))rights.set(right.code,right);
}
export const ACTION_RIGHTS=Object.freeze([...rights.values()]);
const byAction=new Map(ACTION_RIGHTS.flatMap(r=>r.routes.map(action=>[action,r])));
const byCode=new Map(ACTION_RIGHTS.map(r=>[r.code,r]));
export const isActionRight=code=>byCode.has(code);
export const defaultActionRights=role=>ACTION_RIGHTS.filter(r=>r.roles.includes(role)).map(r=>r.code);
export function rightsForRequest(p,area){
 const {action}=p||{};
 let r=byAction.get(action);
 if(['ledger_journal_save','ledger_payroll_create'].includes(action)&&p.journal_id)r=byCode.get('journal.edit');
 if(action==='ledger_journal_review'&&p.status==='Returned')r=byCode.get('journal.review');
 if(action==='work_queue_decide')r=byCode.get(p.decision==='approve'?'journal.post':'journal.review');
 if(action==='client_save'&&p.client_id)r=byCode.get('client.edit');
 if(action==='staff_save'&&p.staff_id)r=byCode.get('staff.edit');
 if(action==='lead_save'&&p.lead_id)r=byCode.get('lead.edit');
 if(action==='communication_save'&&p.communication_id)r=byCode.get('letters.edit');
 if(action==='project_save'&&p.project_id)r=byCode.get('project.edit');
 if(!r&&typeof action==='string'&&area){
  const family=families.find(([,scope,,,prefixes])=>scope===area&&prefixes.some(prefix=>action.startsWith(prefix)))||otherAreas.find(([,scope])=>scope===area);
  if(family)r=byCode.get(key(family[0],operationOf(action)));
 }
 return r?[...new Set([r.view,r.code,...(['payment_add','advance_apply'].includes(action)?['invoice.view']:action==='fee_schedule_generate_due'?['invoice.view','invoice.create']:[])])]:[];
}
export const canUseAction=(restricted,p,area)=>rightsForRequest(p,area).every(code=>!restricted?.includes(code));
export const actionRightLabel=code=>{const r=byCode.get(code);return r? r.group+' · '+r.label:code;};

export function hasVisibleActionGroup(role,area,restricted){
 const views=ACTION_RIGHTS.filter(r=>r.area===area&&r.code===r.view&&r.roles.includes(role)&&!otherAreas.some(([code])=>r.code===key(code,'view')));
 return !views.length||views.some(r=>!restricted?.includes(r.view));
}

export function filterActionWorkspace(workspace,restricted){
 const suite={...workspace.suite}, out={...workspace,suite};
 const hide=(right,record,fields)=>{if(restricted.includes(right))for(const field of fields)record[field]=[];};
 hide('invoice.view',suite,['invoices']);
 hide('receipt.view',suite,['payments','advances','advance_movements']);
 hide('fee.view',suite,['recurring_fees']);
 hide('wip.view',suite,['staff_rates','budgets']);
 hide('lead.view',suite,['leads']);
 hide('contacts.view',suite,['contacts']);
 hide('kycfile.view',suite,['compliance','owners','parties','group_profiles','ownership_status','kyc_evidence','kyc_changes']);
 hide('compliance.view',suite,['licences','licence_summary']);
 hide('clientsetup.view',suite,['tax_profiles','classification_pending_clients']);
 hide('settings.view',suite,['rates']);
 hide('taxwork.view',suite,['tax_cases']);
 hide('support.view',suite,['tickets']);
 hide('letters.view',suite,['communications']);
 hide('leave.view',suite,['leave']);
 hide('attendance.view',suite,['attendance']);
 hide('hr.view',suite,['credentials','reviews']);
 hide('timesheet.view',out,['timesheets']);
 hide('task.view',out,['tasks','task_events','task_procedures','work_period_tasks']);
 hide('files.view',out,['documents']);
 hide('staff.view',out,['staff','staff_firms']);
 if(restricted.includes('client.view'))out.clients=(out.clients||[]).map(c=>({client_id:c.client_id,company_name:c.company_name,details_visible:false}));
 return out;
}
