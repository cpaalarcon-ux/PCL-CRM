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
// System Administrators run logins, chat groups and system settings (sectors, private reference documents, go-live readiness).
// They see no client, project, document, ledger or finance area, and cannot approve anything.
const ADMIN_AREAS=['communications','staff_access','settings'];

export function defaultStaffAreas(role){
  if(role==='PARTNER'||role==='MANAGER')return [...LEADER_AREAS];
  if(role==='SUPERVISOR'||role==='ASSISTANT')return [...TEAM_AREAS];
  if(role==='INTERN')return [...INTERN_AREAS];
  if(role==='ADMIN')return [...ADMIN_AREAS];
  return [];
}

export function effectiveStaffAreas(role,restricted=[]){
  const denied=new Set(Array.isArray(restricted)?restricted:[]);
  return defaultStaffAreas(role).filter(code=>!denied.has(code));
}

const PREFIX_AREAS=[
  [/^lead_/, 'leads'],
  [/^(?:staff_save|staff_disable|staff_access_|staff_right_|staff_rights_|account_link|master_staff_)/,'staff_access'],
  [/^(?:firm_save|firm_details|firm_logo|sector_save|reference_|holiday_|policy_(?:sign|revoke)|rate_(?:save|approve|impact|test|legal_confirm)|release_(?:check_save|read))/, 'settings'],
  [/^(?:client_save|client_proposal_|client_classify_|compliance_|edd_approve|owner_add|contact_save|tax_profile_|v3_client_|v3_identity_|v3_activity_|v3_activities_|v3_stock_|v3_vat_|v3_category_|v3_bank_|v3_opening_balance|v3_partners_add)/,'clients'],
  [/^(?:task_|project_|schedule_|generate_tasks|engagement_|procedure_|accounting_|ledger_|purchase_ledger_|non_etims_|workbook_|period_import_|wht_|tax_|work_|sales_|v3_mapping_|v3_project_|v3_review_|v3_export_|v3_period_add|v3_suggestions|suite_export)/,'projects'],
  [/^audit_/, 'audit'],
  [/^(?:presence_|timer_|clock$|attendance_|leave_|roster_|performance_|credential_|timesheet_)/,'time_hr'],
  [/^(?:document_|upload$|download$|master_preview$|master_import$)/,'documents'],
  [/^(?:discussion_|communication_|ticket_|notification_read$)/,'communications'],
  [/^(?:invoice_|payment_|advance_|billing_|fee_schedule_|budget_|wip_report$|statement$|staff_rate_|metrics_)/,'billing_wip'],
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
    w.proposals=[];
    const linked=new Set((w.projects||[]).map(p=>p.client_id));
    w.clients=(w.clients||[]).filter(c=>linked.has(c.client_id)).map(c=>({client_id:c.client_id,company_name:c.company_name}));
    w.client_firms=[];
  }
  const s={...(w.suite||{})};
  if(!allowed.has('leads'))s.leads=[];
  if(!allowed.has('clients'))for(const key of ['tax_profiles','contacts','compliance','owners','kyc_evidence','kyc_changes','engagements'])s[key]=[];
  if(!allowed.has('billing_wip'))for(const key of ['rates','staff_rates','budgets','recurring_fees','invoices','payments'])s[key]=[];
  if(!allowed.has('settings'))s.rates=[];
  if(!allowed.has('projects'))s.tax_cases=[];
  if(!allowed.has('communications'))for(const key of ['communications','tickets'])s[key]=[];
  if(!allowed.has('time_hr'))for(const key of ['leave','attendance','credentials','reviews'])s[key]=[];
  w.suite=s;
  return w;
}

