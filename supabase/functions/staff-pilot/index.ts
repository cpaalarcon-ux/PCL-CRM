import { createClient } from 'supabase';
import postgres from 'postgres';
import { HttpError,fail,text,uuid,choice,date,password,login,revision,staffInput,fileType,allowedOrigin,sectors,branches,statuses,documentObjectKey,assertDocumentLinks } from './validation.mjs';

const url=Deno.env.get('SUPABASE_URL')!;
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')||JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default;
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const sql=postgres(Deno.env.get('SUPABASE_DB_URL')!,{prepare:false,max:2,idle_timeout:10,connect_timeout:10});
const BUCKET='staff-pilot-private';
const SETUP_BASE='https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot.html';
const sha=async(s:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s).buffer:new Uint8Array(s).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
const nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
const decode=(jwt:string)=>JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
const deny=()=>fail(403,'This record or action is not available to your account.');
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))deny();};
const one=(rows:any[])=>{if(!rows.length)deny();return rows[0];};
async function limit(key:string,max=20){
 const hash=await sha(key);
 const [r]=await sql`insert into erp_private.auth_limits(bucket_hash,window_start,attempts) values(${hash},now(),1)
 on conflict(bucket_hash) do update set attempts=case when auth_limits.window_start<now()-interval '15 minutes' then 1 else auth_limits.attempts+1 end,
 window_start=case when auth_limits.window_start<now()-interval '15 minutes' then now() else auth_limits.window_start end returning attempts`;
 if(r.attempts>max)fail(429,'Too many attempts. Wait 15 minutes before trying again.');
}
async function identity(req:Request){
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 if(!jwt||jwt.length>5000)fail(401,'Sign in to continue.');
 const {data,error}=await admin.auth.getUser(jwt);
 if(error||!data.user)fail(401,'Your session has expired. Sign in again.');
 const claims=decode(jwt);
 if(claims.sub!==data.user.id||!claims.session_id)fail(401,'Invalid session.');
 const rows=await sql`update erp_private.pilot_sessions p set last_seen_at=now() from erp_private.staff_members s,auth.sessions a
 where p.session_id=${claims.session_id}::uuid and p.staff_id=s.staff_id and a.id=p.session_id and a.user_id=s.auth_user_id
 and s.auth_user_id=${data.user.id}::uuid and s.access_status='Active' and s.deleted_at is null
 and (s.contract_end_date is null or s.contract_end_date>=(now() at time zone 'Africa/Nairobi')::date)
 and p.revoked_at is null and p.expires_at>now() and p.last_seen_at>now()-interval '20 minutes'
 and p.issued_at>=s.sessions_invalid_before returning p.staff_id`;
 if(!rows.length)fail(401,'Your session is inactive or expired. Sign in again.');
 return {jwt,claims};
}
async function scoped(id:any,work:(tx:any,a:any)=>Promise<any>){
 return await sql.begin(async tx=>{
  await tx`set local role erp_api`;
  await tx`select set_config('request.jwt.claims',${JSON.stringify(id.claims)},true)`;
  const [a]=await tx`select (erp_private.actor()).*`;
  if(!a?.staff_id)fail(401,'Your account is not active.');
  return work(tx,a);
 });
}
async function logAdmin(tx:any,authId:string|null,action:string,key:string,detail:any){
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values)
 values(${authId},current_user,'staff_access',${action},${key},${tx.json(detail)})`;
}
async function setup(p:any){
 const token=text(p.token,64),pass=password(p.password);
 if(!/^[a-f0-9]{64}$/.test(token))fail(400,'The setup link is invalid or expired.');
 await limit('setup:'+token,8);
 const hash=await sha(token);
 await sql.begin(async tx=>{
  const rows=await tx`select t.*,s.auth_user_id,s.login_id,s.access_status,s.contract_end_date,s.deleted_at from erp_private.setup_tokens t
  join erp_private.staff_members s on s.staff_id=t.staff_id where t.token_hash=${hash} and t.consumed_at is null
  and t.revoked_at is null and t.expires_at>now()
  and (s.contract_end_date is null or s.contract_end_date>=(now() at time zone 'Africa/Nairobi')::date) for update of t,s`;
  if(!rows.length)fail(400,'The setup link is invalid or expired.');
  const s=rows[0];
  if(s.deleted_at||s.access_status==='Inactive')fail(403,'Ask the Engagement Partner to review this account.');
  let userId=s.auth_user_id;
  // Recover a previously created Auth identity if the database commit failed.
  if(!userId){const existing=await tx`select id from auth.users where email=${s.staff_id+'@staff.pcl.invalid'}`;userId=existing[0]?.id;}
  if(userId){const result=await admin.auth.admin.updateUserById(userId,{password:pass,email_confirm:true});if(result.error)throw new Error('Account setup failed');}
  else{
   const result=await admin.auth.admin.createUser({email:`${s.staff_id}@staff.pcl.invalid`,password:pass,email_confirm:true});
   if(result.error||!result.data.user)throw new Error('Account setup failed');userId=result.data.user.id;
  }
  await tx`update erp_private.staff_members set auth_user_id=${userId},access_status='Active',sessions_invalid_before=now() where staff_id=${s.staff_id}`;
  await tx`update erp_private.setup_tokens set consumed_at=now() where token_hash=${hash}`;
  await tx`update erp_private.setup_tokens set revoked_at=now() where staff_id=${s.staff_id} and token_hash<>${hash} and consumed_at is null`;
  await tx`update erp_private.pilot_sessions set revoked_at=now() where staff_id=${s.staff_id}`;
  await logAdmin(tx,userId,'PASSWORD_SETUP',s.staff_id,{method:'single_use_link'});
 });
 return {ok:true,message:'Password saved. Sign in with your staff login ID.'};
}
async function signIn(p:any){
 const user=login(p.login_id);text(p.password,128);
 await limit('login:'+user,12);
 const [s]=await sql`select staff_id,auth_user_id from erp_private.staff_members where lower(login_id)=${user} and deleted_at is null and access_status='Active'
 and (contract_end_date is null or contract_end_date>=(now() at time zone 'Africa/Nairobi')::date)`;
 const auth=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const result=await auth.auth.signInWithPassword({email:`${s?.staff_id||'00000000-0000-4000-8000-000000000000'}@staff.pcl.invalid`,password:p.password});
 if(result.error||!result.data.session||!s||result.data.user.id!==s.auth_user_id)fail(401,'The login ID or password is incorrect, or the account is inactive.');
 const claims=decode(result.data.session.access_token);
 const created=await sql`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at)
 select ${claims.session_id}::uuid,s.staff_id,to_timestamp(${claims.exp}) from erp_private.staff_members s
 where s.staff_id=${s.staff_id} and s.access_status='Active' and s.deleted_at is null
 and (s.contract_end_date is null or s.contract_end_date>=(now() at time zone 'Africa/Nairobi')::date) returning session_id`;
 if(!created.length)fail(401,'This account is inactive.');
 return {access_token:result.data.session.access_token,expires_at:claims.exp};
}
async function accountLink(id:any,p:any){
 const staffId=uuid(p.staff_id),raw=nonce(),hash=await sha(raw);
 const selected=await scoped(id,async(tx,a)=>{
  leader(a);const s=one(await tx`select staff_id,login_id,category_code from erp_private.staff_members where staff_id=${staffId} and deleted_at is null`);
  if(a.staff_id===s.staff_id)fail(400,'Ask another Engagement Partner to reset your own account.');
  if(a.category_code==='MANAGER'&&['PARTNER','MANAGER'].includes(s.category_code))deny();
  return {staff:s,actor:a};
 });
 await sql.begin(async tx=>{
  // Recheck the actor under the row lock so revocation cannot race credential issuance.
  await tx`select staff_id from erp_private.staff_members where staff_id in (${selected.actor.staff_id},${staffId}) order by staff_id for update`;
  await tx`select set_config('request.jwt.claims',${JSON.stringify(id.claims)},true)`;
  const [check]=await tx`select erp_private.manages(${staffId}::uuid) as allowed,(erp_private.actor()).staff_id as actor,
   (erp_private.actor()).category_code as actor_category,(select category_code from erp_private.staff_members where staff_id=${staffId}) as target_category`;
  if(!check.allowed||!check.actor)deny();
  if(check.actor_category==='MANAGER'&&['PARTNER','MANAGER'].includes(check.target_category))deny();
  await tx`update erp_private.staff_members set access_status='Pending setup',sessions_invalid_before=now() where staff_id=${staffId}`;
  await tx`update erp_private.pilot_sessions set revoked_at=now() where staff_id=${staffId}`;
  await tx`update erp_private.setup_tokens set revoked_at=now() where staff_id=${staffId} and consumed_at is null`;
  await tx`insert into erp_private.setup_tokens(token_hash,staff_id,issued_by,expires_at) values(${hash},${staffId},${selected.actor.staff_id},now()+interval '24 hours')`;
  await logAdmin(tx,id.claims.sub,'SETUP_LINK_ISSUED',staffId,{expires_in_hours:24});
 });
 return {login_id:selected.staff.login_id,setup_url:SETUP_BASE+'#setup='+raw,expires_in_hours:24};
}
async function bucket(){
 const r=await admin.storage.getBucket(BUCKET);
 if(r.data){if(r.data.public)throw new Error('Private storage configuration required');return;}
 const made=await admin.storage.createBucket(BUCKET,{public:false,fileSizeLimit:10*1024*1024,allowedMimeTypes:['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg']});
 if(made.error){const retry=await admin.storage.getBucket(BUCKET);if(!retry.data||retry.data.public)throw new Error('Private storage unavailable');}
}
async function upload(req:Request,id:any){
 const f=await req.formData(),file=f.get('file');if(!(file instanceof File))fail(400,'Choose a file.');
 const bytes=new Uint8Array(await file.arrayBuffer()),name=text(file.name,180).replace(/[\x00-\x1f/\\]/g,'_'),mime=fileType(name,bytes);
 const cid=uuid(f.get('client_id')),firm=uuid(f.get('firm_id')),pid=f.get('project_id')?uuid(f.get('project_id')):null,tid=f.get('task_id')?uuid(f.get('task_id')):null;
 const cat=choice(f.get('category'),['Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports']);
 const doc=crypto.randomUUID(),key=documentObjectKey(cid,firm,doc,mime),digest=await sha(bytes);
 await bucket();let uploaded=false;
 try{return await scoped(id,async(tx,a)=>{
  // Read through RLS before checking relationships; never disclose another team's records.
  const project=pid?(await tx`select project_id,client_id,handling_firm_id,status from erp_private.projects where project_id=${pid} and deleted_at is null`)[0]:null;
  const task=tid?(await tx`select task_id,project_id from erp_private.tasks where task_id=${tid} and deleted_at is null`)[0]:null;
  assertDocumentLinks({client_id:cid,firm_id:firm,project_id:pid,task_id:tid},project,task);
  const [allow]=await tx`select erp_private.document_allowed(${cid}::uuid,${firm}::uuid,${pid}::uuid,${tid}::uuid,${cat},true) as allowed`;
  if(!allow.allowed)deny();
  // Metadata is inserted before storage. Failed storage rolls back metadata.
  await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by)
  values(${doc},${cid},${firm},${pid},${tid},${cat},${name},${key},${bytes.length},${digest},${mime},${a.staff_id})`;
  const result=await admin.storage.from(BUCKET).upload(key,bytes,{contentType:mime,upsert:false});
  if(result.error)fail(502,'The file could not be stored. No document was saved. Try again or ask your Manager.');uploaded=true;
  await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${doc},${id.claims.sub},'UPLOAD')`;
  return {ok:true,document_id:doc};
 });}catch(e){if(uploaded)await admin.storage.from(BUCKET).remove([key]);throw e;}
}
async function download(id:any,p:any){
 return await scoped(id,async(tx)=>{
  const d=one(await tx`select * from erp_private.documents where document_id=${uuid(p.document_id)} and deleted_at is null`);
  const result=await admin.storage.from(BUCKET).download(d.object_key);if(result.error||!result.data)fail(404,'The file is unavailable.');
  await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${d.document_id},${id.claims.sub},'DOWNLOAD')`;
  return {blob:result.data,name:d.file_name};
 });
}
async function action(id:any,p:any){
 if(p.action==='account_link')return accountLink(id,p);
 if(p.action==='logout'){
  await sql`update erp_private.pilot_sessions set revoked_at=now() where session_id=${id.claims.session_id}::uuid`;
  await admin.auth.admin.signOut(id.jwt,'local');return {ok:true};
 }
 return scoped(id,async(tx,a)=>{
  if(p.action==='workspace'){
   const me={staff_id:a.staff_id,login_id:a.login_id,full_name:a.full_name,category_code:a.category_code};
   const firms=await tx`select firm_id,firm_code,legal_name from erp_private.firms where deleted_at is null order by firm_code`;
   const clients=await tx`select client_id,company_name,kra_pin,primary_sector,branch_location,client_category,missing_fields,revision from erp_private.clients where deleted_at is null order by company_name limit 1000`;
   const projects=await tx`select project_id,client_id,handling_firm_id,project_name,service_code,status from erp_private.projects where deleted_at is null order by created_at desc limit 500`;
   const tasks=await tx`select task_id,project_id,assigned_to,task_name,description,due_at,status,blocked_reason,revision from erp_private.tasks where deleted_at is null order by due_at nulls last limit 1000`;
   const documents=await tx`select document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,file_size_bytes,version,is_locked,uploaded_at from erp_private.documents where deleted_at is null order by uploaded_at desc limit 500`;
   const staff=await tx`select staff_id,staff_identifier,login_id,full_name,category_code,employment_type,billing_status,branch_location,contract_start_date,contract_end_date,access_status,revision from erp_private.staff_members where deleted_at is null order by full_name limit 500`;
   const staff_firms=await tx`select staff_id,firm_id,scope from erp_private.staff_firm_access where deleted_at is null`;
   const client_firms=await tx`select client_id,firm_id from erp_private.client_firm_links where deleted_at is null`;
   const assignments=await tx`select project_id,staff_id from erp_private.project_assignments where deleted_at is null`;
   const services=await tx`select service_code,service_name from erp_private.services where is_active order by service_name`;
   return {me,firms,clients,projects,tasks,documents,staff,staff_firms,client_firms,assignments,services};
  }
  if(p.action==='task_status'){
   const task=uuid(p.task_id),status=choice(p.status,statuses),reason=text(p.blocked_reason||'',1000,false);
   if(status==='Blocked'&&!reason)fail(400,'Enter the reason the task is blocked.');
   const rev=revision(p.revision);
   const changed=await tx`update erp_private.tasks set status=${status},blocked_reason=${reason||null}
    where task_id=${task} and revision=${rev} returning task_id`;
   if(!changed.length)fail(409,'Task changed or is no longer assigned to you. Refresh the workspace.');return {ok:true};
  }
  leader(a);
  if(p.action==='firm_save'){
   if(a.category_code!=='PARTNER')deny();
   const code=text(p.firm_code,16).toUpperCase();if(!/^[A-Z][A-Z0-9]{1,15}$/.test(code))fail(400,'Use a firm code such as PCL.');
   const name=text(p.legal_name,200);
   if(p.firm_id)one(await tx`update erp_private.firms set legal_name=${name} where firm_id=${uuid(p.firm_id)} returning firm_id`);
   else await tx`insert into erp_private.firms(firm_code,legal_name) values(${code},${name})`;
   return {ok:true};
  }
  if(p.action==='client_save'){
   const cid=p.client_id?uuid(p.client_id):crypto.randomUUID();
   const name=text(p.company_name,200),pin=p.kra_pin?text(p.kra_pin,11).toUpperCase():null;
   if(pin&&!/^[A-Z][0-9]{9}[A-Z]$/.test(pin))fail(400,'Check the KRA PIN format.');
   const sector=p.primary_sector?choice(p.primary_sector,sectors):null,branch=p.branch_location?choice(p.branch_location,branches):null;
   const cat=p.client_category?choice(p.client_category,['Corporate','Non-Profit','Public Entity','Individual']):null;
   if(p.client_id){
    const rev=revision(p.revision);
    const rows=await tx`update erp_private.clients set company_name=${name},kra_pin=${pin},primary_sector=${sector},branch_location=${branch},client_category=${cat}
    where client_id=${cid} and revision=${rev} returning client_id`;
    if(!rows.length)fail(409,'Client changed or is unavailable. Refresh before editing.');
   }else await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,record_status,owner_staff_id)
    values(${cid},${name},${pin},${sector},${branch},${cat},'Existing',${a.staff_id})`;
   const firms=Array.isArray(p.firm_ids)?p.firm_ids.map(uuid):[];if(!firms.length)fail(400,'Select at least one handling firm.');
   for(const firm of firms){
    const [allowed]=await tx`select erp_private.firm_allowed(${firm}::uuid) as ok`;if(!allowed.ok)deny();
    await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${firm}) on conflict do nothing`;
   }return {ok:true,client_id:cid};
  }
  if(p.action==='staff_save'){
   let old=null;if(p.staff_id){old=one(await tx`select * from erp_private.staff_members where staff_id=${uuid(p.staff_id)} for update`);if(old.staff_id===a.staff_id)fail(403,'Another Engagement Partner must edit your account.');}
   const values=staffInput(p,a,old),sid=old?.staff_id||crypto.randomUUID();
   if(old){
    if(String(old.revision)!==revision(p.revision))fail(409,'Staff profile changed. Refresh before editing.');
    await tx`update erp_private.staff_members set full_name=${values.full_name},category_code=${values.category_code},employment_type=${values.employment_type},
    branch_location=${values.branch_location},billing_status=${values.billing_status},contract_start_date=${values.contract_start_date},contract_end_date=${values.contract_end_date}
    where staff_id=${sid}`;
   }else{
    const staffIdentifier=text(p.staff_identifier,80).toUpperCase(),loginId=login(p.login_id);
    await tx`insert into erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,manager_id,employment_type,billing_status,branch_location,contract_start_date,contract_end_date)
    values(${sid},${staffIdentifier},${loginId},${values.full_name},${values.category_code},${a.staff_id},${values.employment_type},${values.billing_status},${values.branch_location},${values.contract_start_date},${values.contract_end_date})`;
   }
   const firms=Array.isArray(p.firm_ids)?p.firm_ids.map(uuid):[];
   if(!firms.length)fail(400,'Choose at least one firm for the staff member.');
   for(const firm of firms){
    const [check]=await tx`select erp_private.firm_allowed(${firm}::uuid) as ok`;if(!check.ok)deny();
    await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${sid},${firm},'Assigned')
    on conflict(staff_id,firm_id) do update set deleted_at=null`;
   }
   // Removing a firm revokes the scope immediately without deleting historical assignments.
   await tx`update erp_private.staff_firm_access set deleted_at=now() where staff_id=${sid} and firm_id<>all(${firms}::uuid[])`;
   return {ok:true,staff_id:sid};
  }
  if(p.action==='staff_disable'){
   const sid=uuid(p.staff_id);if(sid===a.staff_id)deny();const target=one(await tx`select category_code from erp_private.staff_members where staff_id=${sid}`);
   if(a.category_code==='MANAGER'&&['PARTNER','MANAGER'].includes(target.category_code))deny();
   one(await tx`update erp_private.staff_members set access_status='Inactive' where staff_id=${sid} returning staff_id`);
   return {ok:true};
  }
  if(p.action==='project_save'){
   const pid=crypto.randomUUID(),cid=uuid(p.client_id),firm=uuid(p.firm_id),name=text(p.project_name,200),service=text(p.service_code,30);
   const sid=p.staff_id?uuid(p.staff_id):a.staff_id;
   const target=one(await tx`select category_code from erp_private.staff_members where staff_id=${sid}`);
   // The creating manager also retains their own assignment.
   if(!(await tx`select staff_id from erp_private.staff_firm_access where staff_id=${a.staff_id} and firm_id=${firm} and deleted_at is null`).length)
    await tx`insert into erp_private.staff_firm_access(staff_id,firm_id) values(${a.staff_id},${firm}) on conflict(staff_id,firm_id) do update set deleted_at=null`;
   await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id)
    values(${pid},${cid},${firm},${name},${service},${a.staff_id})`;
   await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pid},${a.staff_id},${firm},${a.category_code})`;
   if(sid!==a.staff_id)await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pid},${sid},${firm},${target.category_code})`;
   return {ok:true,project_id:pid};
  }
  if(p.action==='task_create'){
   const pid=uuid(p.project_id),sid=uuid(p.assigned_to),name=text(p.task_name,200),due=date(p.due_date),description=text(p.description||'',2000,false);
   const project=one(await tx`select handling_firm_id from erp_private.projects where project_id=${pid}`);
   const target=one(await tx`select category_code from erp_private.staff_members where staff_id=${sid} and deleted_at is null`);
   await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pid},${sid},${project.handling_firm_id},${target.category_code}) on conflict do nothing`;
   await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,description,due_at)
    values(${pid},${sid},${name},${description},${due?due+'T17:00:00+03:00':null})`;return {ok:true};
  }
  fail(404,'Unknown action.');
 });
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 if(origin&&allowedOrigin(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,content-type,apikey';headers['Access-Control-Allow-Methods']='POST,OPTIONS';}
 if(origin&&!allowedOrigin(origin))return new Response(JSON.stringify({error:'Origin not allowed.'}),{status:403,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return new Response(JSON.stringify({error:'Use POST.'}),{status:405,headers});
 try{
  if(Number(req.headers.get('content-length')||0)>11*1024*1024)fail(413,'The request is too large.');
  await limit('request-global',2000);
  if(req.headers.get('content-type')?.startsWith('multipart/form-data')){
   const id=await identity(req);const result=await upload(req,id);return new Response(JSON.stringify(result),{headers});
  }
  const body=await req.text();if(body.length>30000)fail(413,'The request is too large.');
  let p;try{p=JSON.parse(body);}catch{fail(400,'Invalid request.');}if(!p||typeof p!=='object')fail(400,'Invalid request.');
  let result;
  if(p.action==='login')result=await signIn(p);
  else if(p.action==='setup')result=await setup(p);
  else{
   const id=await identity(req);
   if(p.action==='download'){
    const file=await download(id,p);const h={...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`};
    return new Response(file.blob,{headers:h});
   }
   result=await action(id,p);
  }
  return new Response(JSON.stringify(result),{headers});
 }catch(e:any){
  let status=e instanceof HttpError?e.status:500,message=e instanceof HttpError?e.message:'The request could not be completed. Try again or ask your Manager.';
  if(e.code==='42501'){status=403;message='This record or action is not available to your account.';}
  if(e.code==='23505'){status=409;message='This record already exists. Open the existing record to update it.';}
  if(['23514','23503','22P02'].includes(e.code)){status=400;message='Check the required fields, firm and project assignments.';}
  // Do not log passwords, setup tokens, JWTs, file contents or SQL parameters.
  if(status===500)console.error('staff-pilot request failed',{code:e.code||'INTERNAL',type:e.name||'Error'});
  return new Response(JSON.stringify({error:message}),{status,headers});
 }
});
