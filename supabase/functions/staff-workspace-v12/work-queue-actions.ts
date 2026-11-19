import {fail,uuid,text} from './validation.mjs';
import {reviewQueueAction} from './review-queue.ts';
import {ledgerAction} from './ledger-actions.ts';
import {GROUPS,CAPS,planBatch,refusalText,noteOk,MIN_NOTE,journalCan,groupOfJournal,stageOfJournal,countGroups} from './work-queue-rules.mjs';

// Build 2896: the work queue (read only) and the bulk decision on journals.
// work_queue: one list for the signed-in person in three groups. It only reads what the Home page and the review queue already show.
// work_queue_decide: Check, Return or Approve several journals at once. Every journal goes through the same single-journal action, in the same
// transaction, so the same rules apply to each; if any one is refused, nothing is changed and the refused journals are named. Approving posts, so it needs
// the person's tick that they reviewed the listed journals and is capped lower. Nothing here can decide a journal the person prepared or edited.
const ACTIONS=['work_queue','work_queue_decide'];
const day=(v:any)=>v instanceof Date?v.toISOString():String(v||'');

export async function workQueueAction(tx:any,a:any,p:any,storage:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Assigned accounting staff are required.');
 if(p.action==='work_queue')return await read(tx,a);
 return await decide(tx,a,p,storage);
}

// The journal columns are written out in each query below (the same list three times): j.journal_id, kind, reference, journal_date, status, project_id, period_id, revision, review_note, prepared_by, last_prepared_by, checked_by, updated_at, junior, total, client and project names.

