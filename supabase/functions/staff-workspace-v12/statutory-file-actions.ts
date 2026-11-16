import {fail,uuid,choice,revision} from './validation.mjs';
import {logPayrollRead} from './payroll-access-log.ts';
import {LAYOUTS,KINDS,ID_TYPES,P10_EMPLOYEE_TYPES,identifierIssues,buildFile,totalsAgree,reconcileToJournal,toCsv,fileName} from './statutory-file-rules.mjs';
import {profileInForce} from './export-profile-rules.mjs';
import {listProfiles} from './export-profile-actions.ts';
import {returnAllowed} from './client-choices-rules.mjs';
// Build 2829: statutory return files (NSSF, SHIF, PAYE P10) from a confirmed payroll summary.
// Preparing a file never changes anything. Releasing one (release=true) is allowed only when every required column is filled from real data, the file's totals equal
// the confirmed summary, and the summary agrees with the POSTED payroll journal account by account. The release is recorded (insert-only) with a hash of the file.
const ACTIONS=['statutory_file_read','statutory_file_prepare','payroll_register_identifiers'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const clean=(v:any)=>String(v??'').replace(/\s+/g,' ').trim();
const blank=(v:any)=>{const s=clean(v);return s?s:null;};
const IDENTIFIER_FIELDS=['surname','other_names','id_type','nssf_number','sha_number','payroll_number','p10_employee_type','exemption_certificate'];

async function context(tx:any,p:any){
 const project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`);
 const client=one(await tx`select company_name from erp_private.clients where client_id=${project.client_id}`);
 return {project,clientName:client.company_name as string};
}
async function postedJournal(tx:any,importId:string,projectId:string){
 const j=(await tx`select j.journal_id,j.reference,j.status from erp_private.ledger_sources s join erp_private.ledger_journals j on j.journal_id=s.journal_id where s.source_kind='Period import' and s.source_key=${importId} and j.project_id=${projectId} order by (j.status='Posted') desc,j.created_at desc limit 1`)[0];
 if(!j||j.status!=='Posted')return null;
 const lines=await tx`select account_code,round((coalesce(sum(credit),0)-coalesce(sum(debit),0))*100)::bigint as net from erp_private.ledger_lines where journal_id=${j.journal_id} group by account_code`;
 const by:any={};for(const l of lines)by[l.account_code]=Number(l.net);
 return {journal_id:j.journal_id,reference:j.reference,by_account:by};
}
const money=(c:number)=>Math.round(c)/100;
const showTotals=(t:any)=>Object.fromEntries(Object.entries(t||{}).map(([k,v])=>[k,k==='employees'||k==='nita_members'||k==='total_employees'?v:money(Number(v))]));

export async function statutoryFileAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Statutory files are prepared by staff with client access.');
 const {project,clientName}=await context(tx,p),cid=project.client_id;
 if(p.action==='statutory_file_read'){
  const months=await tx`select i.import_id,i.starts_on,i.ends_on,i.revision,jsonb_array_length(coalesce(i.payload->'calculated','[]'::jsonb)) as employees,
    exists(select 1 from erp_private.ledger_sources s join erp_private.ledger_journals j on j.journal_id=s.journal_id where s.source_kind='Period import' and s.source_key=i.import_id::text and j.status='Posted') as journal_posted
    from erp_private.period_imports i where i.client_id=${cid} and i.kind='Payroll' and i.status='Confirmed' order by i.starts_on desc limit 36`;
  const exports=await tx`select export_id,import_id,file_kind,layout_code,month,row_count,generated_at,erp_private.reviewer_label(generated_by) as generated_by_name from erp_private.statutory_file_exports where client_id=${cid} order by generated_at desc limit 30`;
  // Build 2841: the returns chosen for this client's payroll service. Nothing chosen yet means every return is offered, as before.
  const chosen=(await tx`select return_code,effective_from,effective_to,status from erp_private.client_payroll_returns where client_id=${cid}`).map((r:any)=>({return_code:r.return_code,effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null,status:r.status}));
  return {chosen:{configured:chosen.length>0,rows:chosen},months:months.map((m:any)=>({import_id:m.import_id,month:day(m.starts_on).slice(0,7),starts_on:day(m.starts_on),ends_on:day(m.ends_on),employees:Number(m.employees),journal_posted:m.journal_posted,allowed_kinds:KINDS.filter((k:string)=>returnAllowed(chosen,k,day(m.starts_on),day(m.ends_on)).allowed)})),
   exports:exports.map((x:any)=>({...x,month:day(x.month).slice(0,7)})),
   layouts:KINDS.map(k=>({kind:k,code:LAYOUTS[k as keyof typeof LAYOUTS].code,label:LAYOUTS[k as keyof typeof LAYOUTS].label,agency:LAYOUTS[k as keyof typeof LAYOUTS].agency,source:LAYOUTS[k as keyof typeof LAYOUTS].source,columns:LAYOUTS[k as keyof typeof LAYOUTS].columns})),
   id_types:ID_TYPES,p10_employee_types:P10_EMPLOYEE_TYPES};
 }
 if(project.status==='Archived')fail(400,'Archived projects retain read-only history.');
 if(p.action==='payroll_register_identifiers'){
  const person=one(await tx`select person_id,status,revision from erp_private.client_payroll_people where person_id=${uuid(p.person_id)} and client_id=${cid}`);
  if(String(person.revision)!==revision(p.revision))fail(409,'The register changed. Refresh first.');
  if(person.status==='Left')fail(400,'A person who has left stays as recorded.');
  const x:any={};for(const k of IDENTIFIER_FIELDS)x[k]=blank(p[k]);x.disability=p.disability===true||p.disability==='true'||p.disability==='yes';
  const issues=identifierIssues(x);if(issues.length)fail(400,issues.join(' '));
  if(x.id_type)choice(x.id_type,ID_TYPES);
  const type=x.p10_employee_type||'Primary Employee';choice(type,P10_EMPLOYEE_TYPES);
  if(x.payroll_number){const dup=(await tx`select name from erp_private.client_payroll_people where client_id=${cid} and status='Active' and payroll_number=${x.payroll_number} and person_id<>${person.person_id} limit 1`)[0];if(dup)fail(409,`Payroll number ${x.payroll_number} is already used by ${dup.name}.`);}
  await tx`update erp_private.client_payroll_people set surname=${x.surname},other_names=${x.other_names},id_type=${x.id_type},nssf_number=${x.nssf_number?x.nssf_number.toUpperCase():null},sha_number=${x.sha_number?x.sha_number.toUpperCase():null},payroll_number=${x.payroll_number},p10_employee_type=${type},disability=${x.disability},exemption_certificate=${x.disability?x.exemption_certificate:null} where person_id=${person.person_id} and client_id=${cid}`;
  return {saved:true};
 }
 // statutory_file_prepare
 const kind=choice(String(p.kind||''),KINDS),imp=one(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and client_id=${cid} and kind='Payroll'`);
 if(imp.status!=='Confirmed')fail(409,'A statutory file is built only from a confirmed payroll summary. This one is '+String(imp.status).toLowerCase()+'.');
 await logPayrollRead(tx,a,{client_id:cid,project_id:project.project_id,import_id:imp.import_id,surface:'Payroll file',detail:`${kind} file prepared`});
 const payload=imp.payload||{},employees=payload.employees||[],calculated=payload.calculated||[];
 if(!calculated.length)fail(400,'The confirmed summary has no calculated employees.');
 const month=day(imp.starts_on).slice(0,7),layout=LAYOUTS[kind as keyof typeof LAYOUTS];
 const chosenRows=await tx`select return_code,effective_from,effective_to from erp_private.client_payroll_returns where client_id=${cid}`;
 const allowed=returnAllowed(chosenRows.map((r:any)=>({return_code:r.return_code,effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null})),kind,day(imp.starts_on),day(imp.ends_on));
 if(!allowed.allowed)fail(409,allowed.problem||'This return is not chosen for this client.');
 const people=await tx`select person_id,name,kra_pin,national_id,phone,surname,other_names,id_type,nssf_number,sha_number,payroll_number,p10_employee_type,disability,exemption_certificate from erp_private.client_payroll_people where client_id=${cid} order by created_at`;
 // The profile in force on the last day of the payroll month decides the formatting. A later profile never changes an earlier month.
 const profiles=(await listProfiles(tx)).map((x:any)=>({...x,effective_from:day(x.effective_from),effective_to:x.effective_to?day(x.effective_to):null})),profile=profileInForce(profiles,kind,day(imp.ends_on));
 const built:any=buildFile(kind,{employees,calculated,people,profile});
 const issues:string[]=[...built.issues,...totalsAgree(kind,built.totals,calculated)];
 // The posted journal and the client's active payroll mappings: the file must agree with the books.
 const posted=await postedJournal(tx,imp.import_id,project.project_id);
 const maps=await tx`select routing_id,version,module,routing_code,item_code,erp_account_code,side,effective_from,effective_to,status from erp_private.client_routing_map where client_id=${cid} and module='Payroll' and status='Active'`;
 const reconciliation=reconcileToJournal({calculated,maps,end:day(imp.ends_on),posted});
 issues.push(...reconciliation.problems);
 const needsDefaults=kind==='PAYE_P10'&&built.notInRegister>0;
 if(needsDefaults&&p.confirm_defaults!==true)issues.push(`Confirm that Primary Employee and no disability apply to the ${built.notInRegister} ${built.notInRegister===1?'person who is':'people who are'} not on the payroll register, or add them to the register.`);
 const ready=issues.length===0&&built.rows.length>0;
 if(!built.rows.length&&!issues.length)issues.push('There are no rows to put in this file.');
 const out:any={kind,layout:{code:layout.code,label:layout.label,agency:layout.agency,source:layout.source,columns:layout.columns},month,import_id:imp.import_id,client_name:clientName,
  ready,issues,notes:built.notes||[],row_count:built.rows.length,totals:showTotals(built.totals),section_e:built.section_e?showTotals(built.section_e):null,reconciliation,
  preview:built.rows.slice(0,200),needs_default_confirmation:needsDefaults,not_the_agency_file:kind==='PAYE_P10',rounding:built.rounding||{},
  profile:profile?{profile_id:profile.profile_id,version:profile.version,template_version:profile.template_version,rounding_rule:profile.rounding_rule,verified_against:profile.verified_against,verified_on:day(profile.verified_on)}:null,
  extra_tables:(built.extra_tables||[]).map((x:any)=>({key:x.key,label:x.label,columns:x.columns,row_count:x.rows.length,totals:showTotals(x.totals),preview:x.rows.slice(0,50)}))};
 if(p.release===true){
  if(!ready)fail(409,'This file is not ready to release: '+issues.slice(0,3).join(' ')+(issues.length>3?` (and ${issues.length-3} more)`:''));
  const csv=toCsv(layout.columns,built.rows),sha=await hex(csv);
  const rec=one(await tx`insert into erp_private.statutory_file_exports(client_id,project_id,import_id,journal_id,file_kind,layout_code,month,row_count,totals,reconciliation,notes,content_sha256,generated_by,profile_id,profile_version,rounding)
   values(${cid},${project.project_id},${imp.import_id},${posted!.journal_id},${kind},${layout.code},${day(imp.starts_on)},${built.rows.length},${tx.json({totals:out.totals,section_e:out.section_e,extra:out.extra_tables.map((x:any)=>({key:x.key,row_count:x.row_count,totals:x.totals}))})},${tx.json({status:reconciliation.status,lines:reconciliation.lines,journal_reference:reconciliation.journal_reference})},${tx.json(out.notes)},${sha},${a.staff_id},${profile!.profile_id},${profile!.version},${tx.json(built.rounding||{})}) returning export_id`);
  out.released=true;out.export_id=rec.export_id;out.csv=csv;out.file_name=fileName(kind,month,clientName);out.sha256=sha;
  out.extra_files=(built.extra_tables||[]).map((x:any)=>({key:x.key,label:x.label,file_name:fileName(x.file_prefix,month,clientName),csv:toCsv(x.columns,x.rows)}));
 }
 return out;
}
