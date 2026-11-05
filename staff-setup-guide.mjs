export function openingProgress({openingStatus,sourceStaged=false,journal=null,lines=[],journalIssues=[],openingDifference=0,detailsAvailable=false}){
 if(openingStatus==='No opening balances')return {notApplicable:true,staged:false,imported:false,balanced:false,awaitingReview:false,posted:false,label:'No opening balances apply',blocker:''};
 const staged=!!sourceStaged,imported=!!journal;
 if(!journal)return {notApplicable:false,staged,imported:false,balanced:false,awaitingReview:false,posted:false,label:staged?'Staged':'Not started',blocker:staged?'Import the staged prior-year closing TB into the client financial year.':'After the client year exists, upload and map the approved prior-year closing TB, or record that no opening balances apply.'};
 const debit=lines.reduce((n,x)=>n+Number(x.debit||0),0),credit=lines.reduce((n,x)=>n+Number(x.credit||0),0),journalBalanced=detailsAvailable&&Math.abs(debit-credit)<=.01,balanced=journalBalanced&&!journalIssues.length&&Math.abs(Number(openingDifference||0))<=.01;
 const posted=journal.status==='Posted',awaitingReview=journal.status==='Submitted';
 let label='Imported',blocker='Correct the opening entry issues before sending it for review.';
 if(posted){label=balanced?'Posted':detailsAvailable?'Posted · TB check needed':'Posted · balance check unavailable';blocker=balanced?'':detailsAvailable?'The posted opening balances do not currently tie; investigate the trial balance before relying on reports.':'The ERP could not load the posted entry details to verify the balance.';}
 else if(awaitingReview){label='In review';blocker=balanced?'A different Manager or Partner reviews the mappings and journal together, then posts in one action.':detailsAvailable?'Resolve the opening entry issues before independent review.':'The ERP could not load the draft details to verify the balance.';}
 else if(journal.status==='Returned'){label='Returned for correction';blocker='Update the returned opening entry, then resubmit it for independent review.';}
 else if(balanced){label='Balanced';blocker='Submit this balanced draft for independent review.';}
 return {notApplicable:false,staged,imported,balanced,awaitingReview,posted,label,blocker,debit,credit,journalStatus:journal.status,journalBalanced};
}