export function scopeWorkspaceRecords(workspace,role,staffId){
  // Supervisors see only assigned or explicitly routed review work. Firm-wide
  // visibility is reserved for Partners and Managers; RLS still limits both.
  const fullAccess=['PARTNER','MANAGER'].includes(role);
  const projects=Array.isArray(workspace.projects)?workspace.projects:[];
  const tasks=Array.isArray(workspace.tasks)?workspace.tasks:[];
  const procedures=Array.isArray(workspace.task_procedures)?workspace.task_procedures:[];
  const schedules=Array.isArray(workspace.schedules)?workspace.schedules:[];
  const assignments=Array.isArray(workspace.assignments)?workspace.assignments:[];
  const clients=Array.isArray(workspace.clients)?workspace.clients:[];
  if(fullAccess)return {...workspace,clients:clients.map(c=>({...c,details_visible:true}))};
  const intern=role==='INTERN';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
  const allocatedProjectIds=new Set(intern?[]:assignments.filter(a=>a.staff_id===staffId&&(!a.start_date||String(a.start_date).slice(0,10)<=today)&&(!a.end_date||String(a.end_date).slice(0,10)>=today)).map(a=>a.project_id));
  const ownedTaskIds=new Set(tasks.filter(t=>t.assigned_to===staffId).map(t=>t.task_id));
  const reviewTaskIds=new Set(intern?[]:procedures.filter(p=>p.reviewer_id===staffId&&p.prepared_by!==staffId).map(p=>p.task_id));
  const reviewProjects=new Set(intern?[]:schedules.filter(s=>s.reviewer_id===staffId).map(s=>s.project_id));
  const reviewScheduleTaskIds=new Set(tasks.filter(t=>reviewProjects.has(t.project_id)&&t.status==='In Review').map(t=>t.task_id));
  const taskAccessIds=new Set([...ownedTaskIds,...reviewTaskIds,...reviewScheduleTaskIds]);
  const visibleProjectIds=new Set([...allocatedProjectIds,...tasks.filter(t=>taskAccessIds.has(t.task_id)).map(t=>t.project_id)]);
  const visibleProjects=projects.filter(p=>visibleProjectIds.has(p.project_id));
  const visibleClientIds=new Set(visibleProjects.map(p=>p.client_id));
  const visibleTasks=tasks.filter(t=>visibleProjectIds.has(t.project_id)&&(allocatedProjectIds.has(t.project_id)||taskAccessIds.has(t.task_id)));
  const visibleTaskIds=new Set(visibleTasks.map(t=>t.task_id));
  const visiblePeriods=(workspace.work_periods||[]).filter(w=>visibleProjectIds.has(w.project_id));
  const visiblePeriodIds=new Set(visiblePeriods.map(w=>w.work_period_id));
  const scoped={...workspace,
    projects:visibleProjects,
    tasks:visibleTasks,
    clients:intern?clients.filter(c=>visibleClientIds.has(c.client_id)).map(c=>({...c,details_visible:true})):clients.map(c=>visibleClientIds.has(c.client_id)?({...c,details_visible:true}):({client_id:c.client_id,company_name:c.company_name,details_visible:false})),
    assignments:assignments.filter(a=>visibleProjectIds.has(a.project_id)&&(a.staff_id===staffId||allocatedProjectIds.has(a.project_id))),
    schedules:schedules.filter(s=>visibleProjectIds.has(s.project_id)),
    work_periods:visiblePeriods,
    work_period_tasks:(workspace.work_period_tasks||[]).filter(x=>visiblePeriodIds.has(x.work_period_id)&&visibleTaskIds.has(x.task_id)),
    task_procedures:procedures.filter(x=>visibleTaskIds.has(x.task_id)),
    sales_reviews:(workspace.sales_reviews||[]).filter(x=>visibleProjectIds.has(x.project_id)),
    task_events:(workspace.task_events||[]).filter(x=>visibleTaskIds.has(x.task_id)),
    workbook_batches:(workspace.workbook_batches||[]).filter(x=>visibleProjectIds.has(x.project_id)),
    documents:(workspace.documents||[]).filter(x=>(x.project_id&&visibleProjectIds.has(x.project_id))||(x.task_id&&visibleTaskIds.has(x.task_id))||(!x.project_id&&!x.task_id&&visibleClientIds.has(x.client_id))),
    timesheets:(workspace.timesheets||[]).filter(x=>visibleProjectIds.has(x.project_id)&&x.staff_id===staffId),
    notifications:(workspace.notifications||[]).filter(x=>!x.task_id||visibleTaskIds.has(x.task_id)),
    suite:{...(workspace.suite||{})}
  };
  for(const [key,value] of Object.entries(scoped.suite)){
    if(!Array.isArray(value))continue;
    if(value.some(row=>row&&Object.prototype.hasOwnProperty.call(row,'project_id')))scoped.suite[key]=value.filter(row=>!row?.project_id||visibleProjectIds.has(row.project_id));
    else if(value.some(row=>row&&Object.prototype.hasOwnProperty.call(row,'client_id')))scoped.suite[key]=value.filter(row=>!row?.client_id||visibleClientIds.has(row.client_id));
  }
  if(!fullAccess)for(const key of ['leave','attendance','credentials','reviews'])if(Array.isArray(scoped.suite[key]))scoped.suite[key]=scoped.suite[key].filter(row=>row.staff_id===staffId);
  if(intern){scoped.assignments=[];scoped.schedules=scoped.schedules.filter(s=>visibleTaskIds.size>0&&visibleProjectIds.has(s.project_id));}
  return scoped;
}
