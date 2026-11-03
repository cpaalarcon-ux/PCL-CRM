import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {engagementAction,kycGaps}=await import('../supabase/functions/staff-workspace-v12/engagement-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const kyc=(role,p)=>as(role,a=>engagementAction(tx,a,{client_id:C,...p}));
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const compliance=async()=>(await tx`select * from erp_private.client_compliance where client_id=${C}`)[0];
const profile={action:'compliance_save',entity_type:'Sole proprietor',risk_rating:'Low',is_pep:false,conflict_checked:true,sanctions_date:today,sanctions_result:'Fictional QA screening only',review_due:'2027-12-31',notes:'Fictional QA client'};

test('KYC gaps follow the dated evidence rules, accepted forms and expiry',()=>{
 const rules=[{rule_code:'KRA_PIN',label:'KRA PIN',accepted_forms:['online'],renewal_days:null,required_for_entities:['Company','Sole proprietor']},{rule_code:'DIRECTORS_CR12',label:'Directors / CR12',accepted_forms:['upload','physical','online'],renewal_days:30,required_for_entities:['Company']}];
 assert.deepEqual(kycGaps('Sole proprietor',rules,[{covered_items:['KRA_PIN'],evidence_form:'physical',evidence_date:'2026-10-01'}],'2026-11-03'),['KRA PIN'],'a form the rule does not accept does not count');
 assert.deepEqual(kycGaps('Sole proprietor',rules,[{covered_items:['KRA_PIN'],evidence_form:'online',evidence_date:'2026-10-01'}],'2026-11-03'),[]);
 assert.deepEqual(kycGaps('Company',rules,[{covered_items:['KRA_PIN','DIRECTORS_CR12'],evidence_form:'online',evidence_date:'2026-09-01'}],'2026-11-03'),['Directors / CR12'],'renewal interval expires old evidence');
 assert.deepEqual(kycGaps('Company',rules,[{covered_items:['KRA_PIN','DIRECTORS_CR12'],evidence_form:'online',evidence_date:'2026-10-20',expires_on:'2026-11-02'}],'2026-11-03'),['KRA PIN','Directors / CR12'],'expired evidence does not count');
});

test('KYC uses evidence records, needs an independent verifier and reopens review only for real changes',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'KYCQA','Fictional KYC firm')`;
 for(const role of ['PARTNER','MANAGER']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,owner_staff_id) values(${C},'Fictional KYC client','A099000001Z','SME/Startup','Nairobi','Individual',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;

 await assert.rejects(()=>kyc('MANAGER',{action:'compliance_evidence_save',document_type:'KRA_PIN',evidence_form:'online',online_source:'iTax',online_reference:'QA-1',evidence_date:today}),/Save the client KYC profile first/);
 await kyc('MANAGER',profile);
 let c=await compliance();await assert.rejects(()=>kyc('PARTNER',{action:'compliance_verify',revision:c.revision}),/missing or expired for: KRA PIN, Registration \/ identity|missing or expired for: Registration \/ identity, KRA PIN/);
 await assert.rejects(()=>kyc('MANAGER',{action:'compliance_evidence_save',document_type:'REGISTRATION_IDENTITY',evidence_form:'physical',evidence_date:today}),/required|Enter/i,'physical evidence needs a reference, location and copy type');
 const physical=await kyc('MANAGER',{action:'compliance_evidence_save',document_type:'REGISTRATION_IDENTITY',covered_items:['KRA_PIN'],evidence_form:'physical',document_reference:'ID 12345678',physical_location:'Permanent file cabinet A',copy_type:'Certified copy',evidence_date:today});
 const row=(await tx`select * from erp_private.client_kyc_evidence where evidence_id=${physical.evidence_id}`)[0];
 assert.deepEqual(row.covered_items,['REGISTRATION_IDENTITY','KRA_PIN'],'one record covers several requirements');assert.equal(row.sighted_by,actors.MANAGER.staff_id);
 c=await compliance();
 await assert.rejects(()=>kyc('MANAGER',{action:'compliance_verify',revision:c.revision}),/A different Manager or Partner must verify/);
 await kyc('PARTNER',{action:'compliance_verify',revision:c.revision});
 assert.equal((await compliance()).verified_by,actors.PARTNER.staff_id);

 c=await compliance();const same=await kyc('PARTNER',{...profile,revision:c.revision});
 assert.deepEqual(same.changed_items,[]);assert.equal(same.change_version,null);
 assert.equal((await compliance()).verified_by,actors.PARTNER.staff_id,'saving without changes keeps the verification');

 c=await compliance();const changed=await kyc('MANAGER',{...profile,risk_rating:'Medium',revision:c.revision,change_reason:'Fictional risk reassessment'});
 assert.deepEqual(changed.changed_items,['risk_rating']);assert.equal(changed.change_version,1);
 c=await compliance();assert.equal(c.verified_by,null,'a real change reopens review');
 const v1=(await tx`select * from erp_private.client_kyc_change_versions where client_id=${C}`)[0];
 assert.equal(v1.status,'Pending review');assert.deepEqual(v1.changed_items,['risk_rating']);assert.equal(v1.before_snapshot.compliance.risk_rating,'Low');assert.equal(v1.proposed_snapshot.compliance.risk_rating,'Medium');
 await assert.rejects(()=>kyc('MANAGER',{action:'compliance_verify',revision:c.revision}),/different Manager or Partner/);
 await kyc('PARTNER',{action:'compliance_verify',revision:c.revision,review_note:'Fictional risk change reviewed'});
 assert.equal((await tx`select status,reviewed_by from erp_private.client_kyc_change_versions where client_id=${C}`)[0].status,'Approved');

 const ev=(await tx`select revision from erp_private.client_kyc_evidence where evidence_id=${physical.evidence_id}`)[0];
 await kyc('PARTNER',{action:'compliance_evidence_remove',evidence_id:physical.evidence_id,revision:ev.revision,change_reason:'Fictional: certified copy replaced'});
 c=await compliance();assert.equal(c.verified_by,null);
 const v2=(await tx`select * from erp_private.client_kyc_change_versions where client_id=${C} and version_number=2`)[0];assert.deepEqual(v2.changed_items,['REGISTRATION_IDENTITY','KRA_PIN']);
 await assert.rejects(()=>kyc('MANAGER',{action:'compliance_verify',revision:c.revision}),/missing or expired/);
 const online=await kyc('PARTNER',{action:'compliance_evidence_save',document_type:'REGISTRATION_IDENTITY',covered_items:['KRA_PIN'],evidence_form:'online',online_source:'BRS and iTax',online_reference:'Fictional QA search 2',evidence_date:today,change_reason:'Fictional online check recorded'});
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_kyc_evidence set online_reference='changed' where evidence_id=${online.evidence_id}`),/immutable/,'recorded evidence cannot be edited in place');
 c=await compliance();
 await assert.rejects(()=>kyc('PARTNER',{action:'compliance_verify',revision:c.revision}),/different Manager or Partner/);
 await kyc('MANAGER',{action:'compliance_verify',revision:c.revision});
 assert.equal(Number((await tx`select count(*)::int as n from erp_private.client_kyc_change_versions where client_id=${C} and status='Pending review'`)[0].n),0);
});
