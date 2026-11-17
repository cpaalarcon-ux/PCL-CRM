import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p));
test('build 2854: the iTax grid saves many cells at once and verifies them as a batch',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const key=(k,v,x={})=>({action:'client_master_record',client_id:C,field_key:k,value:v,source_kind:'Document',document_id:D,...x});
 const ver=async(role,k,note='Checked against the document')=>{const r=await cm(role,{action:'client_master_read',client_id:C});const row=r.rows.find(x=>x.key===k);return cm(role,{action:'client_master_verify',fact_id:row.fact.fact_id,revision:row.fact.revision,note});};
 // Every client type asks for the iTax identity cells; the old one-line address is retired in favour of the iTax address cells.
 for(const code of ['COMPANY','PARTNERSHIP','COOPERATIVE','NONPROFIT','INDIVIDUAL']){
  const req=(await tx`select field_key from erp_private.client_template_fields where template_code=${code} and requirement='Required' and not retired`).map(x=>x.field_key);
  for(const k of ['kra_pin','company_name','registration_number','street_road','city_town','county','postal_code','po_box','contact_phone','contact_email','year_end'])if(!(code==='INDIVIDUAL'&&k==='registration_number'))assert.ok(req.includes(k),code+' should require '+k);
  assert.ok(!req.includes('registered_address'),code+' no longer asks for the one-line address');
 }
 const many=(role,cells,x={})=>cm(role,{action:'client_master_record_many',client_id:C,cells,source_kind:'Online register',source_reference:'KRA iTax taxpayer profile, fictional',...x});
 const rows=r=>Object.fromEntries(r.rows.map(x=>[x.key,x]));
 // Reading shows the client's structure for the read-only cells.
 await tx`update erp_private.clients set legal_structure='Non-Individual',legal_subtype='Company' where client_id=${C}`.catch(()=>{});
 const r0=await cm('ASSISTANT',{action:'client_master_read',client_id:C});
 assert.ok('legal_structure' in r0.client);

 // All or nothing: one bad cell saves nothing and is named.
 const bad=await many('ASSISTANT',[{field_key:'kra_pin',value:'A000000001Z'},{field_key:'postal_code',value:'abc'},{field_key:'commencement_date',value:'31/02/2020'}]);
 assert.equal(bad.saved,false);assert.deepEqual(bad.errors.map(e=>e.field_key).sort(),['commencement_date','postal_code']);
 assert.equal((await tx`select count(*)::int n from erp_private.client_field_facts where client_id=${C}`)[0].n,0);
 await assert.rejects(()=>many('ASSISTANT',[{field_key:'favourite_colour',value:'blue'}]),/not a field|favourite/i).catch(e=>assert.ok(e));
 await assert.rejects(()=>many('INTERN',[{field_key:'county',value:'Nairobi'}]),/./);
 await assert.rejects(()=>many('ASSISTANT',[{field_key:'county',value:'Nairobi'}],{source_reference:''}),/Say which register/);

 // A good batch saves every cell with one source, skips identical ones, and audits it once as a grid save.
 const ok=await many('ASSISTANT',[{field_key:'kra_pin',value:'A000000001Z'},{field_key:'street_road',value:'Fictional Road'},{field_key:'city_town',value:'Fictional Town'},{field_key:'county',value:'Nairobi'},{field_key:'postal_code',value:'00100'},{field_key:'po_box',value:'123'},{field_key:'commencement_date',value:'2020-02-29'}]);
 assert.equal(ok.saved,true);assert.equal(ok.count,7);assert.equal(rows(ok).street_road.fact.value,'Fictional Road');assert.equal(rows(ok).commencement_date.fact.value,'2020-02-29');
 const again=await many('ASSISTANT',[{field_key:'county',value:'Nairobi'},{field_key:'district',value:'Westlands'}]);
 assert.equal(again.count,1);assert.equal(again.unchanged,1);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='CLIENT_FACT_RECORDED' and after_values->>'grid'='true'`)[0].n>=1,true);

 // Replacing a saved value needs a reason; the old one is kept as history.
 const noWhy=await many('ASSISTANT',[{field_key:'county',value:'Mombasa'},{field_key:'telephone',value:'+254202000000'}]);
 assert.equal(noWhy.saved,false);assert.equal(noWhy.errors.length,1);assert.match(noWhy.errors[0].error,/Say why/i);
 assert.equal(rows(noWhy).telephone?.fact??null,null,'nothing is saved when one cell fails');
 const rep=await many('ASSISTANT',[{field_key:'county',value:'Mombasa'}],{reason:'The register shows the new county'});
 assert.equal(rows(rep).county.fact.value,'Mombasa');assert.equal(rep.history.filter(h=>h.field_key==='county').length,1);

 // Batch verify: reviewer only, never your own, skips are named, the rest are verified in one go.
 const mine=rows(await cm('ASSISTANT',{action:'client_master_read',client_id:C}));
 const facts=['kra_pin','street_road','city_town','county'].map(k=>({fact_id:mine[k].fact.fact_id,revision:mine[k].fact.revision}));
 await assert.rejects(()=>cm('ASSISTANT',{action:'client_master_verify_many',client_id:C,facts,note:'Checked against the register'}),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>cm('SUPERVISOR',{action:'client_master_verify_many',client_id:C,facts,note:'x'}),/at least 3/);
 const own=await many('SUPERVISOR',[{field_key:'website',value:'https://example.com'}]);
 const withOwn=[...facts,{fact_id:rows(own).website.fact.fact_id,revision:rows(own).website.fact.revision},{fact_id:id(),revision:'1'}];
 const v=await cm('SUPERVISOR',{action:'client_master_verify_many',client_id:C,facts:withOwn,note:'Checked against the register'});
 assert.equal(v.verified_count,4);assert.equal(v.skipped.length,2);assert.ok(v.skipped.some(s=>/own|different/i.test(s.reason)));
 assert.equal(rows(v).county.fact.status,'Verified');assert.equal(rows(v).county.fact.verified_by_name!=null||rows(v).county.fact.verified_by!=null,true);
 // A stale revision is skipped, not forced.
 const stale=await cm('MANAGER',{action:'client_master_verify_many',client_id:C,facts:[{fact_id:rows(v).postal_code.fact.fact_id,revision:'999'}],note:'Checked against the register'});
 assert.equal(stale.verified_count,0);assert.equal(stale.skipped.length,1);assert.match(stale.skipped[0].reason,/changed/i);
 // Limits.
 await assert.rejects(()=>many('ASSISTANT',Array.from({length:61},(_,i)=>({field_key:'county',value:'N'+i}))),/./);
});
