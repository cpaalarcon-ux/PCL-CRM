// Test helper (build 2885): put the client file in order and declare and approve the client pages of a year, so a pack can reach the final stage.
// Verified facts and directors are inserted directly (fictional); the three declared pages are declared by ASSISTANT and approved by MANAGER.
export async function approvePages({tx,as,Pg,per,getStatements,asOf,form='Company'}){
 const cid=per.client_id,rec=(await tx`select staff_id from erp_private.staff_members where category_code='ASSISTANT' limit 1`)[0].staff_id,ver=(await tx`select staff_id from erp_private.staff_members where category_code='PARTNER' limit 1`)[0].staff_id;
 const facts=[['registered_address','Fictional House, 4th Floor, Fictional Road, Nairobi']];
 if(form==='Company')facts.push(['registration_number','CPR/2020/000001'],['incorporation_date','2020-03-02']);
 for(const [k,v] of facts){
  if((await tx`select 1 from erp_private.client_field_facts where client_id=${cid} and field_key=${k} and status<>'Superseded'`).length)continue;
  const made=(await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,source_reference,recorded_by) values(${cid},${k},${v},'Prior record','Fictional register extract',${rec}) returning fact_id`)[0];
  await tx`update erp_private.client_field_facts set status='Verified',verified_by=${ver},verified_at=now(),verification_note='Fictional check' where fact_id=${made.fact_id}`;
 }
 if(form==='Company'&&!(await tx`select 1 from erp_private.client_parties where client_id=${cid} and role='Director'`).length){
  await tx`insert into erp_private.client_parties(client_id,role,party_kind,full_name,appointed_on,created_by) values(${cid},'Director','Individual','Fictional Amani Director','2020-03-02',${rec})`;
  await tx`insert into erp_private.client_parties(client_id,role,party_kind,full_name,appointed_on,created_by) values(${cid},'Director','Individual','Fictional Zawadi Director','2021-06-01',${rec})`;
 }
 const read=await as('MANAGER',a=>Pg.pagesAction(tx,a,per,{action:'ledger_pages_read'},getStatements,asOf));
 const signers=read.candidates.slice(0,2);
 const fields={ENTITY_INFO:{bankers:'Fictional Bank Limited, Fictional Branch',auditors:'Fictional Auditors LLP',secretary:'Fictional Secretaries Limited',advocates:'Fictional Advocates'},
  REPORT:{review:'Fictional review: the business traded steadily and results were in line with expectations.',dividends:'No dividend was declared for the year.'},
  RESPONSIBILITIES:{statement:read.declared.find(d=>d.code==='RESPONSIBILITIES').prefill.statement,approved_on:'2027-02-15',signatories:signers}};
 for(const d of read.declared){
  if(d.state==='Approved')continue;
  const fs=Object.fromEntries(Object.entries(fields[d.code]).filter(([k])=>d.fields.some(f=>f.key===k)||['approved_on','signatories'].includes(k)));
  const x=await as('ASSISTANT',a=>Pg.pagesAction(tx,a,per,{action:'ledger_page_declare',code:d.code,state:'Declared',fields:fs},getStatements,asOf));
  await as('MANAGER',a=>Pg.pagesAction(tx,a,per,{action:'ledger_page_review',page_id:x.page_id,decision:'Approved'},getStatements,asOf));
 }
 return await as('MANAGER',a=>Pg.pagesAction(tx,a,per,{action:'ledger_pages_read'},getStatements,asOf));
}
