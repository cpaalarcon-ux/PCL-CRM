import {fail,text} from './validation.mjs';
// Client set-up pipeline, read-only: four steps per client (Preparer, MLRO, Manager, Partner) and one queue per step.
// Preparer and MLRO are derived from data already held (set-up sections, owners, contacts, AML profile). Manager and Partner sign-off
// are not recorded yet, so they show as waiting until the sign-off feature exists. Nothing here writes.
const ACTIONS=['client_setup_pipeline_read'];
const SECTIONS=['identity','registration','tax','ownership','activities','year_end','contacts','permanent_file','engagement'];
const leader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);

export const pipelineSteps=(r:any)=>{
 const secDone=Number(r.sections_approved||0)+Number(r.sections_pending||0);
 const prepDone=Number(r.owners||0)>0&&Number(r.contacts||0)>0&&secDone>=SECTIONS.length&&!!r.aml_submitted;
 const mlroDone=!!r.aml_decision;
 const mlro=mlroDone?'Done':(prepDone&&r.aml_stage==='MLRO review'?'Waiting':(prepDone?'Waiting':'Not started'));
 const preparer=prepDone?'Done':(secDone||Number(r.owners||0)||Number(r.contacts||0)||r.aml_stage?'In progress':'Not started');
 const manager=mlroDone?'Waiting':'Not started',partner='Not started';
 const queue=preparer!=='Done'?'preparer':(mlro!=='Done'?'mlro':'manager');
 const missing:string[]=[];
 if(Number(r.owners||0)===0)missing.push('Owners');
 if(Number(r.contacts||0)===0)missing.push('Contacts');
 if(secDone<SECTIONS.length)missing.push(`${SECTIONS.length-secDone} set-up section(s)`);
 if(!r.aml_submitted)missing.push('AML profile');
 return {preparer,mlro,manager,partner,queue,missing};
};

export async function clientSetupPipelineAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!leader(a))fail(403,'A Manager or Partner opens the set-up status.');
 const q=p.search==null?'':text(p.search,80,false).toLowerCase();
 const rows=await tx`select c.client_id,c.company_name,c.kra_pin,
   (select count(*)::int from erp_private.client_setup_sections s where s.client_id=c.client_id and s.section_code=any(${SECTIONS}) and s.status='Approved') sections_approved,
   (select count(*)::int from erp_private.client_setup_sections s where s.client_id=c.client_id and s.section_code=any(${SECTIONS}) and s.status='Pending Review') sections_pending,
   (select count(*)::int from erp_private.client_setup_sections s where s.client_id=c.client_id and s.status='Correction Required') sections_returned,
   (select count(*)::int from erp_private.beneficial_owners o where o.client_id=c.client_id and o.deleted_at is null) owners,
   (select count(*)::int from erp_private.client_contacts k where k.client_id=c.client_id and k.deleted_at is null) contacts,
   m.stage aml_stage,(m.submitted_at is not null) aml_submitted,m.decision aml_decision,m.risk_rating
  from erp_private.clients c left join erp_private.client_aml_profiles m on m.client_id=c.client_id
  where c.deleted_at is null and c.archived_at is null and coalesce(c.is_uat_fixture,false)=false
   and (${q}='' or strpos(lower(concat_ws(' ',c.company_name,c.kra_pin)),${q})>0)
  order by c.company_name,c.client_id limit 500`;
 const clients=rows.map((r:any)=>({client_id:r.client_id,company_name:r.company_name,kra_pin:r.kra_pin,risk_rating:r.risk_rating||null,
  sections_returned:r.sections_returned,owners:r.owners,contacts:r.contacts,...pipelineSteps(r)}));
 const queues:any={preparer:0,mlro:0,manager:0,partner:0};
 for(const c of clients)if(c.queue in queues&&!(c.queue==='manager'&&c.manager!=='Waiting'))queues[c.queue]++;
 return {ok:true,clients,queues,total:clients.length,note:'Manager and Partner sign-off are not recorded yet.'};
}
