import {fail} from './validation.mjs';
import {stageOf,summarise,STAGES} from './onboarding-run-rules.mjs';
// Onboarding run: a read-only picture of where every active client has got to. It changes nothing; each stage's button opens the existing screen.
const LEADERS=['PARTNER','MANAGER'];
export async function onboardingRunAction(tx:any,a:any,p:any){
 if(p.action!=='client_setup_onboarding_run')return undefined;
 if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner opens the onboarding run.');
 const clients=await tx`select client_id,company_name,opening_balance_status from erp_private.clients where deleted_at is null and service_status='Active' and record_status<>'Archived' order by company_name limit 2000`;
 const ids=clients.map((c:any)=>c.client_id);
 if(!ids.length)return {ok:true,total:0,counts:summarise([]),stages:STAGES,rows:[]};
 const secs=await tx`select client_id,section_code,status from erp_private.client_setup_sections where client_id=any(${ids}::uuid[])`;
 const charts=await tx`select client_id,status from erp_private.client_chart_versions where client_id=any(${ids}::uuid[]) and status in ('Approved','Draft')`;
 const kyc=await tx`select client_id from erp_private.client_compliance where client_id=any(${ids}::uuid[]) and verified_by is not null`;
 const projects=await tx`select p.client_id,p.status,(e.signed_letter_id is not null and e.letter_verified_by is not null and (e.letter_expires_on is null or e.letter_expires_on>=(now() at time zone 'Africa/Nairobi')::date)) letter_ok from erp_private.projects p left join erp_private.engagement_controls e on e.project_id=p.project_id where p.deleted_at is null and p.status in ('Draft','Active') and p.client_id=any(${ids}::uuid[])`;
 const opened=await tx`select distinct lp.client_id from erp_private.ledger_journals j join erp_private.ledger_periods lp on lp.period_id=j.period_id where j.kind='Opening' and j.status='Posted' and lp.client_id=any(${ids}::uuid[])`;
 const by=(rows:any[])=>{const m=new Map<string,any[]>();for(const r of rows){(m.get(r.client_id)||m.set(r.client_id,[]).get(r.client_id)!).push(r);}return m;};
 const S=by(secs),C=by(charts),P=by(projects);const K=new Set(kyc.map((r:any)=>r.client_id)),O=new Set(opened.map((r:any)=>r.client_id));
 const rows=clients.map((c:any)=>{
  const sections:any={};for(const r of S.get(c.client_id)||[])sections[r.section_code]=r.status;
  const cv=C.get(c.client_id)||[];const chart=cv.some((x:any)=>x.status==='Approved')?'Approved':cv.length?'Draft':null;
  const ps=P.get(c.client_id)||[];
  const stage=stageOf({sections,chart,kyc_verified:K.has(c.client_id),drafts:ps.filter((x:any)=>x.status==='Draft').map((x:any)=>({letter_ok:!!x.letter_ok})),active:ps.filter((x:any)=>x.status==='Active').length,opening_required:c.opening_balance_status!=='No opening balances',opening_posted:O.has(c.client_id)});
  return {client_id:c.client_id,company_name:c.company_name,stage};
 });
 return {ok:true,total:rows.length,counts:summarise(rows),stages:STAGES,rows};
}
