// Audit build S7: one home for every audit file.
// The model below is pure: it reads the snapshot the server already sends and works out the five sections,
// the traffic lights, the blocking sign-offs and the single next step. It never decides anything itself.
import {auditFlagHtml} from './staff-licences.mjs?v=20261110-filing-v1';
export const SECTIONS=[
 {key:'setup',title:'Set-up',tabs:['Materiality & risk','SASRA & quality']},
 {key:'managing',title:'Managing',tabs:['Time & billing','Issues']},
 {key:'papers',title:'Working papers',tabs:['Trial balance','Adjustments','Lead schedules','Populations','SACCO statements','SACCO audit pack','Analytics','Working papers']},
 {key:'completion',title:'Completion',tabs:['Reports','Completion']},
 {key:'archive',title:'Archive & templates',tabs:['Assembly & milestones','Template register']}
];
const n=v=>Number(v||0);
export function sectionOf(tab){return SECTIONS.find(x=>x.tabs.includes(tab))?.key||'home';}
export function sectionTabs(key,hasSasra){const sec=SECTIONS.find(x=>x.key===key);return sec?sec.tabs.filter(t=>(t!=='SASRA & quality'&&t!=='SACCO statements'&&t!=='SACCO audit pack')||hasSasra):[];}
// Items: state is done | todo | blocked | na. "blocked" means a concrete problem, not just work still to do.
export function homeModel(s,me={}){
 const file=s?.file;
 if(!file)return null;
 const role=me.category_code||'',myId=me.staff_id;
 const read=s.readiness||{},gate=planningGate(s.planning_gate),sasra=s.sasra||null;
 const wps=s.workpapers||[],adj=s.adjustments||[],leads=s.lead_schedule||[],alerts=s.analytics_alerts||[],runs=s.analytics_runs||[],points=s.mgmt_points||[];
 const reports=s.reports||[],rstat=s.report_status||[],comp=s.completion||[],ms=s.misstatements||null,time=s.time_summary||null;
 const openAlerts=alerts.filter(a=>a.status==='Open'),highAlerts=openAlerts.filter(a=>a.severity==='High');
 const openPoints=points.filter(p=>p.status==='Open');
 const pops=(s.populations||[]).filter(x=>x.status!=='Withdrawn'),popPolicy=s.population_policy||null,requiredAreas=(popPolicy?.areas||[]);
 const pendingAdj=adj.filter(a=>['Draft','Submitted','Returned'].includes(a.status));
 const activeLeads=leads.filter(l=>l.active),missingLeads=activeLeads.filter(l=>!l.lead),badTie=leads.filter(l=>l.lead&&['Not stated','Difference'].includes(l.lead.tie));
 const reqReports=rstat.filter(x=>x.required),okReports=reqReports.filter(x=>x.approved_report_id&&x.current);
 const staleReports=reqReports.filter(x=>x.approved_report_id&&!x.current),missingReports=reqReports.filter(x=>!x.approved_report_id);
 const compDone=comp.filter(x=>x.status==='Reviewed').length;
 const mat=!!gate.materiality;
 const popProblem=x=>x.state==='Difference'?`${x.pop_ref} for ${x.audit_area} differs from the adjusted trial balance by ${x.residual} after reconciling items`:x.state==='Needs note'?`${x.pop_ref} for ${x.audit_area} has reconciling items without a note of at least 20 characters`:'';
 const popMissing=requiredAreas.filter(a=>activeLeads.some(l=>l.audit_area===a)&&!pops.some(x=>x.audit_area===a&&x.status==='Approved'));
 const popBad=pops.filter(x=>popProblem(x)),popOpen=pops.filter(x=>x.status!=='Approved');
 const exceeds=!!(ms&&ms.exceeds_overall),concluded=!!(ms&&ms.conclusion&&ms.conclusion.current);
 const eq=sasra?.eqcr||null,eqRequired=!!eq?.required,eqApproved=!!eq?.approved;
 const ratios=sasra?.ratios||[],breaches=ratios.filter(r=>r.state==='Breach'),unack=breaches.filter(r=>!r.acknowledged);
 const sIssues=(sasra?.issues||[]).map(String);
 const eligIssues=sIssues.filter(x=>/eligibility/i.test(x)),eqIssues=sIssues.filter(x=>/EQCR/.test(x)),stmtIssues=sIssues.filter(x=>/SACCO statement layout|Section 10 item|audit programme|programme step|compliance register|compliance item|^Matter TM-/.test(x)),ratioIssues=sIssues.filter(x=>!eligIssues.includes(x)&&!eqIssues.includes(x)&&!stmtIssues.includes(x));
 const pack=s.pack||null,packSteps=pack?.file_steps||[],packStepsOpen=packSteps.filter(x=>x.required&&x.status!=='Reviewed'),packComp=pack?.compliance||[],packCompOpen=packComp.filter(x=>x.status!=='Reviewed'),packMatters=(pack?.matters||[]).filter(m=>m.status==='Active'),packUndecided=packMatters.filter(m=>!m.decision||m.decision_stale),packProgOk=(pack?.programmes||[]).some(x=>x.status==='Approved'),packItemsOk=(pack?.compliance_items||[]).some(x=>x.status==='Approved');
 const sacco=s.sacco||null,saccoBlock=(sacco?.preview?.blocking||[]).map(String),saccoChecks=sacco?.preview?.checks||[],saccoUnreviewed=saccoChecks.filter(c=>c.status!=='Reviewed');
 const it=(key,label,state,detail,tab,owner)=>({key,label,state,detail:detail||'',tab,owner:owner||''});

 const items={setup:[],managing:[],papers:[],completion:[],archive:[]};
 items.setup.push(it('framework','Reporting framework confirmed',read.framework_approved?'done':'todo','','Overview','Partner'));
 items.setup.push(it('materiality','Materiality approved by a Partner',mat?'done':'todo','','Materiality & risk','Partner'));
 items.setup.push(it('risks','Risks recorded, fraud risk included, each with a working paper',gate.ready?'done':'todo',gate.risksOpen?`${gate.risksOpen} open risk(s)${gate.uncovered.length?`, ${gate.uncovered.length} without a working paper`:''}`:'No risk recorded yet','Materiality & risk',''));
 if(sasra)items.setup.push(it('sasra','SASRA auditor eligibility confirmed',sasra.eligible?'done':'todo','','SASRA & quality','Partner'));

 if(points.length)items.managing.push(it('points','Management points decided',openPoints.length?'todo':'done',openPoints.length?`${openPoints.length} still open`:'','Reports','Manager'));
 if(time){
  const waiting=n(time.submitted_hours)+n(time.draft_hours);
  if(n(time.approved_hours)+waiting>0)items.managing.push(it('time','Time approved',waiting?'todo':'done',waiting?`${waiting} hour(s) not yet approved`:'','Time & billing','Manager'));
  if(time.budgeted_hours!=null)items.managing.push(it('budget','Hours within budget',n(time.approved_hours)<=n(time.budgeted_hours)?'done':'blocked',`${n(time.approved_hours)} of ${n(time.budgeted_hours)} budgeted hours`,'Time & billing','Manager'));
 }
 if(sasra?.assembly)items.managing.push(it('deadline','Report date set, so the assembly deadline is known',sasra.assembly.anchor_date?'done':'todo',sasra.assembly.deadline?`Assemble by ${sasra.assembly.deadline}`:'Enter the audit report date','SASRA & quality','Partner'));

 items.papers.push(it('tb','Trial balance confirmed, balanced and mapped',read.current_tb_confirmed&&read.current_tb_balanced&&read.all_lines_mapped?'done':'todo',!read.current_tb_confirmed?'No confirmed current-year trial balance':!read.all_lines_mapped?'Some accounts are not mapped':'','Trial balance','Manager'));
 items.papers.push(it('wps','Working papers independently approved',read.workpapers_resolved?'done':'todo',wps.length?`${wps.filter(w=>w.status==='Approved').length} of ${wps.length} approved`:'No working paper yet','Working papers',''));
 if(adj.length)items.papers.push(it('adj','Audit entries submitted and reviewed',pendingAdj.length?'todo':'done',pendingAdj.length?`${pendingAdj.length} not yet approved`:'','Adjustments',''));
 if(activeLeads.length)items.papers.push(it('leads','Lead schedules made and tying to the adjusted trial balance',missingLeads.length||badTie.length?(badTie.length?'blocked':'todo'):'done',missingLeads.length?`${missingLeads.length} area(s) without a lead schedule`:badTie.length?`${badTie.length} schedule(s) do not tie`:'','Lead schedules',''));
 if(pops.length||requiredAreas.length)items.papers.push(it('populations','Populations approved and reconciled to the trial balance',popBad.length?'blocked':(popOpen.length||popMissing.length)?'todo':'done',popBad.length?popProblem(popBad[0]):popMissing.length?`Required but not approved: ${popMissing.join(', ')}`:popOpen.length?`${popOpen.length} not yet approved`:`${pops.length} approved`,'Populations',''));
 if(sacco)items.papers.push(it('sacco','SACCO statements ready: layout approved, accounts mapped, equity reconciled',saccoBlock.length?'todo':'done',saccoBlock[0]||'','SACCO statements','Partner'));
 if(pack){
  items.papers.push(it('programme','Audit programme approved, adopted and every required step reviewed',!packProgOk||!packSteps.length||packStepsOpen.length?'todo':'done',!packProgOk?'No programme approved by a Partner yet':!packSteps.length?'Not adopted on this file':packStepsOpen.length?`${packStepsOpen.length} required step(s) not reviewed`:'','SACCO audit pack','Manager'));
  items.papers.push(it('compliance','Compliance register assessed and reviewed',!packItemsOk||!packComp.length||packCompOpen.length?'todo':'done',!packItemsOk?'No item approved by a Partner yet':!packComp.length?'Not started on this file':packCompOpen.length?`${packCompOpen.length} of ${packComp.length} not reviewed`:'','SACCO audit pack','Manager'));
 }
 items.papers.push(it('analytics','Analytics run and every alert cleared',openAlerts.length?(highAlerts.length?'blocked':'todo'):runs.length?'done':'todo',openAlerts.length?`${openAlerts.length} alert(s) open${highAlerts.length?`, ${highAlerts.length} high`:''}`:runs.length?'':'Not run yet','Analytics',''));

 items.completion.push(it('checklist','Completion checklist independently reviewed',read.completion_total>0&&read.completion_total===read.completion_reviewed?'done':'todo',comp.length?`${compDone} of ${comp.length} reviewed`:'','Completion','Manager'));
 if(rstat.length)items.completion.push(it('reports','Required reports approved and up to date',staleReports.length?'blocked':okReports.length===reqReports.length?'done':'todo',staleReports.length?`${staleReports.length} changed since approval`:`${okReports.length} of ${reqReports.length} approved`,'Reports','Partner'));
 if(exceeds)items.completion.push(it('misstatement','Partner conclusion on unadjusted misstatements',concluded?'done':'blocked',concluded?'':'Unadjusted misstatements exceed overall materiality','Adjustments','Partner'));
 if(sacco&&saccoChecks.length)items.completion.push(it('sec10','Section 10 matters prepared and reviewed',saccoUnreviewed.length?'todo':'done',`${saccoChecks.length-saccoUnreviewed.length} of ${saccoChecks.length} reviewed`,'SACCO statements','Manager'));
 if(pack&&packMatters.length)items.completion.push(it('matters','Matters communicated have a Partner key audit matter decision',packUndecided.length?'todo':'done',`${packMatters.length-packUndecided.length} of ${packMatters.length} decided`,'SACCO audit pack','Partner'));
 if(sasra){
  items.completion.push(it('ratios','SASRA ratios entered and any breach acknowledged',!ratios.length||ratioIssues.length?(unack.length?'blocked':'todo'):'done',unack.length?`${unack.length} breach(es) not acknowledged`:!ratios.length?'No ratio confirmed yet':'','SASRA & quality','Partner'));
  if(eqRequired)items.completion.push(it('eqcr','EQCR Partner approval',eqApproved?'done':'todo',eqApproved?'':'Required before final sign-off','SASRA & quality','Partner'));
 }
 const st=file.file_status;
 items.archive.push(it('approved','Audit file approved by a Partner',['Approved','Completion','Archived'].includes(st)?'done':'todo','','Overview','Partner'));
 items.archive.push(it('completed','Audit file completed',['Completion','Archived'].includes(st)?'done':'todo','','Overview','Partner'));
 {
  const asm=s.assembly||null,openAm=(asm?.amendments||[]).find(x=>x.status==='Open');
  if(asm)items.archive.push(it('assembly','Assembly recorded as complete by a Partner',asm.lock?.sealed?'done':'todo',asm.lock?.sealed?(openAm?'A late change is open':''):(['Completion','Archived'].includes(st)?'':'After the file is completed'),'Assembly & milestones','Partner'));
 }
 items.archive.push(it('archived','Audit file archived',st==='Archived'?'done':'todo','','Overview','Partner'));

 const sections=SECTIONS.map(sec=>{
  const rows=items[sec.key].filter(x=>x.state!=='na'),done=rows.filter(x=>x.state==='done').length,total=rows.length;
  const tone=!total?'idle':done===total?'ok':rows.some(x=>x.state==='blocked')?'bad':done>0?'warn':'idle';
  return {...sec,items:rows,done,total,tone,tabs:sectionTabs(sec.key,!!sasra),summary:total?`${done}/${total}`:'—'};
 });

 // Blocking sign-offs, in the order the work normally happens.
 const B=[];const block=(kind,section,action,detail,tab,owner)=>B.push({kind,section,action,detail:detail||'',tab,owner:owner||''});
 {
  const am=(s.assembly?.amendments||[]).find(x=>x.status==='Open');
  if(am)block('amendment','archive','Review and close the late change',`Opened by ${am.opened_by_name}: ${am.reason}`,'Assembly & milestones','Manager');
 }
 if(!read.framework_approved)block('framework','setup','Confirm the reporting framework','Staff cannot import or confirm a trial balance until it is confirmed.','Overview','Partner');
 if(!mat)block('materiality','setup','Approve materiality','Calculate it, then a Partner who did not prepare it approves it.','Materiality & risk','Partner');
 if(!gate.ready&&mat)block('risks','setup',gate.fraud?'Link every open risk to a working paper':'Record risks, including a fraud risk',gate.uncovered.length?`${gate.uncovered.length} open risk(s) have no working paper.`:'','Materiality & risk','');
 eligIssues.forEach(x=>block('sasra','setup','Confirm SASRA auditor eligibility',x,'SASRA & quality','Partner'));
 if(!(read.current_tb_confirmed&&read.current_tb_balanced&&read.all_lines_mapped))block('tb','papers',read.current_tb_confirmed?'Map every trial-balance account':'Import and confirm the current-year trial balance','','Trial balance','Manager');
 if(!read.workpapers_resolved)block('workpapers','papers',wps.length?'Get every working paper independently approved':'Add the working papers',wps.length?`${wps.filter(w=>w.status!=='Approved').length} not yet approved.`:'','Working papers','');
 if(pendingAdj.length)block('adjustments','papers','Submit and review every audit entry',`${pendingAdj.length} entr${pendingAdj.length===1?'y':'ies'} not yet approved.`,'Adjustments','');
 if(missingLeads.length)block('leads','papers','Create a lead schedule for each trial-balance area',missingLeads.map(l=>l.audit_area).join(', '),'Lead schedules','');
 if(badTie.length)block('tie','papers','Make the lead schedules tie to the adjusted trial balance',badTie.map(l=>l.audit_area).join(', '),'Lead schedules','');
 saccoBlock.forEach(x=>block('sacco','papers',/draft/.test(x)?'Approve the SACCO statement layout':/Partner approval/.test(x)?'Approve the proposed account mappings':'Fix the SACCO statements',x,'SACCO statements',/draft|Partner approval/.test(x)?'Partner':''));
 if(pack&&!packProgOk)block('programme','papers','Approve the SACCO audit programme','A Partner has not approved a version yet.','SACCO audit pack','Partner');
 if(pack&&packProgOk&&!packSteps.length)block('programme','papers','Adopt the audit programme on this file','The programme steps are not on this file yet.','SACCO audit pack','');
 if(pack&&packSteps.length&&packStepsOpen.length)block('programme','papers','Perform and review the programme steps',`${packStepsOpen.length} required step(s) not reviewed.`,'SACCO audit pack','');
 if(pack&&!packItemsOk)block('compliance','papers','Approve compliance register items','A Partner has not approved any item yet.','SACCO audit pack','Partner');
 if(pack&&packItemsOk&&!packComp.length)block('compliance','papers','Start the compliance register on this file','The approved items are not on this file yet.','SACCO audit pack','');
 if(pack&&packComp.length&&packCompOpen.length)block('compliance','papers','Assess and review the compliance items',`${packCompOpen.length} of ${packComp.length} not reviewed.`,'SACCO audit pack','');
 popBad.forEach(x=>block('population','papers',`Reconcile population ${x.pop_ref}`,popProblem(x)+'.','Populations',''));
 pops.filter(x=>['Draft','Returned'].includes(x.status)&&!popProblem(x)).forEach(x=>block('population','papers',`Submit or withdraw population ${x.pop_ref}`,`${x.audit_area} · ${x.status.toLowerCase()}.`,'Populations',''));
 pops.filter(x=>x.status==='Submitted'&&!popProblem(x)).forEach(x=>block('population','papers',`Review population ${x.pop_ref}`,`${x.audit_area} is waiting for a Manager or Partner.`,'Populations','Manager'));
 popMissing.filter(a=>!pops.some(x=>x.audit_area===a)).forEach(a=>block('population','papers',`Record the ${a.toLowerCase()} population`,'The firm requires an approved, reconciled population for this area.','Populations',''));
 if(openAlerts.length)block('analytics','papers','Clear every analytics alert with a note',`${openAlerts.length} open${highAlerts.length?`, ${highAlerts.length} high`:''}.`,'Analytics','');
 if(exceeds&&!concluded)block('misstatement','completion','Record the conclusion on unadjusted misstatements','They exceed overall materiality.','Adjustments','Partner');
 if(sacco&&saccoUnreviewed.length)block('sacco10','completion','Prepare and review the section 10 matters',`${saccoUnreviewed.length} of ${saccoChecks.length} not yet reviewed.`,'SACCO statements','Manager');
 if(pack&&packUndecided.length)block('matters','completion','Decide which matters are key audit matters',`${packUndecided.length} of ${packMatters.length} matter(s) have no current decision.`,'SACCO audit pack','Partner');
 ratioIssues.forEach(x=>block('ratio','completion',/not acknowledged/.test(x)?'Acknowledge the regulatory breach':'Complete the SASRA ratios',x,'SASRA & quality','Partner'));
 if(comp.length&&read.completion_total!==read.completion_reviewed)block('checklist','completion','Review every completion control',`${comp.length-compDone} not yet reviewed.`,'Completion','Manager');
 missingReports.forEach(r=>block('report','completion',`Approve the ${String(r.kind).toLowerCase()}`,'Not approved yet.','Reports','Partner'));
 staleReports.forEach(r=>block('report','completion',`Re-approve the ${String(r.kind).toLowerCase()}`,'The file changed after it was approved.','Reports','Partner'));
 if(openPoints.length)block('points','managing','Decide every management point',`${openPoints.length} open.`,'Reports','Manager');
 eqIssues.forEach(x=>block('eqcr','completion','Get EQCR Partner approval',x,'SASRA & quality','Partner'));
 const asmS=s.assembly||null;
 const stageNext={Draft:'Mark the file Prepared',Prepared:'Send the file for review','In Review':'Partner to approve the file',Returned:'Correct the file and send it for review again',Approved:'Partner to complete the file',Completion:asmS&&!asmS.lock?.sealed?'Partner to record that assembly is complete':'Partner to archive the file'}[st];
 const stageStep=!B.length&&stageNext?{kind:'stage',section:'archive',action:stageNext,detail:'Nothing is blocking this file.',tab:st==='Completion'&&asmS&&!asmS.lock?.sealed?'Assembly & milestones':'Overview',owner:['Draft','Prepared','Returned'].includes(st)?'Manager':'Partner'}:null;
 const next=B[0]||stageStep||null;

 // Role-aware view: what this person should look at first.
 const focus=roleFocus({role,myId,s,wps,adj,comp,reports,points,gate,mat,file,unack,exceeds,concluded,read,pops});

 const toolbar=[
  {key:'issues',label:'Issues',tab:'Issues',count:B.length,tone:B.length?'bad':'ok'},
  {key:'tb',label:'Trial balance',tab:'Trial balance',count:read.all_lines_mapped===false?'unmapped':'',tone:read.current_tb_confirmed?'ok':'warn'},
  {key:'adj',label:'Adjustments',tab:'Adjustments',count:pendingAdj.length,tone:pendingAdj.length?'warn':'ok'},
  {key:'reports',label:'Reports',tab:'Reports',count:reqReports.length-okReports.length,tone:reqReports.length-okReports.length?'warn':'ok'}
 ];
 const gates=[
  {key:'framework',label:'Framework',state:read.framework_approved?'ok':'pending',text:read.framework_approved?'confirmed':'not confirmed'},
  {key:'materiality',label:'Materiality',state:mat?'ok':'pending',text:mat?'approved':'not approved'}
 ];
 if(sasra){
  gates.push({key:'sasra',label:'SASRA',state:sasra.eligible?'ok':'pending',text:sasra.eligible?'eligible':'not confirmed'});
  gates.push({key:'eqcr',label:'EQCR',state:!eqRequired?'na':eqApproved?'ok':'pending',text:!eqRequired?'not required':eqApproved?'approved':'pending'});
  const a=sasra.assembly;
  gates.push({key:'lock',label:'Lock',state:a?.deadline?'ok':'pending',text:a?.deadline?`${a.anchor==='YEAR_END'?'year end':'report date'} + ${a.days} days = ${a.deadline}`:`set the ${a?.anchor==='YEAR_END'?'year end':'report date'}`});
 }
 return {role,licences:s.licences||[],header:{status:st,framework:file.reporting_framework,sacco_type:sasra?.sacco_type||null,financial_year:sasra?.financial_year||null,gates},next,blockers:B,toolbar,sections,focus,signoff:signoffStrip(file,s)};
}
function planningGate(g){
 if(!g)return {materiality:false,risksOpen:0,fraud:false,uncovered:[],ready:false};
 const uncovered=g.uncovered||[];
 return {materiality:!!g.materiality_approved,risksOpen:n(g.risks_open),fraud:!!g.fraud_risk_recorded,uncovered,ready:!!g.materiality_approved&&n(g.risks_open)>0&&!!g.fraud_risk_recorded&&!uncovered.length};
}
function roleFocus({role,myId,s,wps,adj,comp,reports,points,gate,mat,file,unack,exceeds,concluded,read,pops}){
 const rows=[];const add=(text,tab)=>rows.push({text,tab});
 if(role==='ASSISTANT'||role==='INTERN'){
  wps.filter(w=>w.prepared_by===myId&&['Draft','Returned'].includes(w.status)).forEach(w=>add(`${w.workpaper_ref} · ${w.status==='Returned'?`returned${w.review_note?`: ${w.review_note}`:''}`:'draft, not submitted'}`,'Working papers'));
  adj.filter(a=>a.prepared_by===myId&&['Draft','Returned'].includes(a.status)).forEach(a=>add(`Audit entry ${a.adj_seq??''} · ${a.status==='Returned'?'returned':'draft, not submitted'}`,'Adjustments'));
  pops.filter(x=>x.prepared_by===myId&&['Draft','Returned'].includes(x.status)).forEach(x=>add(`${x.pop_ref} · ${x.status==='Returned'?`returned${x.review_note?`: ${x.review_note}`:''}`:'draft, not submitted'}`,'Populations'));
  (s.my_tasks||[]).forEach(t=>add(`Task: ${t.task_name}`,'Overview'));
  return {title:'My papers',empty:'Nothing of yours is waiting.',rows};
 }
 if(role==='PARTNER'){
  if(!read.framework_approved)add('Confirm the reporting framework','Overview');
  if(!mat)add('Approve materiality','Materiality & risk');
  unack.forEach(r=>add(`Acknowledge the breach: ${r.label} is ${r.value}`,'SASRA & quality'));
  if(exceeds&&!concluded)add('Record the conclusion on unadjusted misstatements','Adjustments');
  reports.filter(r=>r.status==='Submitted').forEach(r=>add(`Review the ${String(r.kind).toLowerCase()} (version ${r.version_number})`,'Reports'));
  adj.filter(a=>a.status==='Submitted'&&a.prepared_by!==myId).forEach(a=>add(`Review audit entry ${a.adj_seq??''}`,'Adjustments'));
  if((s.pack?.programmes||[]).some(x=>x.status==='Draft'))add('Approve the SACCO audit programme','SACCO audit pack');
  if((s.pack?.compliance_items||[]).some(x=>x.status==='Proposed'))add('Approve proposed compliance items','SACCO audit pack');
  (s.pack?.matters||[]).filter(m=>m.status==='Active'&&(!m.decision||m.decision_stale)).forEach(m=>add(`Decide whether ${m.matter_ref} is a key audit matter`,'SACCO audit pack'));
  if(s.sacco?.layout?.status==='Draft'||s.sacco?.draft)add('Approve the SACCO statement layout','SACCO statements');
  if((s.sacco?.accounts||[]).some(a=>a.map_status==='Proposed'))add('Approve the proposed account mappings','SACCO statements');
  if(file.file_status==='Completion'&&s.assembly&&!s.assembly.lock?.sealed)add('Record that assembly is complete','Assembly & milestones');
  { const am=(s.assembly?.amendments||[]).find(x=>x.status==='Open');if(am&&am.opened_by!==myId)add('Review and close the late change','Assembly & milestones'); }
  if(file.file_status==='In Review')add('Approve or return the audit file','Overview');
  return {title:'Waiting for you',empty:'No Partner decision is waiting.',rows};
 }
 // Manager and Supervisor
 wps.filter(w=>w.status==='Submitted'&&w.prepared_by!==myId).forEach(w=>add(`Review ${w.workpaper_ref}`,'Working papers'));
 adj.filter(a=>a.status==='Submitted'&&a.prepared_by!==myId).forEach(a=>add(`Review audit entry ${a.adj_seq??''}`,'Adjustments'));
 pops.filter(x=>x.status==='Submitted'&&x.prepared_by!==myId).forEach(x=>add(`Review population ${x.pop_ref} (${x.audit_area})`,'Populations'));
 comp.filter(c=>c.status==='Prepared'&&c.prepared_by!==myId).forEach(c=>add(`Review control: ${c.label}`,'Completion'));
 (s.sacco?.preview?.checks||[]).filter(c=>c.status==='Prepared'&&c.prepared_by!==myId).forEach(c=>add(`Review section 10: ${c.caption}`,'SACCO statements'));
 (s.pack?.file_steps||[]).filter(x=>x.status==='Prepared'&&x.prepared_by!==myId).forEach(x=>add(`Review programme step ${x.step_code}`,'SACCO audit pack'));
 (s.pack?.compliance||[]).filter(x=>x.status==='Prepared'&&x.prepared_by!==myId).forEach(x=>add(`Review compliance item: ${x.title}`,'SACCO audit pack'));
 { const am=(s.assembly?.amendments||[]).find(x=>x.status==='Open');if(am&&am.opened_by!==myId)add('Review and close the late change','Assembly & milestones'); }
 reports.filter(r=>r.status==='Submitted').forEach(r=>add(`Review the ${String(r.kind).toLowerCase()} (version ${r.version_number})`,'Reports'));
 points.filter(p=>p.status==='Open').forEach(p=>add(`Decide management point ${p.point_ref||''}`.trim(),'Reports'));
 return {title:'Review queue',empty:'Nothing is waiting for your review.',rows};
}
// File-level sign-off strip. Per-paper sign-off (prepared, reviewed) is shown on each paper; Partner and EQCR sit on the file.
export function signoffStrip(file,s){
 const st=file?.file_status,sasra=s?.sasra,eq=sasra?.eqcr;
 const reviewed=['Approved','Completion','Archived'].includes(st);
 return [
  {label:'Prepared',done:st!=='Draft'&&st!=='Returned'},
  {label:'Reviewed',done:reviewed||(st==='In Review'&&!!s?.readiness?.workpapers_resolved&&n(s.readiness.completion_total)>0&&n(s.readiness.completion_total)===n(s.readiness.completion_reviewed))},
  {label:'Partner',done:reviewed},
  {label:'EQCR',done:eq?.required?!!eq.approved:null}
 ];
}
export function paperStrip(w){
 return [{label:'Prepared',done:['Submitted','Approved'].includes(w?.status)},{label:'Reviewed',done:w?.status==='Approved'}];
}
export function createHomeUI(ctx){
 const {esc}=ctx;
 const dot=t=>`<span class="audit-dot ${esc(t)}" aria-hidden="true"></span>`;
 const mark=state=>state==='done'?'✓':state==='blocked'?'!':'○';
 const strip=cells=>`<ul class="audit-signoff">${cells.map(c=>`<li class="${c.done===true?'done':c.done===null?'na':''}">${c.done===true?'✓':c.done===null?'–':'○'} ${esc(c.label)}${c.done===null?' <small>not required</small>':''}</li>`).join('')}</ul>`;
 function headerStrip(file,p,m){
  const h=m.header;
  return `<div class="audit-strip"><span><b>${esc(p.company_name)}</b></span><span>FY ${esc(h.financial_year||String(file.ends_on||'').slice(0,4))}</span>${h.sacco_type?`<span>${h.sacco_type==='DT_SACCO'?'DT-SACCO':'NWDT-SACCO'}</span>`:''}<span>${esc(file.reporting_framework)}</span>${h.gates.map(g=>`<span class="audit-gate ${esc(g.state)}" title="${esc(g.text)}">${g.state==='ok'?'✔':g.state==='na'?'–':'○'} ${esc(g.label)} <small>${esc(g.text)}</small></span>`).join('')}</div>`;
 }
 function nextStep(m){
  if(!m.next)return `<div class="audit-next ok"><b>Next step:</b> Nothing is waiting on this file.</div>`;
  const x=m.next;
  return `<div class="audit-next ${x.kind==='stage'?'ok':'bad'}"><div><b>Next step:</b> ${esc(x.action)}${x.owner?` <small>(${esc(x.owner)})</small>`:''}${x.detail?`<small class="block">${esc(x.detail)}</small>`:''}</div><button class="primary" data-audit-tab="${esc(x.tab)}">Open</button></div>`;
 }
 function toolbar(m){
  return `<div class="audit-toolbar" role="toolbar" aria-label="Quick links">${m.toolbar.map(t=>`<button data-audit-tab="${esc(t.tab)}" class="${esc(t.tone)}">${esc(t.label)}${t.count!==''&&t.count!==0?` <span class="audit-count">${esc(t.count)}</span>`:''}</button>`).join('')}</div>`;
 }
 function head(file,p,m){return headerStrip(file,p,m)+nextStep(m)+toolbar(m);}
 function sectionBar(m,activeTab){
  const active=sectionOf(activeTab);
  const first=sec=>sec.tabs[0]||'Overview';
  const sub=m.sections.find(x=>x.key===active);
  return `<div class="audit-tabs" role="tablist"><button role="tab" aria-selected="${active==='home'}" class="${active==='home'?'active':''}" data-audit-tab="Overview">Home</button>${m.sections.map(sec=>`<button role="tab" aria-selected="${active===sec.key}" class="${active===sec.key?'active':''}" data-audit-tab="${esc(first(sec))}">${dot(sec.tone)}${esc(sec.title)} <small>${esc(sec.summary)}</small></button>`).join('')}</div>${sub&&sub.tabs.length>1?`<div class="audit-subtabs" role="tablist">${sub.tabs.map(t=>`<button role="tab" aria-selected="${activeTab===t}" class="${activeTab===t?'active':''}" data-audit-tab="${esc(t)}">${esc(t)}</button>`).join('')}</div>`:''}`;
 }
 function sectionCards(m){
  return `<div class="audit-sections">${m.sections.map(sec=>`<article class="audit-section ${esc(sec.tone)}"><div class="section-head"><h4>${dot(sec.tone)}${esc(sec.title)}</h4><span class="badge ${sec.tone==='ok'?'good':sec.tone==='bad'?'warn':''}">${esc(sec.summary)}</span></div><ul>${sec.items.map(x=>`<li class="${esc(x.state)}"><button class="linklike" data-audit-tab="${esc(x.tab)}"><span class="mark">${mark(x.state)}</span> ${esc(x.label)}</button>${x.detail?`<small>${esc(x.detail)}</small>`:''}</li>`).join('')||'<li class="muted">Nothing to track yet.</li>'}</ul></article>`).join('')}</div>`;
 }
 function focusCard(m,cls=' section-space'){
  const f=m.focus;
  return `<section class="card${cls}"><h3>${esc(f.title)}</h3>${f.rows.length?`<ul class="audit-focus">${f.rows.slice(0,12).map(r=>`<li><button class="linklike" data-audit-tab="${esc(r.tab)}">${esc(r.text)}</button></li>`).join('')}</ul>${f.rows.length>12?`<p class="muted">${f.rows.length-12} more.</p>`:''}`:`<p class="muted">${esc(f.empty)}</p>`}</section>`;
 }
 function blockerList(m,limit){
  const rows=limit?m.blockers.slice(0,limit):m.blockers;
  if(!rows.length)return `<p class="muted">Nothing is blocking sign-off.</p>`;
  return `<ul class="audit-blockers">${rows.map(b=>`<li><div><b>${esc(b.action)}</b>${b.owner?` <small>(${esc(b.owner)})</small>`:''}${b.detail?`<small class="block">${esc(b.detail)}</small>`:''}</div><button data-audit-tab="${esc(b.tab)}">Open</button></li>`).join('')}</ul>${limit&&m.blockers.length>limit?`<p class="muted">${m.blockers.length-limit} more on the Issues tab.</p>`:''}`;
 }
 function issuesPanel(m){
  const bySec=SECTIONS.map(sec=>[sec,m.blockers.filter(b=>b.section===sec.key)]).filter(([,r])=>r.length);
  return `<section class="card"><div class="section-head"><div><h3>Issues blocking sign-off</h3><p class="muted">Each line names what is missing and who normally acts. Open it to go straight to the work. The server still checks every gate when the file moves on.</p></div><span class="badge ${m.blockers.length?'warn':'good'}">${m.blockers.length}</span></div>${bySec.length?bySec.map(([sec,rows])=>`<h4>${esc(sec.title)}</h4><ul class="audit-blockers">${rows.map(b=>`<li><div><b>${esc(b.action)}</b>${b.owner?` <small>(${esc(b.owner)})</small>`:''}${b.detail?`<small class="block">${esc(b.detail)}</small>`:''}</div><button data-audit-tab="${esc(b.tab)}">Open</button></li>`).join('')}</ul>`).join(''):'<p class="muted">Nothing is blocking sign-off.</p>'}<p class="muted section-space">Changes since you last looked, and populations that have not been reconciled, are not tracked here yet.</p></section>`;
 }
 function homePanel(m){
  return `${sectionCards(m)}<div class="two-col section-space"><section class="card"><h3>Blocking sign-off</h3>${blockerList(m,6)}</section>${focusCard(m,'')}</div>${auditFlagHtml(m.licences)}<section class="card section-space"><h3>Sign-off</h3>${strip(m.signoff)}<p class="muted">Prepared, reviewed and Partner approval for the file. Each working paper shows its own prepared and reviewed marks. EQCR is shown only when it is required.</p></section>`;
 }
 return {head,sectionBar,homePanel,issuesPanel,strip,paperStrip};
}
