import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {AccessToken2,ServiceRtc}=require('agora-token/src/AccessToken2');
const {discussionAction}=await import('../supabase/functions/staff-workspace-v12/discussion-actions.ts');
const {offlineDraftAction}=await import('../supabase/functions/staff-workspace-v12/offline-draft-actions.ts');
const {createHash}=await import('node:crypto');
const {communicationFollowupAction}=await import('../supabase/functions/staff-workspace-v12/communication-followup-actions.ts');
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {defaultStaffAreas,areaForStaffAction,staffAreaCanUse}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chat=(role,p)=>as(role,a=>discussionAction(tx,a,p));
const count=(role,table)=>as(role,async()=>(await db.query('select count(*)::int n from erp_private.'+table)).rows[0].n);
const newStaff=async(role,cat=role.replace(/\d/,''))=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat,full_name:'Fictional '+role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${a.full_name},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;return a;};

const sdp=(kind='audio')=>'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm='+kind+' 9 UDP/TLS/RTP/SAVPF 111\r\n';
const call=(role,p)=>chat(role,p);
const lastLine=async(role,channel_id)=>(await chat(role,{action:'discussion_messages',channel_id})).messages.at(-1).body;
test('one-to-one voice and video calls: set-up, answer, decline, missed, busy, privacy, and a line in the chat for each',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CLQA','Fictional calls firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT','ASSISTANT2','INTERN'])await newStaff(role);
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Mlima monthly tax','TAX-COMP',${actors.MANAGER.staff_id})`;
 const dm=(await chat('ASSISTANT',{action:'discussion_open',kind:'Direct',staff_id:actors.ASSISTANT2.staff_id})).channel.channel_id;
 const dmIntern=(await chat('PARTNER',{action:'discussion_open',kind:'Direct',staff_id:actors.INTERN.staff_id})).channel.channel_id;

 // Relay settings: without a relay account only the public server is offered, and the screen is told so.
 const cfg=await call('ASSISTANT',{action:'discussion_call_config'});assert.equal(cfg.relay,false);assert.match(cfg.ice_servers[0].urls[0],/^stun:/);
 await assert.rejects(()=>call('ASSISTANT',{action:'discussion_call_zzz'}),/Unknown call action/);

 // A voice call: ring, answer, hang up, and one line in the chat with the length.
 const id=(await call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp(),media:'audio'})).call_id;
 const ringing=(await call('ASSISTANT2',{action:'discussion_call_pending'})).call;
 assert.equal(ringing.call_id,id);assert.equal(ringing.media,'audio');assert.equal(ringing.other_name,'Fictional ASSISTANT');assert.match(ringing.offer_sdp,/^v=0/);
 assert.equal((await call('ASSISTANT',{action:'discussion_call_pending'})).call,null,'the caller is not rung');
 const mine=(await call('ASSISTANT',{action:'discussion_call_get',call_id:id})).call;assert.equal(mine.role,'caller');assert.equal(mine.offer_sdp,null,'the caller does not get the callee-side data');assert.equal(mine.answer_sdp,null);
 await assert.rejects(()=>call('MANAGER',{action:'discussion_call_get',call_id:id}),/not available/);
 await assert.rejects(()=>call('MANAGER',{action:'discussion_call_end',call_id:id,outcome:'hangup'}),/not available/);
 await assert.rejects(()=>call('MANAGER',{action:'discussion_call_answer',call_id:id,answer_sdp:sdp()}),/no longer ringing/);
 await assert.rejects(()=>call('ASSISTANT',{action:'discussion_call_answer',call_id:id,answer_sdp:sdp()}),/no longer ringing/,'only the person called can answer');
 await assert.rejects(()=>call('PARTNER',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp()}),/one-to-one|not available/,'a third person cannot call into someone else’s chat');
 await call('ASSISTANT2',{action:'discussion_call_answer',call_id:id,answer_sdp:sdp()});
 const connected=(await call('ASSISTANT',{action:'discussion_call_get',call_id:id})).call;assert.equal(connected.status,'Answered');assert.match(connected.answer_sdp,/^v=0/);
 assert.equal((await call('ASSISTANT2',{action:'discussion_call_get',call_id:id})).call.answer_sdp,null,'the callee does not get its own answer back');
 await assert.rejects(()=>call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp()}),/already on a call/);
 await assert.rejects(()=>call('ASSISTANT2',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp()}),/already on a call/);
 assert.equal((await call('ASSISTANT2',{action:'discussion_call_end',call_id:id,outcome:'hangup'})).status,'Ended');
 assert.match(await lastLine('ASSISTANT',dm),/^📞 Voice call · \d+:\d\d$/);
 assert.equal((await call('ASSISTANT',{action:'discussion_call_end',call_id:id,outcome:'hangup'})).status,'Ended','ending twice is harmless');
 assert.equal((await chat('ASSISTANT',{action:'discussion_messages',channel_id:dm})).messages.filter(m=>/Voice call/.test(m.body)).length,1,'one line per call');

 // A video call that is declined.
 const v=(await call('ASSISTANT2',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp('video'),media:'video'})).call_id;
 assert.equal((await call('ASSISTANT',{action:'discussion_call_pending'})).call.media,'video');
 assert.equal((await call('ASSISTANT',{action:'discussion_call_end',call_id:v,outcome:'decline'})).status,'Declined');
 assert.equal(await lastLine('ASSISTANT2',dm),'📹 Fictional ASSISTANT declined the video call');

 // A call the other person never answers: the caller cancels, the other person has a missed-call line they have not read.
 const before=(await chat('ASSISTANT2',{action:'discussion_list'})).channels.find(c=>c.channel_id===dm).unread;
 const m=(await call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp(),media:'audio'})).call_id;
 assert.equal((await call('ASSISTANT',{action:'discussion_call_end',call_id:m,outcome:'hangup'})).status,'Missed');
 assert.equal(await lastLine('ASSISTANT2',dm),'📞 Missed voice call from Fictional ASSISTANT');
 assert.equal(Number((await chat('ASSISTANT2',{action:'discussion_list'})).channels.find(c=>c.channel_id===dm).unread),Number(before)+1);
 assert.equal((await call('ASSISTANT2',{action:'discussion_call_pending'})).call,null);

 // Calls nobody finishes close themselves: ringing over a minute is missed.
 const stale=(await call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp(),media:'audio'})).call_id;
 await tx`update erp_private.chat_calls set created_at=now()-interval '2 minutes' where call_id=${stale}`;
 assert.equal((await call('ASSISTANT2',{action:'discussion_call_pending'})).call,null);
 assert.equal((await call('ASSISTANT',{action:'discussion_call_get',call_id:stale})).call.status,'Missed');

 // A connection that could not be made.
 const f=(await call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp('video'),media:'video'})).call_id;
 await call('ASSISTANT2',{action:'discussion_call_answer',call_id:f,answer_sdp:sdp('video')});
 assert.equal((await call('ASSISTANT2',{action:'discussion_call_end',call_id:f,outcome:'failed'})).status,'Failed');
 assert.equal(await lastLine('ASSISTANT',dm),'📹 The video call could not connect');

 // Anyone may start a call, an Intern included, but only inside a chat they already have; and a call is one-to-one only.
 const iv=(await call('INTERN',{action:'discussion_call_start',channel_id:dmIntern,offer_sdp:sdp(),media:'audio'})).call_id;
 assert.equal((await call('PARTNER',{action:'discussion_call_pending'})).call.other_name,'Fictional INTERN');
 await call('PARTNER',{action:'discussion_call_answer',call_id:iv,answer_sdp:sdp()});await call('INTERN',{action:'discussion_call_end',call_id:iv,outcome:'hangup'});
 const pc=(await call('PARTNER',{action:'discussion_call_start',channel_id:dmIntern,offer_sdp:sdp(),media:'audio'})).call_id;
 await call('INTERN',{action:'discussion_call_answer',call_id:pc,answer_sdp:sdp()});await call('PARTNER',{action:'discussion_call_end',call_id:pc,outcome:'hangup'});
 const projectChat=(await chat('MANAGER',{action:'discussion_open',project_id:P})).channel.channel_id;
 await assert.rejects(()=>call('MANAGER',{action:'discussion_call_start',channel_id:projectChat,offer_sdp:sdp()}),/one-to-one/);

 // The call type must match the set-up data; the table cannot be written or read around the functions.
 await assert.rejects(()=>call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:sdp('audio'),media:'video'}),/does not match/);
 await assert.rejects(()=>call('ASSISTANT',{action:'discussion_call_start',channel_id:dm,offer_sdp:'short',media:'audio'}),/not valid/);
 await assert.rejects(()=>as('ASSISTANT',a=>tx`insert into erp_private.chat_calls(channel_id,caller_id,callee_id,offer_sdp) values(${dm},${a.staff_id},${actors.ASSISTANT2.staff_id},${sdp()})`),/permission denied|row-level security/);
 assert.equal(await count('MANAGER','chat_calls'),0,'someone outside the call sees no call rows');
 assert.equal(await count('ASSISTANT','chat_calls')>0,true);
 assert.deepEqual(defaultStaffAreas('INTERN').includes('communications'),true);
 assert.equal(staffAreaCanUse('INTERN',[],areaForStaffAction('discussion_call_start')),true);
 const agora={transport:'agora'};
 assert.equal(cfg.agora,false);
 await assert.rejects(()=>call('INTERN',{action:'discussion_call_start',channel_id:dmIntern,media:'audio',...agora}),/not available in this workspace/);
 const originalDeno=globalThis.Deno;
 const env={SUPABASE_URL:'https://yfjiculexbzpkvtapudk.supabase.co',AGORA_APP_ID:'a'.repeat(32),AGORA_APP_CERTIFICATE:'b'.repeat(32)};
 globalThis.Deno={env:{get:key=>env[key]}};
 t.after(()=>{globalThis.Deno=originalDeno;});
 assert.equal((await call('INTERN',{action:'discussion_call_config'})).agora,true);
 for(const role of ['ADMIN','PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){
  assert.ok(staffAreaCanUse(role,[],areaForStaffAction('discussion_call_agora_token')),role+' can use the call token action');
 }
 const agId=(await call('INTERN',{action:'discussion_call_start',channel_id:dmIntern,media:'video',...agora})).call_id;
 const token=(role,fields={})=>call(role,{action:'discussion_call_agora_token',call_id:agId,...fields});
 assert.equal((await call('PARTNER',{action:'discussion_call_pending'})).call,null,'older clients ignore Agora invitations');
 const invitation=(await call('PARTNER',{action:'discussion_call_pending',agora:true})).call;
 assert.equal(invitation.transport,'agora');
 assert.equal(invitation.offer_sdp,null);
 await assert.rejects(()=>token('INTERN'),/not available to your account/);
 await assert.rejects(()=>call('INTERN',{action:'discussion_call_answer',call_id:agId,...agora}),/no longer ringing/);
 await assert.rejects(()=>call('PARTNER',{action:'discussion_call_answer',call_id:agId,answer_sdp:sdp('video')}),/no longer ringing/);
 await call('PARTNER',{action:'discussion_call_answer',call_id:agId,...agora});
 await assert.rejects(()=>token('MANAGER'),/not available to your account/);
 const grants=[await token('INTERN',{uid:99,channel:'caller-supplied'}),await token('PARTNER')];
 for(const [i,grant] of grants.entries()){
  assert.deepEqual(Object.keys(grant).sort(),['app_id','channel','token','uid']);
  assert.equal(grant.uid,i+1);
  assert.equal(grant.channel,'pcl-'+agId);
  const parsed=new AccessToken2();
  assert.equal(parsed.from_string(grant.token),true);
  assert.equal(parsed.appId.toString(),env.AGORA_APP_ID);
  assert.equal(parsed.expire,300);
  const [rtc]=parsed.getServices(new ServiceRtc().service_type());
  assert.equal(rtc.__channel_name.toString(),grant.channel);
  assert.equal(rtc.__uid.toString(),String(grant.uid));
 }
 env.SUPABASE_URL='https://different-project.supabase.co';
 await assert.rejects(()=>token('INTERN'),/not available in this workspace/);
 env.SUPABASE_URL='https://yfjiculexbzpkvtapudk.supabase.co';
 assert.ok((await token('INTERN')).token,'active calls can renew');
 await call('PARTNER',{action:'discussion_call_end',call_id:agId,outcome:'hangup'});
 await assert.rejects(()=>token('INTERN'),/not available to your account/);

 await t.test('Messenger follow-ups use the ERP task workflow and keep private sources private',async t=>{
  const assistant=actors.ASSISTANT.staff_id,assignee=actors.ASSISTANT2.staff_id;
  const projectAssignment=()=>tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job)
   values(${P},${assistant},${F},'ASSISTANT')`;
  await projectAssignment();
  const channel=(await chat('ASSISTANT',{action:'discussion_open',kind:'Direct',staff_id:actors.PARTNER.staff_id})).channel.channel_id;
  const body='Private note from the fictitious caller';
  const link=await chat('ASSISTANT',{action:'discussion_send',channel_id:channel,request_id:crypto.randomUUID(),body});
  const source={channel_id:channel,message_id:link.message_id};
  const input={...source,project_id:P,assigned_to:assignee,title:'Respond to KRA notice',
   summary:'Prepare the response and send it for review.',due_on:new Date(Date.now()+7*864e5).toISOString().slice(0,10)};// a date a week ahead, so the test does not depend on the day it runs
  const action=(role,name,fields={},denied=[])=>as(role,a=>communicationFollowupAction(tx,a,{action:'communication_followup_'+name,...fields},
   payload=>workspaceAction(tx,a,payload),async key=>!denied.includes(key)));
  const read=role=>action(role,'list');
  const setClientStatus=status=>as('PARTNER',()=>tx`select erp_private.client_status_set(${C},${status},'Verify held follow-ups in the test workspace',true)`);
  await assert.rejects(()=>action('PARTNER','create',input),/unavailable/,'draft work cannot bypass the task gate');
  await db.exec('set session_replication_role=replica');
  await tx`update erp_private.projects set status='Active' where project_id=${P}`;
  await tx`update erp_private.clients set opening_balance_status='No opening balances',
   opening_balance_note='Fictional client has no opening balances',opening_balance_confirmed_by=${actors.PARTNER.staff_id},opening_balance_confirmed_at=now()
   where client_id=${C}`;
  await db.exec('set session_replication_role=origin');
  const options=await action('ASSISTANT','options',source);
  assert.equal(options.body,body);
  assert.equal(options.create,false);
  assert.equal(options.projects[0].project_id,P);
  await assert.rejects(()=>action('MANAGER','options',source),/unavailable/);
  await assert.rejects(()=>action('PARTNER','options',source,['discussion_messages']),/cannot create or request/);
  await assert.rejects(()=>action('ASSISTANT','create',input),/authorised reviewer/);
  assert.equal((await read('ASSISTANT')).items.length,0,'a denied write rolls the request back');
  assert.deepEqual(await action('ASSISTANT','create',{...input,request_only:true}),{requested:true});
  await setClientStatus('Inactive');
  assert.equal((await read('PARTNER')).items.length,0,'pending requests leave the queue when a client is held');
  assert.equal((await action('ASSISTANT','options',source)).projects.length,0);
  await assert.rejects(()=>action('PARTNER','create',input),/unavailable/);
  await setClientStatus('Active');
  assert.equal((await read('MANAGER')).items.length,0,'a reviewer outside the conversation cannot read the request');
  const pending=(await read('PARTNER')).items.find(x=>x.kind==='request');
  assert.ok(pending.awaiting_review);
  assert.equal(pending.message_id,source.message_id);
  await assert.rejects(()=>action('PARTNER','create',{...input,assigned_to:actors.MANAGER.staff_id}),/active Assistants only/);
  const {task_id}=await action('PARTNER','create',input);
  assert.ok(task_id);
  assert.deepEqual(await action('PARTNER','create',input),{existing:true,task_id});
  assert.equal((await tx`select count(*)::int n from erp_private.tasks where task_name=${input.title}`)[0].n,1);
  await t.test('offline draft replays use live assignments and the existing work records',async()=>{
   const hash=value=>Promise.resolve(createHash('sha256').update(value).digest('hex'));
   const send=(role,p,can=async()=>true)=>as(role,a=>offlineDraftAction(tx,a,p,{can,hash}));
   const snapshot=await send('ASSISTANT2',{action:'task_offline_list'});
   assert.equal(snapshot.staff_id,assignee);
   assert.deepEqual(snapshot.tasks.map(task=>task.task_id),[task_id]);
   assert.deepEqual(Object.keys(snapshot.tasks[0]).sort(),['can_note','can_time','due_on','task_id','task_name']);
   assert.deepEqual((await send('MANAGER',{action:'task_offline_list'})).tasks,[]);
   const time={action:'task_offline_apply',operation_id:crypto.randomUUID(),task_id,kind:'time',
    work_date:'2026-11-20',hours:1.25,description:'Fictional work draft',status:'Submitted',staff_id:assistant};
   await assert.rejects(()=>send('ASSISTANT2',time,async request=>request.action!=='timesheet_save'),/access.*changed/);
   await assert.rejects(()=>send('MANAGER',time),/no longer assigned/);
   const saved=await send('ASSISTANT2',time);
   assert.deepEqual(await send('ASSISTANT2',time),saved);
   await assert.rejects(()=>send('ASSISTANT2',{...time,hours:2}),/already used for different work/);
   const [sheet]=await tx`select status,staff_id,hours from erp_private.timesheets where timesheet_id=${saved.timesheet_id}`;
   assert.deepEqual([sheet.status,sheet.staff_id,Number(sheet.hours)],['Draft',assignee,1.25]);
   assert.equal((await tx`select count(*)::int n from erp_private.timesheets where task_id=${task_id}`)[0].n,1);
   assert.equal(await as('MANAGER',async()=>(await tx`select count(*)::int n from erp_private.offline_draft_receipts`)[0].n),0);
   const [procedure]=await tx`select revision from erp_private.task_procedures where task_id=${task_id}`;
   assert.ok(procedure,'the existing task procedure owns the note');
   assert.equal(snapshot.tasks[0].can_note,true);
   const note={action:'task_offline_apply',operation_id:crypto.randomUUID(),task_id,kind:'note',note:'Check the KRA response before submitting.'};
   await send('ASSISTANT2',note);
   await send('ASSISTANT2',note);
   assert.equal((await tx`select count(*)::int n from erp_private.procedure_events where task_id=${task_id} and action='comment' and message=${note.note}`)[0].n,1);
   await setClientStatus('Inactive');
   assert.deepEqual((await send('ASSISTANT2',{action:'task_offline_list'})).tasks,[]);
   await assert.rejects(()=>send('ASSISTANT2',{...time,operation_id:crypto.randomUUID()}),/no longer assigned/);
   await setClientStatus('Active');
  });
  const assigned=(await read('ASSISTANT2')).items.find(x=>x.id===task_id);
  assert.equal(assigned.title,input.title);
  assert.equal(assigned.due_on,input.due_on);
  assert.equal(assigned.message_id,null);
  assert.equal(assigned.channel_id,null);
  assert.equal((await tx`select description from erp_private.tasks where task_id=${task_id}`)[0].description,input.summary);
  assert.equal((await read('PARTNER')).items.some(x=>x.kind==='request'),false);
  await tx`update erp_private.tasks set due_at=now()-interval '2 days' where task_id=${task_id}`;
  assert.equal((await read('ASSISTANT2')).items.find(x=>x.id===task_id).overdue,true);
  await setClientStatus('Inactive');
  assert.ok(!(await read('ASSISTANT2')).items.some(x=>x.id===task_id),'assigned follow-up tasks leave the queue while held');
  await setClientStatus('Active');
  const resumed=(await read('ASSISTANT2')).items.find(x=>x.id===task_id);
  assert.deepEqual([resumed.due_on,resumed.overdue],[null,false],'resumed work stays out of due-date queues until it is re-dated');
  const newer=await chat('ASSISTANT',{action:'discussion_send',channel_id:channel,request_id:crypto.randomUUID(),body:'A later message'});
  assert.notEqual(newer.message_id,source.message_id);
  const earlier=await chat('PARTNER',{action:'discussion_messages',channel_id:channel,at_message_id:source.message_id});
  assert.equal(earlier.messages.at(-1).message_id,source.message_id);
  await assert.rejects(()=>chat('ASSISTANT2',{action:'discussion_messages',channel_id:channel,at_message_id:source.message_id}),/not available/);
 });
});
