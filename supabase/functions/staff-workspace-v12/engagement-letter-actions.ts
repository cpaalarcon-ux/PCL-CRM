import {fail,text} from './validation.mjs';
import {today} from './suite-actions.ts';
import {letterState,summarise,planLink,MAX_LINK} from './engagement-letter-rules.mjs';
// Engagement letters list: every open engagement with the state of its signed letter, and one step that links letters already uploaded.
// It never uploads a file and never changes anything else. A letter is still signed outside the system and uploaded as a locked PDF.
const ACTIONS=['engagement_letters_list','engagement_letters_link_ready'];
const LEADERS=['PARTNER','MANAGER'];
async function rowsFor(tx:any,a:any){
 const raw=await tx`select p.project_id,p.project_name,p.service_code,p.status,c.client_id,c.company_name,e.signed_letter_id,e.letter_verified_by,e.letter_expires_on,e.stage controls_stage,
   d.document_id candidate_id,d.file_name candidate_name,d.uploaded_by candidate_uploaded_by
  from erp_private.projects p
  join erp_private.clients c on c.client_id=p.client_id and c.deleted_at is null
  left join erp_private.engagement_controls e on e.project_id=p.project_id
  left join lateral (select document_id,file_name,uploaded_by from erp_private.documents x where x.project_id=p.project_id and x.category='Signed Engagement Letters' and x.mime_type='application/pdf' and x.is_locked and x.deleted_at is null order by x.uploaded_at desc limit 1) d on true
  where p.deleted_at is null and p.status in ('Draft','Active')
  order by c.company_name,p.project_name limit 3000`;
 const t=today();
 return raw.map((r:any)=>({...r,letter_state:letterState(r.signed_letter_id?{signed_letter_id:r.signed_letter_id,letter_verified_by:r.letter_verified_by,letter_expires_on:r.letter_expires_on}:null,r.candidate_id?{document_id:r.candidate_id}:null,t)}));
}
export async function engagementLetterAction(tx:any,a:any,p:any){
 if(!ACTIONS.includes(p.action))return undefined;
 if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner reviews engagement letters.');
 const rows=await rowsFor(tx,a);
 if(p.action==='engagement_letters_list'){
  const only=p.state?String(p.state):'';
  const shown=rows.filter((r:any)=>!only||r.letter_state===only).slice(0,500).map((r:any)=>({project_id:r.project_id,project_name:r.project_name,service_code:r.service_code,project_status:r.status,client_id:r.client_id,company_name:r.company_name,letter_state:r.letter_state,letter_expires_on:r.letter_expires_on,uploaded_file:r.candidate_name||null}));
  return {ok:true,counts:summarise(rows),total:rows.length,rows:shown};
 }
 const apply=p.dry_run===false;
 const note=text(p.note||'',1000,false).trim();
 if(apply&&note.length<10)fail(400,'Record why you are linking these letters in at least 10 characters.');
 const sole=!!(await tx`select erp_private.sole_active_partner() as ok`)[0]?.ok;
 const plan=planLink(rows,{staff_id:a.staff_id,sole});
 const brief=(r:any)=>({project_id:r.project_id,company_name:r.company_name,project_name:r.project_name,uploaded_file:r.candidate_name,why:r.why});
 if(!apply)return {ok:true,dry_run:true,ready:plan.ready.length,left:plan.left.map(brief),sole_partner:sole,over_limit:plan.ready.length>MAX_LINK};
 if(plan.ready.length>MAX_LINK)fail(400,`Link at most ${MAX_LINK} letters at a time.`);
 for(const r of plan.ready){
  await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by) values(${r.project_id},${r.candidate_id},${a.staff_id})
   on conflict(project_id) do update set signed_letter_id=excluded.signed_letter_id,letter_verified_by=excluded.letter_verified_by where erp_private.engagement_controls.signed_letter_id is null and erp_private.engagement_controls.stage<>'Finalized'`;
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'engagement_controls','ENGAGEMENT_LETTERS_LINKED',${crypto.randomUUID()},${tx.json({linked:plan.ready.length,left:plan.left.length,note,projects:plan.ready.map((r:any)=>r.project_id)})})`;
 return {ok:true,dry_run:false,linked:plan.ready.length,left:plan.left.map(brief)};
}
