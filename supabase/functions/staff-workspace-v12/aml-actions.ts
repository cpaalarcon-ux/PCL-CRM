import {fail,text,uuid,revision,date} from './validation.mjs';
import {APPLICABILITY,cleanServiceRule,serviceScope,CATEGORIES,CATEGORY_LABELS,COUNTRY_CONTEXTS,SCREENING,RATINGS,DECISIONS,PEP_NONE,cleanProfile,cleanSelections,missingInfo,attentionReasons,profileStatus,cleanDecision,queueOrder} from './aml-rules.mjs';
// Build 2855: the MLRO-owned POCAMLA block. Staff collect the client's AML facts and refer the profile; the MLRO (an additional right, held by an
// Engagement Partner by rank) maintains the lists, rates the risk, decides, and asks for enhanced due diligence; an Engagement Partner records the
// formal approval of the lists and switches the engagement gate on. The table rules in 20261121100000_mlro_aml_profile.sql enforce the same again.
const ACTIONS=['aml_scope_read','aml_profile_read','aml_profile_save','aml_profile_submit','aml_decide','aml_edd_request','aml_return','aml_overview','aml_lookup_add','aml_lookup_confirm','aml_lookup_end','aml_policy_approve','aml_gate_set','aml_service_rules_read','aml_service_rule_set','aml_service_rule_end'];
const day=(v:any)=>v?(v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10)):null;
const nairobi=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const PROFILE_TEXT=['purpose_of_relationship','expected_activity','expected_size_frequency','pep_type','pep_role','pep_jurisdiction','pep_from','pep_relationship','screening_status','screening_list_source','screening_list_date','screening_note'];

async function isMlro(tx:any){return !!(await tx`select erp_private.is_mlro() as ok`)[0].ok;}
async function mustBeMlro(tx:any,a:any){if(!(await isMlro(tx)))fail(403,'Only the appointed MLRO or an Engagement Partner does this. An Engagement Partner appoints the MLRO under Staff → Additional rights.');}
async function liveLookups(tx:any){return await tx`select lookup_id,category,value,attention,source,effective_from,status,confirmed_at from erp_private.aml_lookups where status<>'Ended' order by category,value`;}

// Build 2856: used by engagement set-up. The live rule for a service, the line staff see, and the one-time flag for the MLRO queue.
export async function amlServiceScope(tx:any,clientId:string,serviceCode:string){
 const rule=(await tx`select rule_id,service_code,applicability,activities,reason,effective_from from erp_private.aml_service_rules where service_code=${serviceCode} and ended_at is null`)[0]||null;
 const prof=(await tx`select p.stage,p.decision,p.next_review,p.edd_required from erp_private.client_aml_profiles p where p.client_id=${clientId}`)[0]||null;
 const now=nairobi();
 let code:string|null=null;
 if(prof?.stage==='Decided'&&['Accept','Accept with conditions'].includes(prof.decision)&&prof.next_review&&day(prof.next_review)!>=now&&!prof.edd_required)code=prof.decision==='Accept'?'APPROVED':'APPROVED_COND';
 const scope=serviceScope(rule,{profileCode:code});
 return {rule,scope:{...scope,applicability:rule?.applicability||null,activities:rule?.activities||[],reason:rule?.reason||null}};
}
export async function raiseAmlServiceFlag(tx:any,a:any,clientId:string,serviceCode:string,setupId:string|null){
 const {rule,scope}=await amlServiceScope(tx,clientId,serviceCode);
 if(!rule||!scope.needs_flag)return {raised:false,scope};
 const done=await tx`insert into erp_private.aml_service_flags(client_id,service_code,rule_id,setup_id,applicability,raised_by) values(${clientId},${serviceCode},${rule.rule_id},${setupId},${rule.applicability},${a.staff_id}) on conflict(client_id,service_code,rule_id) do nothing returning flag_id`;
 return {raised:done.length>0,scope};
}
async function openFlags(tx:any,clientId:string|null){
 // A flag is answered once the MLRO has decided the client's profile after the flag was raised.
 const rows=await tx`select f.flag_id,f.client_id,c.company_name,f.service_code,v.service_name,f.applicability,f.raised_at,erp_private.aml_staff_name(f.raised_by) as raised_by_name,p.stage,p.decision,p.decided_at
  from erp_private.aml_service_flags f join erp_private.clients c on c.client_id=f.client_id and c.deleted_at is null join erp_private.services v on v.service_code=f.service_code 
  left join erp_private.client_aml_profiles p on p.client_id=f.client_id where (${clientId}::uuid is null or f.client_id=${clientId}) order by f.raised_at desc limit 300`;
 return rows.map((r:any)=>({...r,answered:r.stage==='Decided'&&!!r.decided_at&&new Date(r.decided_at)>=new Date(r.raised_at)}));
}