export function createSetupGuideUI(ctx){
 const {modal,request,esc,shortDate}=ctx,$=ctx.$,d=ctx.data;
 const money=n=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(n||0));
 const activeProject=clientId=>ctx.filtered().projects.filter(p=>p.client_id===clientId&&p.status!=='Archived').sort((a,b)=>Number(!!b.tax_master)-Number(!!a.tax_master))[0]||null;
 const action=(name,label,id='')=>`<button type="button" data-setup-guide-action="${name}" data-id="${esc(id)}">${esc(label)}</button>`;
 const status=(ready,label)=>`<span class="badge ${ready?'good':'warn'}">${esc(label)}</span>`;
 const list=items=>items?.length?`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
 function step(title,state,detail,buttons='',content=''){return `<section class="card section-space"><div class="section-head"><h3>${esc(title)}</h3>${status(state.ready,state.label)}</div><p>${esc(detail)}</p>${content}${state.blocker?`<p class="missing"><b>Next / blocker:</b> ${esc(state.blocker)}</p>`:''}${state.issues?.length?list(state.issues):''}${buttons?`<div class="actions">${buttons}</div>`:''}</section>`;}
 function openingTimeline(opening){
  if(opening.notApplicable)return '<p class="info"><b>Not applicable:</b> the client has confirmed there are no opening balances.</p>';
  const stages=['Staged','Mapped & imported','Balanced','Submitted','Reviewed & posted'],current=opening.posted?4:opening.awaitingReview?3:opening.balanced?2:opening.imported?1:opening.staged?0:-1;
  return `<ol aria-label="Opening trial balance progress">${stages.map((label,i)=>{const done=i<current||opening.posted&&opening.balanced&&i===current,active=i===current;return `<li>${status(done,done?'Complete':active?opening.label:'To do')}${active?'':` ${esc(label)}`}</li>`;}).join('')}</ol>`;
 }

 async function open(clientId){
  const client=d().clients.find(c=>c.client_id===clientId);if(!client)return;
  const project=activeProject(clientId),documents=d().documents.filter(x=>x.client_id===clientId&&!x.archived_at&&!x.deleted_at),openingSource=documents.find(x=>x.import_purpose==='Opening TB'&&(!project||!x.handling_firm_id||x.handling_firm_id===project.handling_firm_id));
  if($('#editor').open)$('#editor').close();
  modal('Complete setup and reporting',`<p class="muted">${esc(client.company_name)} · Read-only checklist. This screen does not import, approve, post, activate or file anything. Complete the steps in order; open only the action you need.</p><p class="info">One preparer uploads, maps and imports the prior-year closing TB in one sitting. A different Manager or Partner reviews mapping changes and the opening journal together, then approves and posts once. Only posted entries feed reports and tax checks; Import Sources are not evidence.</p><div id="setupGuideContent" aria-live="polite"><p>Checking the client setup and latest ledger status…</p></div>`);
  try{
   let accountRead=null,projectReport=null,periods=[],latestPeriod=null,ledger=null,openingDetail=null,requestErrors=[];
   if(project){
    const results=await Promise.allSettled([request({action:'v3_client_accounts_read',client_id:clientId}),request({action:'project_report',project_id:project.project_id}),request({action:'ledger_periods',project_id:project.project_id})]);
    if(results[0].status==='fulfilled')accountRead=results[0].value;else requestErrors.push('Client account mapping status could not be loaded.');
    if(results[1].status==='fulfilled')projectReport=results[1].value;else requestErrors.push('Project source status could not be loaded.');
    if(results[2].status==='fulfilled')periods=results[2].value.periods||[];else requestErrors.push('Client financial year status could not be loaded.');
    latestPeriod=[...periods].sort((a,b)=>String(b.starts_on).localeCompare(String(a.starts_on)))[0]||null;
    if(latestPeriod){try{ledger=await request({action:'ledger_read',project_id:project.project_id,period_id:latestPeriod.period_id});const opening=ledger.journals.find(j=>j.kind==='Opening');if(opening)openingDetail=await request({action:'ledger_journal_read',project_id:project.project_id,period_id:latestPeriod.period_id,journal_id:opening.journal_id});}catch{requestErrors.push('Posted ledger checks could not be loaded.');}}
   }else{
    try{accountRead=await request({action:'v3_client_accounts_read',client_id:clientId});}catch{requestErrors.push('Client account mapping status could not be loaded.');}
   }
   if(!$('#setupGuideContent')||!$('#editor').open)return;
   const $content=$('#setupGuideContent'),identityIssues=[...(client.missing_fields||[]).map(x=>`${x} is missing.`),...(!client.legal_entity_type?['Legal entity type is missing.']:[]),...(String(client.entity_evidence||'').trim().length<10?['Add the supporting legal-entity source (at least 10 characters).']:[]),...(!client.year_end_month||!client.year_end_day?['Confirm the client financial year-end.']:[])].filter((x,i,a)=>a.indexOf(x)===i);
   const profileReady=identityIssues.length===0;
   const profileState={ready:profileReady,label:profileReady?'Complete':'Needs completion',blocker:profileReady?'':'Complete the legal entity, source and year-end before setting up ledger periods.',issues:identityIssues};
   let mappings=accountRead?.mappings||[],targetDate=periods[0]?.starts_on||project?.schedule_starts_on||new Date().toISOString().slice(0,10),covered=mappings.filter(x=>x.status==='Active'&&String(x.effective_from).slice(0,10)<=targetDate&&(!x.effective_to||String(x.effective_to).slice(0,10)>=targetDate)),drafts=mappings.filter(x=>x.status==='Draft'),mappingIssues=[],pendingSetup=accountRead?.pending_setup_changes||[];
   // A client activity change that is still waiting for a Manager or Partner holds back the general account mappings, so it comes first.
   if(pendingSetup.length){const c=pendingSetup[0],names=[...new Set((c.preview?.activities_to_add||[]).map(x=>String(x.activity_name||x.activity_code||'').replace(/_/g,' ')).filter(Boolean))];mappingIssues.push(`Waiting for approval: a client activity change${names.length?` (${names.join(', ')})`:''} was submitted by ${c.submitted_by_name} on ${shortDate(c.submitted_at)}. A different Manager or Partner must approve it before general account mappings can be set up. They have been notified and it is on their Home list under Waiting for my review.`);}
   if(!accountRead)mappingIssues.push('Mapping details are unavailable; reopen the guide or ask a Manager to check access.');
   else if(!covered.length&&!pendingSetup.length)mappingIssues.push(`Add a dated general account mapping before purchase imports. This does not block opening TB import; those accounts are mapped with the TB.`);
   if(drafts.length)mappingIssues.push(`${drafts.length} general client account mapping(s) are still drafts and need independent approval.`);
   const rentMapping=mappings.find(x=>String(x.source_account_code)==='61000'||String(x.erp_account_code)==='61000'),rentSummary=rentMapping?` · 61000 ${rentMapping.status==='Active'?'approved':'not approved yet'}`:'',mappingState={ready:!!covered.length&&!drafts.length,label:accountRead?`${covered.length} general mappings active for ${shortDate(targetDate)}${drafts.length?` · ${drafts.length} awaiting review`:''}`:'Status unavailable',blocker:mappingIssues[0]||'',issues:mappingIssues.slice(1)};
   const sourceStaged=!!(projectReport?.opening?.source_staged||openingSource),openingJournal=ledger?.journals?.find(j=>j.kind==='Opening')||null;
   const openingDifference=ledger?.tb?.reduce((n,x)=>n+Number(x.opening||0),0)||0;
   const opening=openingProgress({openingStatus:client.opening_balance_status,sourceStaged,journal:openingJournal,lines:openingDetail?.lines||[],journalIssues:openingDetail?.issues||[],openingDifference,detailsAvailable:!!openingDetail});
   const openingBlocker=!opening.notApplicable&&!periods.length&&sourceStaged?'Create the draft project and verified client financial year before importing the staged TB.':opening.blocker;
   const openingState={ready:opening.notApplicable||opening.posted&&opening.balanced,label:opening.label,blocker:openingBlocker,issues:[...(openingDetail?.issues||[]),...(openingJournal&&opening.journalBalanced===false?[`Opening journal debits ${money(opening.debit)} and credits ${money(opening.credit)}.`]:[])]};
   const yearState={ready:periods.length>0,label:periods.length?`${periods.length} client financial year${periods.length===1?'':'s'}`:'No client year yet',blocker:periods.length?'':'Create the client year using the confirmed financial year-end before importing the opening TB.'};
   const taxProfile=(d().suite?.tax_profiles||[]).find(x=>x.client_id===clientId&&x.status==='Verified'),pending=ledger?.pending_sources||[],unmapped=pending.filter(x=>!x.account_code),unconfirmed=pending.filter(x=>x.decision!=='Confirmed'||String(x.source_revision)!==String(x.revision)),ppe=ledger?.ppe_sources||[],notApprovedAssets=(ledger?.assets||[]).filter(x=>x.status!=='Approved'),periodImports=(projectReport?.period_imports||[]).filter(x=>x.status!=='Superseded'),payrollImports=periodImports.filter(x=>x.kind==='Payroll');
   const importedRows=(projectReport?.imports||[]).reduce((n,x)=>n+Number(x.imported||0),0),sourceIssues=[];
   if(!project)sourceIssues.push('Create a draft project, then set up the client year before importing the opening TB.');
   else if(!periods.length)sourceIssues.push('No ledger period exists yet, so mapped rows cannot be reconciled or posted.');
   if(ledger?.pending_truncated)sourceIssues.push('More than 2,000 rows are pending; post in batches and refresh the checklist.');
   else if(pending.length)sourceIssues.push(`${pending.length} imported purchase / expenditure / sales row(s) are not posted.`);
   if(unmapped.length)sourceIssues.push(`${unmapped.length} pending row(s) have no ERP account selected.`);
   if(unconfirmed.length)sourceIssues.push(`${unconfirmed.length} pending row(s) still need review or reconfirmation.`);
   if(ppe.length)sourceIssues.push(`${ppe.length} PPE purchase(s) need asset details and a shared-rate record.`);
   if(notApprovedAssets.length)sourceIssues.push(`${notApprovedAssets.length} asset record(s) are not yet independently approved.`);
   if(taxProfile?.obligations?.some(x=>['PAYE','Payroll'].includes(x))&&projectReport?.accounting_available&&!payrollImports.length)sourceIssues.push('PAYE / payroll applies, but no saved payroll import is recorded. Reopen Sales / payroll imports, preview the approved workbook and save it before reporting.');
   const summaryImportIssue=(ledger?.issues||[]).find(x=>/sales\/payroll summary import/i.test(x));if(summaryImportIssue)sourceIssues.push(summaryImportIssue);
   for(const issue of ledger?.issues||[])if(!/opening balances are not yet independently posted/i.test(issue)&&!sourceIssues.includes(issue))sourceIssues.push(issue);
   const sourceReady=!!ledger&&!sourceIssues.length;
   const sourceState={ready:sourceReady,label:ledger?`${pending.length}${ledger.pending_truncated?'+':''} rows awaiting posting · ${ppe.length} PPE details needed`:`${importedRows} source row(s) imported; ledger status unavailable`,blocker:sourceIssues[0]||(!ledger?'Open the client ledger to inspect source rows.':''),issues:sourceIssues.slice(1)};
   const taxCases=(d().suite?.tax_cases||[]).filter(x=>x.project_id===project?.project_id),taxKinds=[...new Set(taxCases.map(x=>x.kind))],ledgerIssues=ledger?.issues||[],requiredIncomeKind=({ 'Limited company':'Company','Sole proprietor':'Individual',Partnership:'Partnership'})[client.legal_entity_type],reportingIssues=[];
   if(!taxProfile)reportingIssues.push('No verified client tax profile is available. Confirm the client’s applicable obligations before preparing reports.');
   if(taxProfile?.obligations?.includes('VAT')&&!taxCases.some(x=>x.kind==='VAT'))reportingIssues.push('No VAT period yet, although VAT is listed as an applicable client obligation.');
   if(requiredIncomeKind&&!taxCases.some(x=>x.kind===requiredIncomeKind))reportingIssues.push(`No ${requiredIncomeKind} Income Tax period yet for this legal entity.`);
   const unreviewedTaxCases=taxCases.filter(x=>!['Locked','Filed'].includes(x.status));
   for(const item of unreviewedTaxCases)reportingIssues.push(`${item.kind} · ${shortDate(item.starts_on)}–${shortDate(item.ends_on)} is ${item.status}. Open the filing pack, run the current preview, resolve its issues and complete independent review.`);
   if(!taxCases.length)reportingIssues.push('No tax periods yet. Create the required period using the client reporting dates.');if(!ledger)reportingIssues.push('The ledger report is not available until a client year has been set up.');else if(ledgerIssues.length)reportingIssues.push(...ledgerIssues);
   if(ledger&&ledger.tb){const difference=ledger.tb.reduce((n,x)=>n+Number(x.net||0),0);if(Math.abs(difference)>.01)reportingIssues.push(`Posted trial balance difference is ${money(difference)}.`);}
   const reportsReady=!!ledger&&!reportingIssues.length;
   const reportState={ready:reportsReady,label:taxCases.length?`${taxKinds.join(', ')} period(s) · ${reportsReady?'Ready for review':'Not ready'}`:'Not ready',blocker:reportingIssues[0]||'',issues:reportingIssues.slice(1)};
   const projectTasks=d().tasks.filter(t=>t.project_id===project?.project_id),openTasks=projectTasks.filter(t=>!['Completed','Cancelled'].includes(t.status));
   const projectReady=!!project&&project.status==='Active'&&opening.ready&&reportsReady;
   const projectState={ready:projectReady,label:project?`${project.status}${project.status==='Draft'&&openTasks.length?` · ${openTasks.length} earlier UAT carry-over tasks`:''}`:'No project',blocker:!project?'Create a Draft project and client year first; task release stays held until the opening TB is posted and engagement checks are complete.':project.status==='Draft'?'Keep task release held. A Manager or Partner should activate only after the opening balance and engagement checks are complete.':!opening.ready?'Opening balance gate is not complete.':!reportsReady?'Complete source posting and reporting checks before handover.':'Project is active; continue monitoring scheduled work.'};
   const projectButtons=project?action('project','Open project',project.project_id):action('projects','Create Draft project');
   const sourceButtons=project?(action('purchases','Review purchase mapping',project.project_id)+action('period-imports','Review sales / payroll imports',project.project_id)+action('ledger','Open client accounting',project.project_id)):'';
   const openingButtons=opening.notApplicable?'':openingJournal&&project&&latestPeriod?action('opening-journal',opening.awaitingReview?'Review, approve & post opening TB':'Continue opening TB',`${project.project_id}|${latestPeriod.period_id}|${openingJournal.journal_id}`):project&&latestPeriod?.status==='Open'&&sourceStaged?action('opening-import','Map & import opening TB',`${project.project_id}|${latestPeriod.period_id}`):project&&latestPeriod?.status==='Open'?action('opening-upload-import','Upload, map & import opening TB',`${project.project_id}|${latestPeriod.period_id}`):project?action('ledger','Create client year',project.project_id):action('projects','Create Draft project');
   const taxButton=action('tax-periods','Open tax periods');
   const currentYearStart=periods[0]?.starts_on||project?.schedule_starts_on||'',currentYearEnd=periods[0]?.ends_on||project?.schedule_ends_on||'',currentYearLabel=currentYearStart&&currentYearEnd?`${shortDate(currentYearStart)} – ${shortDate(currentYearEnd)}`:periods.length?'Year dates unavailable':'Not set';
   const salesImportText=periodImports.filter(x=>x.kind==='Sales').map(x=>`Sales ${shortDate(x.starts_on)}–${shortDate(x.ends_on)} · ${x.status} · ${Number(x.source_rows||0)} source row(s)`),payrollImportText=projectReport?.accounting_available===false?['Payroll details are restricted for this access role']:payrollImports.map(x=>`Payroll ${shortDate(x.starts_on)}–${shortDate(x.ends_on)} · ${x.status} · ${Number(x.source_rows||0)} source row(s)`),savedImports=[...salesImportText,...payrollImportText].join('; ')||'No saved sales / payroll summary imports.';
   $content.innerHTML=`<p class="info"><b>Current client year:</b> ${esc(currentYearLabel)} · <b>Handling project:</b> ${project?esc(project.project_name)+' · '+esc(project.status):'Not created'}</p>
    ${step('1 · Client profile & financial year',profileState,profileReady?'Client identity and reporting year are saved.':`Complete ${identityIssues.length} profile item(s) before creating ledger work.`,action('profile','Open client setup',clientId)+projectButtons)}
    ${step('2 · General account mappings',mappingState,accountRead?`${mappings.length} total mappings · ${covered.length} general mappings active for the client year · ${drafts.length} drafts${rentSummary}. Purchase mappings keep their dated independent review. Opening TB accounts are mapped during import and activate when the reviewer posts the opening journal.`:'Mapping status could not be confirmed.',(pendingSetup.length?action('setup-change','Review pending activity change',clientId):'')+action('accounts','Review general account mappings',clientId))}
    ${step('3 · Opening trial balance',openingState,opening.notApplicable?'The client is recorded as having no opening balances.':`Client year: ${yearState.label}. Current state: ${opening.label}. ${opening.debit!=null?`Debits ${money(opening.debit)} · Credits ${money(opening.credit)}.`:''}`,openingButtons,openingTimeline(opening))}
    ${step('4 · Purchases, sales, payroll & assets',sourceState,project?`${importedRows} source row(s) imported from project workbooks. Saved summary imports: ${savedImports} Unsaved payroll previews are not stored in this checklist; reopen Sales / payroll imports and preview again before saving. Source uploads stay in Import Sources and do not count as evidence or post accounting entries.`:'Create a Draft project and client year first; new tasks stay locked until opening balances and engagement checks are complete.',sourceButtons)}
    ${step('5 · VAT, Income Tax & Source and Application',reportState,`${taxCases.length?`${taxCases.length} tax period(s) currently set up: ${taxKinds.join(', ')}.`:'No tax periods yet.'} Reports must reconcile to the posted trial balance; the Source and Application schedule is checked with the annual Income Tax review. Locked / Filed periods have completed an independent review; filing remains a separate staff task.`,taxButton)}
    ${step('6 · Project release & handover',projectState,project?`Project status is ${project.status}. ${project.status==='Draft'?`${openTasks.length} existing task(s) are earlier UAT carry-over; they do not release new tasks.`:'Review the latest reporting and engagement checks before staff handover.'}`:'Create a Draft project and client year, then import the opening TB. Task release and financial outputs stay gated until review.',projectButtons+action('clients','Back to clients'))}
    ${requestErrors.length?`<section class="info"><b>Some checks could not be loaded.</b>${list(requestErrors)}</section>`:''}
    <p class="muted">This guide is a status summary, not an approval. It does not import or post balances, activate projects, calculate a tax liability, or file a return. The preparer maps and imports the opening TB; an independent Manager or Partner reviews mappings and journal together and posts once. Reports use posted entries only. Repeat the same checks for each test client; complete Wholesale first, then Construction.</p>`;
  }catch(error){if($('#editor').open)$('#setupGuideContent').innerHTML=`<p class="missing">Could not load this checklist: ${esc(error.message)}</p><button type="button" data-setup-guide-retry="${esc(clientId)}">Retry checks</button>`;}
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-setup-guide-action],[data-setup-guide-retry]');if(!b)return;const a=b.dataset.setupGuideAction,id=b.dataset.id||b.dataset.setupGuideRetry;
  try{
   if(b.dataset.setupGuideRetry){await open(id);return;}
   $('#editor').close();
   if(a==='profile')await ctx.openClientSettings(id);
   if(a==='accounts')await ctx.openClientAccounts(id);
   if(a==='setup-change')await ctx.openClientSettings(id);
   if(a==='stage-opening')await ctx.stageOpening(id);
   if(a==='ledger')await ctx.openLedger(id);
   if(a==='opening-import'){const [projectId,periodId]=id.split('|');await ctx.openOpeningImport(projectId,{project_id:projectId,period_id:periodId});}
   if(a==='opening-upload-import'){const [projectId,periodId]=id.split('|');await ctx.uploadOpeningAndImport(projectId,periodId);}
   if(a==='opening-journal'){const [projectId,periodId,journalId]=id.split('|');await ctx.openOpeningJournal(projectId,periodId,journalId);}
   if(a==='purchases')await ctx.openPurchases(id);
   if(a==='period-imports')await ctx.openPeriodImports(id);
   if(a==='tax-periods')ctx.openTaxPeriods();
   if(a==='project')ctx.openProject(id);
   if(a==='projects')ctx.openProjects();
   if(a==='clients')ctx.openClients();
  }catch(error){ctx.notice(error.message,true);}
 });
 return {open};
}
