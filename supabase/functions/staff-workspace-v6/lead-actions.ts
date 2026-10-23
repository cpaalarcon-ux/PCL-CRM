import {fail,text,uuid,choice,date,revision,branches} from './validation.mjs';
import {one,leader} from './suite-actions.ts';
export async function leadAction(tx:any,a:any,p:any):Promise<any>{
 if(!['lead_save','lead_convert'].includes(p.action))return undefined;
 leader(a);
 const old=p.lead_id?one(await tx`select * from erp_private.leads where lead_id=${uuid(p.lead_id)} for update`):null;
 if(p.action==='lead_convert'&&old?.stage==='Converted')return {client_id:old.client_id,already_converted:true};
 if(old&&String(old.revision)!==revision(p.revision))fail(409,'This lead changed. Refresh before saving.');
 if(old?.stage==='Converted')fail(400,'Update the linked client after conversion.');
 if(p.action==='lead_save'){
  const firm=uuid(p.firm_id),name=text(p.company_name,200),sector=text(p.primary_sector,100),branch=choice(p.branch_location,branches),service=text(p.service_code,80),pin=p.kra_pin?text(p.kra_pin,11).toUpperCase():null;
  if(pin&&!/^[A-Z][0-9]{9}[A-Z]$/.test(pin))fail(400,'Check the KRA PIN format.');
  const email=text(p.email||'',200,false);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Check the contact email address.');
  one(await tx`select firm_id from erp_private.firms where firm_id=${firm} and is_active and deleted_at is null and erp_private.firm_allowed(firm_id)`);
  one(await tx`select sector_id from erp_private.sectors where name=${sector} and deleted_at is null`);
  one(await tx`select service_code from erp_private.services where service_code=${service}`);
  if(old&&old.firm_id!==firm)fail(400,'Keep the same handling firm or create a separate lead.');
  const stage=choice(p.stage||'New Lead',['New Lead','Contacted','Scoping & KYC','Proposal Sent','Negotiation','Accepted','Lost']),temperature=choice(p.temperature||'Cold',['Cold','Warm','Hot']),source=choice(p.lead_source,['Referral','Website','Networking','Existing Client (Cross-sell)','Tender','Other']),contact=text(p.contact_name||'',160,false),phone=text(p.phone||'',40,false),notes=text(p.notes||'',8000,false),followup=date(p.followup_date);
  if(old){await tx`update erp_private.leads set company_name=${name},kra_pin=${pin},contact_name=${contact},email=${email},phone=${phone},primary_sector=${sector},branch_location=${branch},service_code=${service},lead_source=${source},temperature=${temperature},stage=${stage},notes=${notes},followup_date=${followup} where lead_id=${old.lead_id}`;return {lead_id:old.lead_id};}
  const request=uuid(p.request_id),exists=await tx`select lead_id from erp_private.leads where request_id=${request}`;if(exists.length)return exists[0];
  return one(await tx`insert into erp_private.leads(request_id,firm_id,company_name,kra_pin,contact_name,email,phone,primary_sector,branch_location,service_code,lead_source,temperature,stage,notes,followup_date,owner_id) values(${request},${firm},${name},${pin},${contact},${email},${phone},${sector},${branch},${service},${source},${temperature},${stage},${notes},${followup},${a.staff_id}) returning lead_id`);
 }
 if(!old)fail(400,'Choose a lead to convert.');
 if(old.stage==='Lost')fail(400,'Reopen this lead before preparing a client record.');
 let cid=p.client_id?uuid(p.client_id):null;
 if(cid){const client=one(await tx`select client_id,kra_pin from erp_private.clients where client_id=${cid}`);if(old.kra_pin&&client.kra_pin&&old.kra_pin!==client.kra_pin)fail(400,'The selected client has a different KRA PIN.');}
 else {
  // Serialise the duplicate check with other lead conversions; the PIN index also protects CRM imports.
  await tx`select pg_advisory_xact_lock(hashtextextended(${old.kra_pin||old.company_name.toLowerCase().replace(/\s+/g,' ')},0))`;
  if((await tx`select client_id from erp_private.clients where deleted_at is null and ((${old.kra_pin}::text is not null and kra_pin=${old.kra_pin}) or lower(regexp_replace(trim(company_name),'[[:space:]]+',' ','g'))=lower(regexp_replace(trim(${old.company_name}),'[[:space:]]+',' ','g')))` ).length)fail(409,'A matching client exists. Choose Link existing client to avoid a duplicate.');
  cid=crypto.randomUUID();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,record_status,owner_staff_id) values(${cid},${old.company_name},${old.kra_pin},${old.primary_sector},${old.branch_location},'Lead',${a.staff_id})`;
 }
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${old.firm_id}) on conflict(client_id,firm_id) do nothing`;
 one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${old.firm_id} and deleted_at is null`);
 if(old.contact_name&&!p.client_id)await tx`insert into erp_private.client_contacts(client_id,full_name,email_address,phone_number) values(${cid},${old.contact_name},${old.email},${old.phone})`;
 await tx`update erp_private.leads set stage='Converted',client_id=${cid},converted_at=now() where lead_id=${old.lead_id}`;
 return {client_id:cid,message:'Client record prepared. Complete KYC and the signed engagement letter before activating a project.'};
}