async function build(tx:any,a:any,cid:string){
 const client=(await tx`select client_id,company_name,kra_pin,legal_entity_type from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');
 const profile=(await tx`select p.*,erp_private.aml_staff_name(p.submitted_by) as submitted_by_name,erp_private.aml_staff_name(p.decided_by) as decided_by_name,erp_private.aml_staff_name(p.last_edited_by) as last_edited_by_name,pd.doc_ref as pep_doc_ref,sd.doc_ref as screening_doc_ref
  from erp_private.client_aml_profiles p 
  left join erp_private.documents pd on pd.document_id=p.pep_document_id left join erp_private.documents sd on sd.document_id=p.screening_document_id where p.client_id=${cid}`)[0]||null;
 const lookups=await liveLookups(tx);
 const attentionOf=(c:string,v:string)=>!!lookups.find((l:any)=>l.category===c&&l.value===v)?.attention;
 const selections=await tx`select s.category,s.context,s.lookup_value,s.note,d.doc_ref,d.file_name,
   coalesce((select l.attention from erp_private.aml_lookups l where l.category=s.category and lower(l.value)=lower(s.lookup_value) and l.status<>'Ended' limit 1),false) as attention
  from erp_private.client_aml_selections s left join erp_private.documents d on d.document_id=s.evidence_document_id where s.client_id=${cid} and s.ended_at is null order by s.category,s.context,s.lookup_value`;
 const kyc=(await tx`select is_pep,risk_rating,verified_by is not null as verified,edd_approved_by is not null as edd_approved,review_due from erp_private.client_compliance where client_id=${cid}`)[0]||null;
 const decisions=await tx`select d.kind,d.decision,d.risk_rating,d.risk_reasons,d.conditions,d.note,d.edd_note,d.next_review,d.decided_at,erp_private.aml_staff_name(d.decided_by) as decided_by_name from erp_private.client_aml_decisions d where d.client_id=${cid} order by d.decided_at desc limit 20`;
 const missing=missingInfo({profile,selections,attentionOf});
 const attention=attentionReasons({profile,selections,attentionOf});
 const high=profile?.risk_rating==='High'||(profile?.pep_type&&attentionOf('PEP_TYPE',profile.pep_type));
 const status=profileStatus({profile,missing,eddNeeded:!!high,eddApproved:!!kyc?.edd_approved});
 const mlro=await isMlro(tx),edit=!['INTERN','ADMIN'].includes(a.category_code);
 const gate=(await tx`select gate_enforced from erp_private.aml_policy`)[0];
 const service_flags=await openFlags(tx,cid);
 const docs=await tx`select doc_ref,file_name,category from erp_private.documents where client_id=${cid} and deleted_at is null order by uploaded_at desc limit 200`;
 return {client,profile:profile&&{...profile,next_review:day(profile.next_review),pep_from:day(profile.pep_from),screening_list_date:day(profile.screening_list_date)},selections,lookups,kyc:kyc&&{...kyc,review_due:day(kyc.review_due)},decisions,missing,attention,status,
  can:{edit,submit:edit&&profile?.stage==='Staff review'&&!missing.length,decide:mlro&&profile?.stage==='MLRO review',is_mlro:mlro},gate_enforced:!!gate?.gate_enforced,service_flags,documents:docs,
  options:{countries_contexts:COUNTRY_CONTEXTS,screening:SCREENING,ratings:RATINGS,decisions:DECISIONS,categories:CATEGORY_LABELS,pep_none:PEP_NONE},
  note:'Staff collect and update the facts and attach evidence by reference (DOC-…). The MLRO rates the risk and decides. A risk rating is separate from the decision to accept, restrict or decline.'};
}
async function docId(tx:any,cid:string,ref:any,label:string){
 if(!ref)return null;const r=String(ref).trim().toUpperCase();
 const d=(await tx`select document_id from erp_private.documents where doc_ref=${r} and client_id=${cid} and deleted_at is null`)[0];
 if(!d)fail(400,`${label}: ${r} is not a document of this client.`);return d.document_id;
}

export async function amlAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 // ---------- MLRO-only reads and list upkeep ----------
 if(p.action==='aml_overview'){
  await mustBeMlro(tx,a);const now=nairobi();
  const lookups=await tx`select l.lookup_id,l.category,l.value,l.attention,l.source,l.effective_from,l.status,l.confirmed_at,erp_private.aml_staff_name(l.confirmed_by) as confirmed_by_name from erp_private.aml_lookups l where l.status<>'Ended' order by l.category,l.value`;
  const attentionOf=(c:string,v:string)=>!!lookups.find((l:any)=>l.category===c&&l.value===v)?.attention;
  const rows=await tx`select p.*,c.company_name,k.edd_approved_by is not null as edd_approved,k.verified_by is not null as kyc_verified from erp_private.client_aml_profiles p join erp_private.clients c on c.client_id=p.client_id and c.deleted_at is null left join erp_private.client_compliance k on k.client_id=p.client_id`;
  const sels=await tx`select s.client_id,s.category,s.context,s.lookup_value from erp_private.client_aml_selections s where s.ended_at is null`;
  const items=rows.map((r:any)=>{
   const mine=sels.filter((s:any)=>s.client_id===r.client_id).map((s:any)=>({...s,attention:!!lookups.find((l:any)=>l.category===s.category&&l.value.toLowerCase()===String(s.lookup_value).toLowerCase())?.attention}));
   const missing=missingInfo({profile:r,selections:mine,attentionOf});
   const high=r.risk_rating==='High'||(r.pep_type&&attentionOf('PEP_TYPE',r.pep_type));
   const st=profileStatus({profile:r,missing,eddNeeded:!!high,eddApproved:!!r.edd_approved,now});
   return {client_id:r.client_id,company_name:r.company_name,stage:r.stage,status_code:st.code,status:st.label,risk_rating:r.risk_rating,decision:r.decision,next_review:day(r.next_review),submitted_at:r.submitted_at,screening_status:r.screening_status,pep_type:r.pep_type,attention:attentionReasons({profile:r,selections:mine,attentionOf}),kyc_verified:!!r.kyc_verified,edd_approved:!!r.edd_approved};
  });
  const soon=new Date(Date.now()+3*3600000+30*86400000).toISOString().slice(0,10);
  const by=(f:any)=>items.filter(f).sort((x:any,y:any)=>queueOrder(x)-queueOrder(y));
  const queue:any={
   waiting:by((i:any)=>i.status_code==='MLRO_REVIEW'),
   edd:by((i:any)=>i.status_code==='EDD_REQUIRED'),
   matches:by((i:any)=>['Potential match','Confirmed match'].includes(i.screening_status)&&i.decision!=='Decline'),
   review_due:by((i:any)=>i.stage==='Decided'&&['Accept','Accept with conditions'].includes(i.decision)&&i.next_review&&i.next_review<=soon),
   high_risk:by((i:any)=>i.stage==='Decided'&&i.risk_rating==='High'&&['Accept','Accept with conditions'].includes(i.decision)),
  };
  const flags=(await openFlags(tx,null)).filter((f:any)=>!f.answered);
  queue.services=flags;
  const none=(await tx`select count(*)::int n from erp_private.clients c where c.deleted_at is null and not exists(select 1 from erp_private.client_aml_profiles p where p.client_id=c.client_id)`)[0].n;
  const policy=(await tx`select gate_enforced,gate_changed_at,gate_reason from erp_private.aml_policy`)[0];
  const approvals=await tx`select ap.approved_at,ap.reference,ap.note,erp_private.aml_staff_name(ap.approved_by) as approved_by_name from erp_private.aml_policy_approvals ap order by ap.approved_at desc limit 5`;
  const holders=await tx`select full_name,expires_on from erp_private.aml_mlro_holders()`;
  const undecided=(await tx`select count(*)::int n from erp_private.services s where s.is_active and not exists(select 1 from erp_private.aml_service_rules r where r.service_code=s.service_code and r.ended_at is null)`)[0].n;
  return {queue,counts:{profiles:items.length,without_profile:none,services_undecided:undecided,services_flagged:flags.length,starter_values:lookups.filter((l:any)=>l.status==='Starter').length},lookups,policy:{...policy,gate_changed_at:policy.gate_changed_at||null},approvals,mlro_holders:holders.map((h:any)=>({full_name:h.full_name,expires_on:day(h.expires_on)})),
   can_approve_policy:a.category_code==='PARTNER',categories:CATEGORY_LABELS,
   note:'You maintain the lists, rate the risk and decide. An Engagement Partner records the formal approval of the lists and switches the engagement gate on. Starter values stay marked until you confirm them.'};
 }
 if(p.action==='aml_lookup_add'){
  await mustBeMlro(tx,a);
  const category=String(p.category||'');if(!CATEGORIES.includes(category))fail(400,'Choose the list.');
  const value=text(p.value,120).trim();if(value.length<2)fail(400,'Enter the value.');
  const source=text(p.source,300).trim();if(source.length<3)fail(400,'Say where this value comes from (a source or reference).');
  const eff=date(p.effective_from)||nairobi();
  if((await tx`select 1 from erp_private.aml_lookups where category=${category} and lower(btrim(value))=lower(${value}) and status<>'Ended'`).length)fail(409,`${value} is already on the ${CATEGORY_LABELS[category].toLowerCase()} list.`);
  await tx`insert into erp_private.aml_lookups(category,value,attention,source,effective_from,status,created_by,confirmed_by,confirmed_at) values(${category},${value},${!!p.attention},${source},${eff}::date,'Confirmed',${a.staff_id},${a.staff_id},now())`;
  return {ok:true};
 }
 if(p.action==='aml_lookup_confirm'){
  await mustBeMlro(tx,a);
  const ids=(Array.isArray(p.lookup_ids)?p.lookup_ids:[]).slice(0,400).map((x:any)=>uuid(x));if(!ids.length)fail(400,'Choose the values to confirm.');
  const done=await tx`update erp_private.aml_lookups set status='Confirmed',confirmed_by=${a.staff_id},confirmed_at=now() where lookup_id=any(${ids}::uuid[]) and status='Starter' returning lookup_id`;
  return {ok:true,confirmed:done.length};
 }
 if(p.action==='aml_lookup_end'){
  await mustBeMlro(tx,a);const why=text(p.reason,500).trim();if(why.length<5)fail(400,'Say why this value ends (at least 5 characters).');
  const done=await tx`update erp_private.aml_lookups set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${why} where lookup_id=${uuid(p.lookup_id)} and status<>'Ended' returning lookup_id`;
  if(!done.length)fail(404,'That value is already ended or does not exist.');return {ok:true};
 }

 if(p.action==='aml_service_rules_read'){
  if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The AML service rules are read by staff with client access.');
  const services=await tx`select s.service_code,s.service_group,s.service_name,r.rule_id,r.applicability,r.activities,r.reason,r.source,r.effective_from,r.set_at,erp_private.aml_staff_name(r.set_by) as set_by_name from erp_private.services s left join erp_private.aml_service_rules r on r.service_code=s.service_code and r.ended_at is null where s.is_active order by s.service_group,s.service_name`;
  const history=await tx`select r.service_code,r.applicability,r.reason,r.set_at,r.ended_at,r.ended_reason,erp_private.aml_staff_name(r.set_by) as set_by_name from erp_private.aml_service_rules r where r.ended_at is not null order by r.ended_at desc limit 100`;
  const acts=await tx`select value from erp_private.aml_lookups where category='SERVICE_ACTIVITY' and status<>'Ended' order by value`;
  return {services:services.map((r:any)=>({...r,effective_from:day(r.effective_from),status:r.rule_id?r.applicability:'MLRO has not decided'})),history,activity_values:acts.map((x:any)=>x.value),applicability:APPLICABILITY,can_set:await isMlro(tx),
   note:'A service without a rule is shown as not decided. It is not treated as exempt.'};
 }
 if(p.action==='aml_service_rule_set'){
  await mustBeMlro(tx,a);
  const code=text(p.service_code,40);if(!(await tx`select 1 from erp_private.services where service_code=${code} and is_active`).length)fail(404,'Choose a service in the catalogue.');
  const acts=(await tx`select value from erp_private.aml_lookups where category='SERVICE_ACTIVITY' and status<>'Ended'`).map((x:any)=>x.value);
  const r=cleanServiceRule(p,{activityValues:acts});if(!r.ok)fail(400,r.errors[0].error);
  await tx`select pg_advisory_xact_lock(hashtextextended(${'aml-rule:'+code},0))`;
  const live=(await tx`select rule_id,applicability,activities from erp_private.aml_service_rules where service_code=${code} and ended_at is null for update`)[0];
  if(live&&live.applicability===r.value.applicability&&JSON.stringify([...live.activities].sort())===JSON.stringify([...r.value.activities].sort()))fail(409,'That is already the rule for this service. Change the choice or the activities, or leave it.');
  if(live)await tx`update erp_private.aml_service_rules set ended_by=${a.staff_id},ended_at=now(),ended_reason=${'Replaced by a new rule: '+r.value.reason.slice(0,200)} where rule_id=${live.rule_id}`;
  await tx`insert into erp_private.aml_service_rules(service_code,applicability,activities,reason,source,effective_from,set_by) values(${code},${r.value.applicability},${r.value.activities},${r.value.reason},${r.value.source},${r.value.effective_from||nairobi()}::date,${a.staff_id})`;
  return {ok:true,replaced:!!live};
 }
 if(p.action==='aml_service_rule_end'){
  await mustBeMlro(tx,a);const why=text(p.reason,500).trim();if(why.length<5)fail(400,'Say why this rule ends (at least 5 characters).');
  const done=await tx`update erp_private.aml_service_rules set ended_by=${a.staff_id},ended_at=now(),ended_reason=${why} where service_code=${text(p.service_code,40)} and ended_at is null returning rule_id`;
  if(!done.length)fail(404,'This service has no live rule.');return {ok:true};
 }
 // ---------- Partner: formal approval and the gate ----------
 if(p.action==='aml_policy_approve'){
  if(a.category_code!=='PARTNER')fail(403,'Only an Engagement Partner records the formal approval of the POCAMLA lists.');
  const ref=text(p.reference,300).trim();if(ref.length<3)fail(400,'Record the Partner or Board approval reference (for example the minute or resolution).');
  const snap=await tx`select category,status,count(*)::int n from erp_private.aml_lookups where status<>'Ended' group by category,status order by category,status`;
  await tx`insert into erp_private.aml_policy_approvals(approved_by,reference,note,lists_snapshot) values(${a.staff_id},${ref},${p.note?text(p.note,1000,false).trim()||null:null},${tx.json({counts:snap})})`;
  return {ok:true};
 }
 if(p.action==='aml_gate_set'){
  if(a.category_code!=='PARTNER')fail(403,'Only an Engagement Partner switches the POCAMLA gate.');
  const on=!!p.enforced,why=text(p.reason,500).trim();if(why.length<5)fail(400,'Say why (at least 5 characters).');
  await tx`update erp_private.aml_policy set gate_enforced=${on},gate_changed_by=${a.staff_id},gate_changed_at=now(),gate_reason=${why}`;
  return {ok:true,gate_enforced:on};
 }
 // ---------- Client profile ----------
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The AML profile is kept by staff with client access.');
 const cid=uuid(p.client_id);
 // Build 2865: the client file's AML scope tab. A summary only: the profile stage, the gate, and the MLRO's rule for each service this client has work for.
 if(p.action==='aml_scope_read'){
  const client=(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];if(!client)fail(403,'This client is unavailable to your account.');
  const prof=(await tx`select p.stage,p.decision,p.risk_rating,p.next_review,p.edd_required,p.decided_at,erp_private.aml_staff_name(p.decided_by) as decided_by_name from erp_private.client_aml_profiles p where p.client_id=${cid}`)[0]||null;
  const gate=(await tx`select gate_enforced from erp_private.aml_policy`)[0];
  const codes=await tx`select distinct pr.service_code,v.service_name from erp_private.projects pr join erp_private.services v on v.service_code=pr.service_code where pr.client_id=${cid} and pr.status<>'Archived' and pr.deleted_at is null order by v.service_name`;
  const services:any[]=[];for(const c of codes)services.push({service_code:c.service_code,service_name:c.service_name,...(await amlServiceScope(tx,cid,c.service_code)).scope});
  const flags=await openFlags(tx,cid);
  return {client,profile:prof&&{...prof,next_review:day(prof.next_review)},gate_enforced:!!gate?.gate_enforced,services,flags,mlro:await isMlro(tx),
   note:'This is a summary. The MLRO decides which services need POCAMLA questions. An undecided service is not treated as exempt.'};
 }
 if(p.action==='aml_profile_read')return await build(tx,a,cid);
 const view=await build(tx,a,cid),old=(await tx`select * from erp_private.client_aml_profiles where client_id=${cid} for update`)[0]||null;
 if(old&&p.revision!==undefined&&String(old.revision)!==revision(p.revision))fail(409,'The profile changed. Refresh it first.');

 if(p.action==='aml_profile_save'){
  const lookups=view.lookups,pepTypes=lookups.filter((l:any)=>l.category==='PEP_TYPE').map((l:any)=>l.value);
  const f=cleanProfile(p.fields||{},{pepTypes}),s=cleanSelections(p.selections,lookups);
  const errors=[...f.errors,...s.errors.map((e:any)=>({key:'selection:'+e.row,error:e.error}))];
  if(errors.length)return {...view,saved:false,errors};
  const pepDoc=p.fields?.pep_doc_ref!==undefined?await docId(tx,cid,p.fields.pep_doc_ref,'PEP evidence'):(old?.pep_document_id||null);
  const scrDoc=p.fields?.screening_doc_ref!==undefined?await docId(tx,cid,p.fields.screening_doc_ref,'Screening evidence'):(old?.screening_document_id||null);
  const merged:any={};for(const k of PROFILE_TEXT)merged[k]=f.value[k]!==undefined?f.value[k]:(old?(old[k]instanceof Date?day(old[k]):old[k]):null);
  if(!merged.screening_status)merged.screening_status='Not screened';
  const rows:any[]=[];for(const r of s.rows)rows.push({...r,document_id:await docId(tx,cid,r.doc_ref,r.lookup_value+' evidence')});
  const cur=await tx`select selection_id,category,context,lookup_value,note,evidence_document_id from erp_private.client_aml_selections where client_id=${cid} and ended_at is null`;
  const keyOf=(x:any)=>[x.category,x.context||'',String(x.lookup_value).toLowerCase()].join('|');
  const same=(c:any,r:any)=>(c.note||null)===(r.note||null)&&String(c.evidence_document_id||'')===String(r.document_id||'');
  const toEnd=cur.filter((c:any)=>{const r=rows.find((x:any)=>keyOf(x)===keyOf(c));return !r||!same(c,r);});
  const toAdd=rows.filter((r:any)=>{const c=cur.find((x:any)=>keyOf(x)===keyOf(r));return !c||!same(c,r);});
  const profileChanged=!old||PROFILE_TEXT.some(k=>String(merged[k]??'')!==String((old[k]instanceof Date?day(old[k]):old[k])??''))||String(pepDoc||'')!==String(old.pep_document_id||'')||String(scrDoc||'')!==String(old.screening_document_id||'');
  if(!profileChanged&&!toEnd.length&&!toAdd.length)return {...view,saved:true,changed:false};
  if(!old)await tx`insert into erp_private.client_aml_profiles(client_id,stage,last_edited_by) values(${cid},'Staff review',${a.staff_id})`;
  await tx`update erp_private.client_aml_profiles set stage='Staff review',last_edited_by=${a.staff_id},purpose_of_relationship=${merged.purpose_of_relationship},expected_activity=${merged.expected_activity},expected_size_frequency=${merged.expected_size_frequency},
   pep_type=${merged.pep_type},pep_role=${merged.pep_role},pep_jurisdiction=${merged.pep_jurisdiction},pep_from=${merged.pep_from}::date,pep_relationship=${merged.pep_relationship},pep_document_id=${pepDoc},
   screening_status=${merged.screening_status},screening_list_source=${merged.screening_list_source},screening_list_date=${merged.screening_list_date}::date,screening_note=${merged.screening_note},screening_document_id=${scrDoc} where client_id=${cid}`;
  for(const c of toEnd)await tx`update erp_private.client_aml_selections set ended_by=${a.staff_id},ended_at=now() where selection_id=${c.selection_id}`;
  for(const r of toAdd)await tx`insert into erp_private.client_aml_selections(client_id,category,context,lookup_value,note,evidence_document_id,created_by) values(${cid},${r.category},${r.context},${r.lookup_value},${r.note},${r.document_id},${a.staff_id})`;
  return {...(await build(tx,a,cid)),saved:true,changed:true};
 }
 if(!old)fail(400,'Save the profile first.');
 if(p.action==='aml_profile_submit'){
  if(old.stage!=='Staff review')fail(400,'This profile is already with the MLRO or decided. Change it first to refer it again.');
  if(view.missing.length)fail(400,'Fill the items marked red first: '+view.missing.map((m:any)=>m.label).join(', ')+'.');
  await tx`update erp_private.client_aml_profiles set stage='MLRO review',submitted_by=${a.staff_id},submitted_at=now(),return_note=null where client_id=${cid}`;
  return {...(await build(tx,a,cid)),submitted:true};
 }
 // ---------- MLRO actions on a referred profile ----------
 await mustBeMlro(tx,a);
 if(old.stage!=='MLRO review')fail(400,'This profile has not been referred to the MLRO.');
 if(p.action==='aml_return'||p.action==='aml_edd_request'){
  const note=text(p.note,2000).trim();if(note.length<5)fail(400,'Say what is needed (at least 5 characters).');
  if(p.action==='aml_return')await tx`update erp_private.client_aml_profiles set stage='Staff review',return_note=${note} where client_id=${cid}`;
  else await tx`update erp_private.client_aml_profiles set stage='Staff review',edd_required=true,edd_note=${note},return_note=${note} where client_id=${cid}`;
  await tx`insert into erp_private.client_aml_decisions(client_id,kind,note,decided_by) values(${cid},${p.action==='aml_return'?'Returned for information':'EDD requested'},${note},${a.staff_id})`;
  return {...(await build(tx,a,cid)),done:true};
 }
 if(p.action==='aml_decide'){
  const attention=(view.lookups.find((l:any)=>l.category==='PEP_TYPE'&&l.value===old.pep_type)?.attention)||false;
  const needsEdd=p.risk_rating==='High'||attention;
  const c=cleanDecision(p,{needsEdd});
  if(!c.ok)return {...view,decided:false,errors:c.errors};
  const v=c.value,accept=v.decision==='Accept'||v.decision==='Accept with conditions';
  if(accept&&needsEdd){
   const k=(await tx`select client_id,verified_by from erp_private.client_compliance where client_id=${cid} for update`)[0];
   if(!k||!k.verified_by)return {...view,decided:false,errors:[{key:'edd_note',error:'Enhanced due diligence applies. A Manager or Partner must verify the KYC file first; then you can approve.'}]};
   await tx`update erp_private.client_compliance set edd_approved_by=${a.staff_id},edd_approved_at=now(),notes=notes||E'\nEDD (MLRO): '||${v.edd_note} where client_id=${cid}`;
  }
  await tx`update erp_private.client_aml_profiles set stage='Decided',decision=${v.decision},decision_conditions=${v.decision_conditions},decision_reason=${v.decision_reason},decided_by=${a.staff_id},decided_at=now(),
   risk_rating=${v.risk_rating},risk_reasons=${v.risk_reasons},mitigating_controls=${v.mitigating_controls},risk_override_reason=${v.risk_override_reason},next_review=${v.next_review}::date,review_reason=${v.review_reason},edd_required=false,edd_note=${v.edd_note},return_note=null where client_id=${cid}`;
  await tx`insert into erp_private.client_aml_decisions(client_id,kind,decision,risk_rating,risk_reasons,conditions,edd_note,note,next_review,decided_by) values(${cid},'Decision',${v.decision},${v.risk_rating},${v.risk_reasons},${v.decision_conditions},${v.edd_note},${v.decision_reason},${v.next_review}::date,${a.staff_id})`;
  return {...(await build(tx,a,cid)),decided:true};
 }
 return undefined;
}
