// Staff-area restrictions narrow the existing role permissions. They never
// grant a capability or replace the handler's approval and record-scope checks.
export const STAFF_ACCESS_AREAS = Object.freeze([
  {code:'clients',label:'Clients',view:'clients'},
  {code:'projects',label:'Projects & tasks',view:'projects'},
  {code:'time_hr',label:'Time & HR',view:'time'},
  {code:'documents',label:'Documents',view:'documents'},
  {code:'communications',label:'Communications',view:'communications'},
  {code:'billing_wip',label:'Billing & WIP',view:'finance'},
  {code:'audit',label:'Audit & assurance',view:'audit'},
  {code:'leads',label:'Leads',view:'leads'},
  {code:'staff_access',label:'Staff & access',view:'staff'},
  {code:'settings',label:'Settings',view:'firms'},
]);

const AREA_CODES=STAFF_ACCESS_AREAS.map(x=>x.code);
const LEADER_AREAS=['clients','projects','time_hr','documents','communications','billing_wip','audit','leads','staff_access','settings'];
const TEAM_AREAS=['clients','projects','time_hr','documents','communications','audit'];
const INTERN_AREAS=['projects','time_hr','documents','communications'];

export function defaultStaffAreas(role){
  if(role==='PARTNER'||role==='MANAGER')return [...LEADER_AREAS];
  if(role==='SUPERVISOR'||role==='ASSISTANT')return [...TEAM_AREAS];
  if(role==='INTERN')return [...INTERN_AREAS];
  return [];
}

export function effectiveStaffAreas(role,restricted=[]){
  const denied=new Set(Array.isArray(restricted)?restricted:[]);
  return defaultStaffAreas(role).filter(code=>!denied.has(code));
}

const PREFIX_AREAS=[
  [/^lead_/, 'leads'],
  [/^(?:staff_save|staff_disable|staff_access_|account_link|master_staff_)/,'staff_access'],
  [/^(?:firm_save|firm_details|sector_save|reference_|rate_(?:save|approve|impact)|release_(?:check_save|read))/, 'settings'],
  [/^(?:client_save|compliance_|edd_approve|owner_add|contact_save|tax_profile_|v3_client_|v3_identity_|v3_activity_|v3_stock_|v3_category_|v3_bank_|v3_opening_balance|v3_partners_add)/,'clients'],
  [/^(?:task_|project_|schedule_|generate_tasks|engagement_|procedure_|accounting_|ledger_|purchase_ledger_|workbook_|period_import_|tax_|work_|sales_|v3_mapping_|v3_project_|v3_export_|v3_period_add|v3_suggestions|suite_export)/,'projects'],
  [/^audit_/, 'audit'],
  [/^(?:presence_|timer_|clock$|attendance_|leave_|roster_|performance_|credential_|timesheet_)/,'time_hr'],
  [/^(?:document_|upload$|download$|master_preview$|master_import$)/,'documents'],
  [/^(?:discussion_|communication_|ticket_|notification_read$)/,'communications'],
  [/^(?:invoice_|payment_|fee_schedule_|budget_|wip_report$|statement$|staff_rate_)/,'billing_wip'],
];

export function areaForStaffAction(action){
  if(typeof action!=='string'||!action||action==='workspace'||action==='logout'||action==='session_activity')return null;
  for(const [pattern,area] of PREFIX_AREAS)if(pattern.test(action))return area;
  return null;
}

export function staffAreaCanUse(role,restricted,area){
  return AREA_CODES.includes(area)&&effectiveStaffAreas(role,restricted).includes(area);
}

export function filterWorkspaceAccess(workspace,areas){
  const allowed=new Set(areas),w={...workspace,me:{...workspace.me,allowed_areas:[...allowed]}};
  if(!allowed.has('projects')){
    for(const key of ['projects','tasks','assignments','schedules','work_periods','work_period_tasks','task_procedures','sales_reviews','task_events','workbook_batches'])w[key]=[];
  }
  if(!allowed.has('documents'))w.documents=[];
  if(!allowed.has('time_hr'))w.timesheets=[];
  if(!allowed.has('communications'))w.notifications=[];
  if(!allowed.has('staff_access')){w.staff=[];w.staff_firms=[];}
  if(!allowed.has('settings')){
    w.firms=(w.firms||[]).map(({firm_id,firm_code,legal_name})=>({firm_id,firm_code,legal_name}));
    w.sectors=[];
  }
  if(!allowed.has('clients')){
    const linked=new Set((w.projects||[]).map(p=>p.client_id));
    w.clients=(w.clients||[]).filter(c=>linked.has(c.client_id)).map(c=>({client_id:c.client_id,company_name:c.company_name}));
    w.client_firms=[];
  }
  const s={...(w.suite||{})};
  if(!allowed.has('leads'))s.leads=[];
  if(!allowed.has('clients'))for(const key of ['tax_profiles','contacts','compliance','owners','engagements'])s[key]=[];
  if(!allowed.has('billing_wip'))for(const key of ['rates','staff_rates','budgets','recurring_fees','invoices','payments'])s[key]=[];
  if(!allowed.has('settings'))s.rates=[];
  if(!allowed.has('projects'))s.tax_cases=[];
  if(!allowed.has('communications'))for(const key of ['communications','tickets'])s[key]=[];
  if(!allowed.has('time_hr'))for(const key of ['leave','attendance','credentials','reviews'])s[key]=[];
  w.suite=s;
  return w;
}
