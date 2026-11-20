import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {discussionAction}=await import('../supabase/functions/staff-workspace-v12/discussion-actions.ts');
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
});
