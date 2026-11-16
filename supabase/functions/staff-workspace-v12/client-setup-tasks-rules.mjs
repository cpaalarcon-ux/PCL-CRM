// Build 2840: the Client Setup Tasks queue. Pure rules, no database.
// A task exists only because something is recorded as not finished: a set-up section not approved, a chart or opening trial balance not approved,
// a routing mapping still a draft, or a service set-up still waiting. Nothing is invented, and nothing here approves, posts or changes a record.
import {SECTIONS} from './setup-review-rules.mjs';

// Sections that need facts or confirmation from the client. "engagement" is internal (who is assigned) so it never goes on the client checklist.
export const CLIENT_INPUT_SECTIONS=['identity','registration','tax','ownership','activities','year_end','contacts','permanent_file'];

// The mandatory chart and opening trial balance state, kept in one place. versions and journals are newest first.
export function mandatoryState(versions,journals,openingBalanceStatus){
 const v=versions||[],j=journals||[];
 const chart=v.some(x=>x.status==='Approved')?'Approved':v.some(x=>x.status==='Draft')?'Pending Review':v.length&&v[0].status==='Returned'?'Correction Required':'Draft';
 let opening='Draft';
 if(openingBalanceStatus==='No opening balances')opening='Approved';
 else if(j.some(x=>x.status==='Posted'))opening='Approved';
 else if(j.some(x=>x.status==='Submitted'))opening='Pending Review';
 else if(j.length&&j[0].status==='Returned')opening='Correction Required';
 else if(!j.length&&chart!=='Approved')opening='Blocked';
 return {chart,opening,opening_not_applicable:openingBalanceStatus==='No opening balances'};
}

const shortList=(labels,max=3)=>labels.length<=max?labels.join(', '):labels.slice(0,max).join(', ')+` and ${labels.length-max} more`;
const needsClient=(code,status)=>CLIENT_INPUT_SECTIONS.includes(code)&&['Draft','Correction Required'].includes(status);

// input: clients [{client_id,company_name}], sections [{client_id,section_code,status,submitted_by}], versions {client_id:[...]}, journals {client_id:[...]},
// openingStatus {client_id:text}, routing [{client_id,status,created_by}], engagements [{client_id,service_code,period_start,period_end,status}],
// me {staff_id,leader}. Returns one task per client and kind, with the specific items inside it.
export function buildClientTasks({clients,sections,versions,journals,openingStatus,routing,engagements,me}){
 const tasks=[];
 for(const c of clients||[]){
  const mine=(sections||[]).filter(s=>s.client_id===c.client_id);
  const add=t=>tasks.push({client_id:c.client_id,company_name:c.company_name,...t});
  const rowOf=code=>mine.find(s=>s.section_code===code);
  const prepare=[],review=[];
  for(const def of SECTIONS){
   const r=rowOf(def.code),status=r?r.status:'Draft';
   if(status==='Approved')continue;
   const item={code:def.code,label:def.label,status,needs_client:needsClient(def.code,status),mine:!!(r&&r.submitted_by&&r.submitted_by===me.staff_id)};
   if(status==='Pending Review')review.push(item);else prepare.push(item);
  }
  if(prepare.length)add({kind:'section_prepare',who:'Preparer',title:'Set-up sections to finish',count:prepare.length,detail:shortList(prepare.map(i=>i.label)),items:prepare,go:'setup',needs_me:true,blocked_mine:0});
  if(review.length){const m=review.filter(i=>i.mine).length;add({kind:'section_review',who:'Reviewer',title:'Set-up sections waiting for review',count:review.length,detail:shortList(review.map(i=>i.label)),items:review,go:'review',needs_me:!!me.leader&&review.length>m,blocked_mine:m});}
  const st=mandatoryState((versions||{})[c.client_id],(journals||{})[c.client_id],(openingStatus||{})[c.client_id]);
  const chartItem={code:'chart',label:'Chart of Accounts',status:st.chart,needs_client:false,mine:false};
  if(st.chart==='Pending Review')add({kind:'chart_review',who:'Reviewer',title:'Chart of Accounts waiting for approval',count:1,detail:'The approver is not the person who prepared it.',items:[chartItem],go:'chart',needs_me:!!me.leader,blocked_mine:0});
  else if(st.chart!=='Approved')add({kind:'chart_prepare',who:'Preparer',title:st.chart==='Correction Required'?'Chart of Accounts returned for correction':'Chart of Accounts not yet prepared',count:1,detail:'Entries cannot be mapped or posted until it is approved.',items:[chartItem],go:'chart',needs_me:true,blocked_mine:0});
  const openItem={code:'opening',label:'Opening Trial Balance',status:st.opening,needs_client:['Draft','Correction Required'].includes(st.opening),mine:false};
  if(st.opening==='Pending Review')add({kind:'opening_review',who:'Reviewer',title:'Opening Trial Balance waiting for approval',count:1,detail:'The approver is not the person who prepared it.',items:[openItem],go:'opening',needs_me:!!me.leader,blocked_mine:0});
  else if(['Draft','Correction Required'].includes(st.opening))add({kind:'opening_prepare',who:'Preparer',title:st.opening==='Correction Required'?'Opening Trial Balance returned for correction':'Opening Trial Balance not yet prepared',count:1,detail:'Needs the client’s opening balances.',items:[openItem],go:'opening',needs_me:true,blocked_mine:0});
  const drafts=(routing||[]).filter(r=>r.client_id===c.client_id&&r.status==='Draft');
  if(drafts.length){const m=drafts.filter(r=>r.created_by===me.staff_id).length;add({kind:'routing_review',who:'Reviewer',title:'Routing mappings waiting for approval',count:drafts.length,detail:`${drafts.length} draft mapping${drafts.length===1?'':'s'} for the routing codes in purchases, sales and payroll files.`,items:[],go:'routing',needs_me:!!me.leader&&drafts.length>m,blocked_mine:m});}
  const waiting=(engagements||[]).filter(e=>e.client_id===c.client_id&&e.status==='Waiting');
  if(waiting.length)add({kind:'engagement_waiting',who:'Preparer',title:'Service set-ups waiting to be released',count:waiting.length,detail:shortList(waiting.map(e=>`${e.service_code} ${String(e.period_start).slice(0,10)} to ${String(e.period_end).slice(0,10)}`)),items:waiting.map(e=>({code:e.service_code,label:`${e.service_code} ${String(e.period_start).slice(0,10)} to ${String(e.period_end).slice(0,10)}`,status:'Waiting',needs_client:false,mine:false})),go:'engagement',needs_me:true,blocked_mine:0});
 }
 return tasks;
}

// The short client-facing list: only what needs the client's details or confirmation, each as a specific item.
export function clientConfigurationItems(tasks){
 const out=[];
 for(const t of tasks||[])for(const i of t.items||[])if(i.needs_client)out.push({client_id:t.client_id,code:i.code,label:i.label,status:i.status,reason:i.status==='Correction Required'?'Returned for correction. Ask the client for the corrected information.':i.code==='opening'?'Opening balances are needed from the client.':'Details or confirmation are needed from the client.',go:t.go});
 return out;
}

export const TASK_ORDER=['section_prepare','chart_prepare','opening_prepare','engagement_waiting','section_review','chart_review','opening_review','routing_review'];