async function read(tx:any,a:any){
 const me=a.staff_id,items:any[]=[];
 const toItem=(j:any,reviewing:boolean)=>{
  const group=groupOfJournal(j,me),can=j.status==='Submitted'?journalCan(a.category_code,me,j):[];
  return {key:'journal:'+j.journal_id,kind:'journal',id:j.journal_id,group,client_id:j.client_id,client_name:j.client_name,project_id:j.project_id,period_id:j.period_id,
   title:`${j.kind==='Opening'?'Opening balances':j.kind+' journal'} · ${j.reference} · ${j.project_name}`,stage:stageOfJournal(j,me),amount:Number(j.total||0),revision:String(j.revision),
   at:day(j.updated_at),can,own:!reviewing};
 };
 // My own journals: drafts and returned ones to finish, submitted ones waiting on someone else, posted ones in the last two weeks.
 const mine=await tx`select j.journal_id,j.kind,j.reference,j.journal_date,j.status,j.project_id,j.period_id,j.revision,j.review_note,j.prepared_by,j.last_prepared_by,j.checked_by,j.updated_at, erp_private.is_junior_preparer(j.prepared_by) or erp_private.is_junior_preparer(j.last_prepared_by) as junior, (select coalesce(sum(x.debit),0) from erp_private.ledger_lines x where x.journal_id=j.journal_id) as total,pr.client_id,c.company_name as client_name,pr.project_name from erp_private.ledger_journals j join erp_private.projects pr on pr.project_id=j.project_id join erp_private.clients c on c.client_id=pr.client_id
  where (j.prepared_by=${me} or j.last_prepared_by=${me}) and (j.status in ('Draft','Returned','Submitted') or (j.status='Posted' and j.updated_at>=now()-interval '14 days')) order by j.updated_at desc limit 200`;
 for(const j of mine)items.push(toItem(j,false));
 // Journals waiting for my check or approval: submitted, and not prepared or edited by me.
 if(['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code)){
  const wait=await tx`select j.journal_id,j.kind,j.reference,j.journal_date,j.status,j.project_id,j.period_id,j.revision,j.review_note,j.prepared_by,j.last_prepared_by,j.checked_by,j.updated_at, erp_private.is_junior_preparer(j.prepared_by) or erp_private.is_junior_preparer(j.last_prepared_by) as junior, (select coalesce(sum(x.debit),0) from erp_private.ledger_lines x where x.journal_id=j.journal_id) as total,pr.client_id,c.company_name as client_name,pr.project_name from erp_private.ledger_journals j join erp_private.projects pr on pr.project_id=j.project_id join erp_private.clients c on c.client_id=pr.client_id
   where j.status='Submitted' and j.prepared_by<>${me} and j.last_prepared_by<>${me} order by j.updated_at limit 200`;
  for(const j of wait){const it=toItem(j,true);if(it.can.length||a.category_code!=='SUPERVISOR')items.push(it);}
 }
 // Reports, charts, client set-up changes and escalations waiting for me come from the review queue as it already works.
 const queue=await reviewQueueAction(tx,a,{action:'v3_review_queue'});
 for(const x of (queue?.items||[]).filter((x:any)=>x.kind!=='journal'))items.push({key:x.kind+':'+x.id,kind:x.kind,id:x.id,group:'To do',client_id:x.client_id,client_name:x.client_name,project_id:x.project_id||'',period_id:x.period_id||'',title:x.title,stage:x.stage||(x.kind==='escalation'?'Needs your answer':'Waiting for your review'),amount:null,revision:'',at:day(x.submitted_at),can:[],own:false});
 // Purchase and expenditure rows that are not mapped yet, one line per project.
 const unmapped=await tx`select pr.project_id,pr.client_id,c.company_name as client_name,pr.project_name,count(*)::int as n,coalesce(sum(case when r.normalized->>'amount' ~ '^-?[0-9]+([.][0-9]+)?$' then (r.normalized->>'amount')::numeric else 0 end),0) as value
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) join erp_private.projects pr on pr.project_id=r.project_id join erp_private.clients c on c.client_id=pr.client_id
  where b.archived_at is null and pr.deleted_at is null and pr.status<>'Archived' and r.account_code is null and r.parent_row_id is null and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS')
  group by pr.project_id,pr.client_id,c.company_name,pr.project_name order by count(*) desc limit 50`;
 for(const u of unmapped)items.push({key:'unmapped:'+u.project_id,kind:'unmapped',id:u.project_id,group:'To do',client_id:u.client_id,client_name:u.client_name,project_id:u.project_id,period_id:'',title:`${u.n} purchase or expenditure row${u.n===1?'':'s'} not mapped · ${u.project_name}`,stage:'Map each row, or leave it as a draft with its reason',amount:Number(u.value||0),revision:'',at:'',can:[],own:false});
 // Work I sent for someone else's decision.
 const reports=await tx`select r.review_id as id,r.project_id,pr.client_id,c.company_name as client_name,pr.project_name,r.report_kind,r.created_at from erp_private.ledger_report_reviews r join erp_private.projects pr on pr.project_id=r.project_id join erp_private.clients c on c.client_id=pr.client_id where r.status='Submitted' and r.prepared_by=${me} order by r.created_at limit 100`;
 for(const r of reports)items.push({key:'report:'+r.id,kind:'report',id:r.id,group:'In progress',client_id:r.client_id,client_name:r.client_name,project_id:r.project_id,period_id:'',title:`${r.report_kind} report · ${r.project_name}`,stage:'Sent for review',amount:null,revision:'',at:day(r.created_at),can:[],own:true});
 const charts=await tx`select v.version_id as id,v.client_id,c.company_name as client_name,v.prepared_at from erp_private.client_chart_versions v join erp_private.clients c on c.client_id=v.client_id where v.status='Draft' and v.prepared_by=${me} order by v.prepared_at limit 100`;
 for(const r of charts)items.push({key:'chart:'+r.id,kind:'chart',id:r.id,group:'In progress',client_id:r.client_id,client_name:r.client_name,project_id:'',period_id:'',title:'Client chart of accounts',stage:'Sent for review',amount:null,revision:'',at:day(r.prepared_at),can:[],own:true});
 const rank:any={'To do':0,'In progress':1,'Done':2};
 items.sort((x,y)=>rank[x.group]-rank[y.group]||(x.at||'9999').localeCompare(y.at||'9999'));
 return {ok:true,groups:GROUPS,counts:countGroups(items),items,min_note:MIN_NOTE,caps:CAPS};
}

async function decide(tx:any,a:any,p:any,storage:any){
 const decision=String(p.decision||''),cap=(CAPS as any)[decision];
 if(!cap)fail(400,'Choose Check, Return or Approve.');
 const ids=[...new Set((Array.isArray(p.journal_ids)?p.journal_ids:[]).map((x:any)=>uuid(x)))] as string[];
 if(!ids.length||ids.length>cap)fail(400,`Choose between 1 and ${cap} journals to ${decision}.`);
 if(!noteOk(p.note))fail(400,decision==='return'?`Give the reason for returning, at least ${MIN_NOTE} characters. The preparer sees it.`:`Enter a note of at least ${MIN_NOTE} characters.`);
 if(decision==='approve'&&p.confirm_reviewed!==true)fail(400,'Tick the box to confirm you have reviewed the listed journals. Approving posts them.');
 const note=text(p.note,5000);
 const rows=await tx`select j.journal_id,j.kind,j.reference,j.journal_date,j.status,j.project_id,j.period_id,j.revision,j.review_note,j.prepared_by,j.last_prepared_by,j.checked_by,j.updated_at, erp_private.is_junior_preparer(j.prepared_by) or erp_private.is_junior_preparer(j.last_prepared_by) as junior, (select coalesce(sum(x.debit),0) from erp_private.ledger_lines x where x.journal_id=j.journal_id) as total,pr.client_id,c.company_name as client_name,pr.project_name from erp_private.ledger_journals j join erp_private.projects pr on pr.project_id=j.project_id join erp_private.clients c on c.client_id=pr.client_id where j.journal_id=any(${tx.array(ids)}::uuid[]) order by j.reference`;
 const stale=(Array.isArray(p.revisions)?p.revisions:[]).length?new Map((p.revisions as any[]).map((r:any)=>[String(r.journal_id),String(r.revision)])):null;
 const plan=planBatch(decision,a.category_code,a.staff_id,ids,rows);
 if(!plan.ok)fail(403,refusalText(decision,plan.problems,ids.length));
 if(stale){const changed=rows.filter((j:any)=>stale.has(j.journal_id)&&stale.get(j.journal_id)!==String(j.revision));if(changed.length)fail(409,`Nothing was changed. ${changed.length} journal${changed.length===1?' was':'s were'} changed since you opened the list: ${changed.slice(0,8).map((j:any)=>j.reference).join(', ')}. Refresh and try again.`);}
 const results:any[]=[];
 for(const j of rows){
  const base={project_id:j.project_id,period_id:j.period_id,journal_id:j.journal_id,revision:String(j.revision)};
  let call:any;
  if(decision==='check')call={...base,action:'ledger_journal_check',outcome:'Checked',check_note:note};
  else if(decision==='approve')call={...base,action:'ledger_journal_review',status:'Posted',review_note:note};
  else if(['PARTNER','MANAGER'].includes(a.category_code))call={...base,action:'ledger_journal_review',status:'Returned',review_note:note};
  else call={...base,action:'ledger_journal_check',outcome:'Returned',check_note:note};
  try{await ledgerAction(tx,a,call,storage);}
  catch(e:any){fail(e?.status||400,`Nothing was changed. ${j.reference}: ${String(e?.message||'refused').slice(0,300)}`);}
  results.push({journal_id:j.journal_id,reference:j.reference,decision});
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'ledger_journals','WORK_QUEUE_BATCH_DECISION',${ids[0]},${tx.json({decision,count:results.length,journals:ids,note_length:note.length})})`;
 return {ok:true,decision,done:results.length,results,note:decision==='approve'?'Approved and posted. Each journal was tested against the same rules as a single approval.':decision==='check'?'Checked. A different Manager or Partner now approves each one.':'Returned to the preparers with your reason.'};
}
