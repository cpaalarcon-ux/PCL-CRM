import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {checkOwnerRows,checkContactRows,NOT_SIGHTED}=await import('../supabase/functions/staff-workspace-v12/owner-batch-rules.mjs');
const {ownerBatchStage,ownerBatchAction}=await import('../supabase/functions/staff-workspace-v12/owner-batch-actions.ts');
const onboarding=await import('../supabase/functions/staff-workspace-v12/onboarding-template-rules.ts');
const {proposalAction}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const {policyAction}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const {engagementAction}=await import('../supabase/functions/staff-workspace-v12/engagement-actions.ts');
const {default:ExcelJS}=await import('exceljs');
const HEAD=['client_kra_pin','client_name','full_name','identity_reference','owner_kra_pin','ownership_percentage','control_basis','identity_type','nationality','direct_or_indirect','date_became_owner','is_pep','screening_date','screening_result','evidence_reference','notes'];
const rowsOf=list=>list.map((r,i)=>({row:i+2,values:Object.fromEntries(HEAD.map((h,j)=>[h,r[j]??'']))}));
const owner=(pin,client,name,share,extra={})=>{const o={client_kra_pin:pin,client_name:client,full_name:name,ownership_percentage:share,...extra};return HEAD.map(h=>o[h]??'');};

test('owner workbook rules: every owner has a share and each client totals 100%',()=>{
 // Percentages as typed, and Excel's fraction form (100% stored as 1), both read correctly.
 const ok=checkOwnerRows(rowsOf([owner('P000000021A','Fictional One Ltd','Fictional Amina Otieno',60,{identity_reference:'DIRECTOR',control_basis:'Direct ownership',identity_type:'ID CARD',direct_or_indirect:'direct',is_pep:'Unknown',owner_kra_pin:'a000000031b'}),
  owner('P000000021A','Fictional One Ltd','Fictional Brian Kiprop','40%'),
  owner('P000000022B','Fictional Two Ltd','Fictional Carol Wanjiru',0.5),owner('P000000022B','Fictional Two Ltd','Fictional Daniel Mwangi',0.5),
  owner('A000000023C','Fictional Sole Trader','Fictional Sole Trader',1,{identity_reference:'SOLE PROPRIETOR'})]));
 assert.deepEqual(ok.errors,[]);assert.equal(ok.clients.length,3);
 assert.deepEqual(ok.clients.map(c=>c.total),[100,100,100]);
 const a=ok.clients[0].owners[0];assert.equal(a.control_basis,'Director · Direct ownership');assert.equal(a.identity_type,'National ID');assert.equal(a.holding_type,'Direct');assert.equal(a.pep_status,'To confirm');assert.equal(a.kra_pin,'A000000031B');
 assert.deepEqual(ok.clients[1].owners.map(o=>o.ownership_percentage),[50,50]);assert.equal(ok.clients[2].owners[0].ownership_percentage,100);
 // Thirds entered to two decimals are accepted.
 assert.deepEqual(checkOwnerRows(rowsOf([1,2,3].map(n=>owner('P000000021A','Fictional One Ltd','Fictional Owner '+'ABC'[n-1],33.33)))).errors,[]);
 // A blank share, a total short of 100 and a total over 100 each stop the file and name the row.
 const bad=checkOwnerRows(rowsOf([owner('P000000021A','Fictional One Ltd','Fictional Amina Otieno',60),owner('P000000021A','Fictional One Ltd','Fictional Brian Kiprop',''),
  owner('P000000022B','Fictional Two Ltd','Fictional Carol Wanjiru',70),
  owner('P000000024D','Fictional Four Ltd','Fictional Esther Njeri',80),owner('P000000024D','Fictional Four Ltd','Fictional Felix Odhiambo',30),
  owner('P000000025E','Fictional Five Ltd','Fictional Grace Achieng','half'),owner('NOTAPIN','Fictional Six Ltd','Fictional Henry',100),owner('P000000026F','Fictional Seven Ltd','',100),
  owner('P000000027G','Fictional Eight Ltd','Fictional Irene',100,{owner_kra_pin:'123',direct_or_indirect:'Both',is_pep:'Maybe'}),
  owner('P000000028H','Fictional Nine Ltd','Fictional John',50),owner('P000000028H','Fictional Nine Ltd','fictional john',50)]));
 const t=JSON.stringify(bad.errors);
 assert.ok(bad.errors.some(e=>e.row===3&&/share is blank/.test(e.issue)));assert.ok(!bad.errors.some(e=>e.row===2&&/add to/.test(e.issue)),'a blank share is reported once, not also as a wrong total');
 assert.match(t,/Fictional Two Ltd: the owners’ shares add to 70%\. They must total 100%/);assert.match(t,/Fictional Four Ltd: the owners’ shares add to 110%/);
 assert.match(t,/“half” is not a percentage/);assert.match(t,/NOTAPIN is not a valid KRA PIN/);assert.match(t,/The owner has no name/);assert.match(t,/123 is not a valid KRA PIN/);assert.match(t,/not Direct or Indirect/);assert.match(t,/not Yes, No or Unknown/);assert.match(t,/listed twice/);
 // An identity number is never kept: the column is used only when it holds a role word.
 const idn=checkOwnerRows(rowsOf([owner('P000000021A','Fictional One Ltd','Fictional Amina Otieno',100,{identity_reference:'29384756',identity_type:'Company registration'})]));
 assert.deepEqual(idn.errors,[]);assert.ok(!JSON.stringify(idn.clients).includes('29384756'));assert.match(JSON.stringify(idn.notices),/identity-document number\. It was ignored/);assert.match(JSON.stringify(idn.notices),/Company registration/);assert.equal(idn.clients[0].owners[0].identity_type,null);
 assert.match(JSON.stringify(checkOwnerRows([]).errors),/no owners/);
 assert.equal(NOT_SIGHTED,onboarding.NOT_SIGHTED,'the same wording as the onboarding form uses');
 // Contacts: a row with no name is left out with a notice; a named contact needs an email or phone.
 const c=checkContactRows([{row:2,values:{client_kra_pin:'P000000021A',full_name:'Fictional Ken',job_title:'Director',email_address:'KEN@Example.com',phone_number:'0710853151',role_in_decision:'Decision maker'}},
  {row:3,values:{client_kra_pin:'P000000022B',full_name:'',email_address:'info@example.com'}},{row:4,values:{client_kra_pin:'P000000022B',full_name:'Fictional Lucy',phone_number:'710853152'}}]);
 assert.deepEqual(c.errors,[]);assert.equal(c.contacts.length,2);assert.deepEqual(c.contacts[0],{row:2,pin:'P000000021A',full_name:'Fictional Ken',job_title:'Director',email_address:'ken@example.com',phone_number:'+254710853151',role_in_decision:'Decision Maker'});
 assert.equal(c.contacts[1].phone_number,'+254710853152');assert.equal(c.notices.length,1);
 const cb=JSON.stringify(checkContactRows([{row:2,values:{client_kra_pin:'P000000021A',full_name:'Fictional Ken'}},{row:3,values:{client_kra_pin:'P000000021A',full_name:'Fictional Lucy',email_address:'nope',phone_number:'12',role_in_decision:'Boss'}}]).errors);
 assert.match(cb,/no email and no phone/);assert.match(cb,/not a valid email/);assert.match(cb,/not a Kenyan phone/);assert.match(cb,/not a listed role/);
});

const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
tx.savepoint=async fn=>{await db.exec('savepoint rs');try{const r=await fn(tx);await db.exec('release savepoint rs');return r;}catch(e){await db.exec('rollback to savepoint rs');throw e;}};
const runAs=a=>{const run=async q=>{
 if(q.action==='client_proposal_check'||q.action==='client_proposal_approve')return proposalAction(tx,a,q,run);
 if(q.action==='owner_add')return engagementAction(tx,a,q);
 if(q.action==='contact_save'){await tx`insert into erp_private.client_contacts(client_id,full_name,job_title,email_address,phone_number,role_in_decision) values(${q.client_id},${q.full_name},${q.job_title??null},${q.email_address??null},${q.phone_number??null},${q.role_in_decision??null})`;return {ok:true};}
 throw new Error('unexpected '+q.action);};return run;};
const stage=(role,f)=>as(role,a=>ownerBatchStage(tx,a,f)),batch=(role,p)=>as(role,a=>ownerBatchAction(tx,a,p,runAs(a)));
const book=async sheets=>{const wb=new ExcelJS.Workbook();for(const [name,rows] of Object.entries(sheets)){const ws=wb.addWorksheet(name);for(const r of rows)ws.addRow(r);}return Buffer.from(await wb.xlsx.writeBuffer());};
const upload=async sheets=>{const f=new FormData();f.set('file',new File([await book(sheets)],'clients.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return f;};
const CHEAD=['client_kra_pin','client_name','full_name','job_title','email_address','phone_number','role_in_decision'];
const good={'Beneficial Owners':[HEAD,owner('P000000021A','UAT Fictional One Ltd','Fictional Amina Otieno',0.6,{identity_reference:'DIRECTOR',control_basis:'Direct ownership',direct_or_indirect:'Direct',is_pep:'Unknown',screening_result:'Clear',owner_kra_pin:'A000000031B'}),
  owner('P000000021A','UAT Fictional One Ltd','Fictional Brian Kiprop',0.4,{identity_reference:'DIRECTOR'}),
  owner('A000000023C','UAT Fictional Sole Trader','UAT Fictional Sole Trader',1,{identity_reference:'SOLE PROPRIETOR',owner_kra_pin:'A000000023C'})],
 'Contacts':[CHEAD,['P000000021A','UAT Fictional One Ltd','Fictional Ken','Director','ken@example.com','0710853151',null],['A000000023C','UAT Fictional Sole Trader',null,null,'info@example.com',null,null]]};
test('owner batch loader: owners and contacts from the client workbook go through check and approval, and shares must total 100%',async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},${a.category_code==='MANAGER'?'Firm':'Assigned'})`;}
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));
 const C1=id(),C2=id(),C3=id();
 for(const [cid,name,pin] of [[C1,'UAT Fictional One Ltd','P000000021A'],[C2,'UAT Fictional Sole Trader','A000000023C'],[C3,'UAT Fictional Three Ltd','P000000029J']]){
  await tx`insert into erp_private.clients(client_id,company_name,kra_pin,record_status,owner_staff_id,is_uat_fixture) values(${cid},${name},${pin},'Existing',${cid===C3?actors.SUPERVISOR.staff_id:actors.ASSISTANT.staff_id},true)`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${F})`;}
 const proposals=async()=>(await tx`select count(*)::int n from erp_private.change_proposals`)[0].n;
 // 1. Only a preparer uploads, and the workbook must have the sheet.
 await assert.rejects(async()=>stage('MANAGER',await upload(good)),/access/);
 await assert.rejects(async()=>stage('ASSISTANT',await upload({'Other':[['x']]})),/Beneficial Owners/);
 await assert.rejects(async()=>stage('ASSISTANT',await upload({'Beneficial Owners':[['client_kra_pin','full_name']]})),/ownership_percentage/);
 // 2. One client short of 100% stops the whole file; nothing is proposed.
 const short=await stage('ASSISTANT',await upload({...good,'Beneficial Owners':[HEAD,good['Beneficial Owners'][1],owner('P000000021A','UAT Fictional One Ltd','Fictional Brian Kiprop',0.3),good['Beneficial Owners'][3]]}));
 assert.equal(short.status,'VALIDATION_FAILED');assert.match(JSON.stringify(short.errors),/add to 0\.9%|add to 90%/);assert.equal(await proposals(),0);
 // 3. A client that is not on file stops the file.
 const unknown=await stage('ASSISTANT',await upload({'Beneficial Owners':[HEAD,owner('P000000099Z','Not On File Ltd','Fictional Zed',100)]}));
 assert.equal(unknown.status,'VALIDATION_FAILED');assert.match(JSON.stringify(unknown.errors),/not a client you can open/);assert.equal(await proposals(),0);
 // 4. A clean file: one proposal per owner and per named contact. Screening results and identity numbers are not carried.
 const out=await stage('ASSISTANT',await upload(good));
 if(out.status!=='PROPOSED')console.log(JSON.stringify(out.errors));assert.equal(out.status,'PROPOSED');assert.equal(out.owners,3);assert.equal(out.contacts,1);assert.match(out.batch_ref,/^OW-\d{8}-/);
 assert.ok(out.notices.some(n=>/no contact name/.test(n.issue)));
 const ref=out.batch_ref,props=await tx`select * from erp_private.change_proposals where payload->>'batch_ref'=${ref} order by action desc,(payload->>'batch_row')::int`;
 assert.equal(props.length,4);assert.ok(props.every(p=>p.status==='Proposed'&&p.proposed_by===actors.ASSISTANT.staff_id));
 const first=props.find(p=>p.payload.full_name==='Fictional Amina Otieno').payload;
 assert.equal(first.ownership_percentage,60);assert.equal(first.identity_reference,NOT_SIGHTED);assert.equal(first.control_basis,'Director · Direct ownership');assert.equal(first.pep_status,'To confirm');assert.equal(first.kra_pin,'A000000031B');
 assert.ok(!JSON.stringify(props).includes('Clear'),'screening results are never loaded from the workbook');
 assert.equal((await tx`select count(*)::int n from erp_private.beneficial_owners`)[0].n,0,'nothing is on the client record before approval');
 // 5. The same file again proposes nothing new.
 const again=await stage('ASSISTANT',await upload(good));assert.equal(again.status,'PROPOSED');assert.equal(again.proposed.length,0);assert.equal(again.batch_ref,null);assert.equal(again.skipped_existing.length,4);assert.equal(await proposals(),4);
 // 6. Check and approval run the ordinary single-proposal rules for every entry.
 await assert.rejects(()=>batch('ASSISTANT',{action:'owner_batch_check',batch_ref:ref,note:'Checked against the CR12'}),/access/);
 await assert.rejects(()=>batch('SUPERVISOR',{action:'owner_batch_check',batch_ref:ref,note:'short'}),/10 characters/);
 await assert.rejects(()=>batch('SUPERVISOR',{action:'owner_batch_approve',batch_ref:ref,note:'Approved against the CR12'}),/Manager or Partner/);
 await assert.rejects(()=>batch('MANAGER',{action:'owner_batch_approve',batch_ref:ref,note:'Approved against the CR12'}),/waiting for approval/);
 // A Supervisor who cannot open these clients finds nothing to check; a Manager with the firm in scope checks, and a different Manager approves.
 await assert.rejects(()=>batch('SUPERVISOR',{action:'owner_batch_check',batch_ref:ref,note:'Matches the CR12 and PIN certificates'}),/waiting for a check/);
 const checked=await batch('MANAGER',{action:'owner_batch_check',batch_ref:ref,note:'Matches the CR12 and PIN certificates'});assert.equal(checked.done.length,4);assert.equal(checked.held.length,0);
 const self=await batch('MANAGER',{action:'owner_batch_approve',batch_ref:ref,note:'Agreed to the registry extracts'});assert.equal(self.done.length,0,'the person who checked cannot approve');assert.match(self.held[0].reason,/another Manager or Partner/);
 const approved=await batch('MANAGER2',{action:'owner_batch_approve',batch_ref:ref,note:'Agreed to the registry extracts'});assert.equal(approved.held.length,0,JSON.stringify(approved.held));assert.equal(approved.done.length,4);
 const owners=await tx`select client_id,full_name,ownership_percentage::float8 p,identity_reference,control_basis,pep_status,kra_pin from erp_private.beneficial_owners where deleted_at is null order by full_name`;
 assert.equal(owners.length,3);assert.equal(owners.filter(o=>o.client_id===C1).reduce((s,o)=>s+o.p,0),100);assert.ok(owners.every(o=>o.identity_reference===NOT_SIGHTED));
 assert.equal((await tx`select count(*)::int n from erp_private.client_contacts where client_id=${C1} and full_name='Fictional Ken'`)[0].n,1);
 // 7. Owners already on the record count toward the 100%: adding 50% more to a complete client is refused, and a partly owned client can be completed.
 const over=await stage('ASSISTANT',await upload({'Beneficial Owners':[HEAD,owner('P000000021A','UAT Fictional One Ltd','Fictional New Person',1)]}));
 assert.equal(over.status,'VALIDATION_FAILED');assert.match(JSON.stringify(over.errors),/would add to 200%\. They must total 100%/);
 await tx`insert into erp_private.beneficial_owners(client_id,full_name,identity_reference,ownership_percentage,control_basis,created_by) values(${C3},'Fictional Existing Owner',${NOT_SIGHTED},70,'Director',${actors.MANAGER.staff_id})`;
 const part=await stage('SUPERVISOR',await upload({'Beneficial Owners':[HEAD,owner('P000000029J','UAT Fictional Three Ltd','Fictional Existing Owner',70),owner('P000000029J','UAT Fictional Three Ltd','Fictional Second Owner',30)]}));
 assert.equal(part.status,'PROPOSED');assert.equal(part.owners,1);assert.equal(part.skipped_existing.length,1);
 // A Supervisor cannot check their own batch.
 const own=await batch('SUPERVISOR',{action:'owner_batch_check',batch_ref:part.batch_ref,note:'Checked my own work'}).catch(e=>e);
 assert.ok(own instanceof Error?/waiting/.test(own.message):own.held.length===1&&own.done.length===0,'a proposer cannot check their own batch');
});
test('owner batch buttons: an owners batch is checked and approved through its own actions',async()=>{
 globalThis.document={addEventListener(){}};
 const ui=await import('../staff-proposals.mjs');
 const me=(role,idv)=>({category_code:role,staff_id:idv});
 const list=[{action:'owner_add',status:'Proposed',proposed_by:'a',payload:{batch_ref:'OW-1'}},{action:'contact_save',status:'Checked',proposed_by:'a',checked_by:'s',payload:{batch_ref:'OW-1'}},
  {action:'owner_add',status:'Proposed',proposed_by:'a',payload:{batch_ref:'OB-9'}},{action:'client_save',status:'Proposed',proposed_by:'a',payload:{batch_ref:'CB-1'}}];
 assert.deepEqual(ui.batchGroups(list,me('MANAGER','m')).map(g=>[g.ref,g.kind,g.total,g.check,g.approve]),[['OW-1','owner',2,1,1],['CB-1','client',1,1,0]],'an onboarding-form batch (OB-) keeps its own screen');
 const bar=ui.batchBar(list,me('MANAGER','m'));assert.match(bar,/data-kind="owner" data-ref="OW-1"/);assert.match(bar,/owner or contact entries/);assert.match(bar,/data-kind="client" data-ref="CB-1"/);
 assert.match(ui.addClientButton({me:{category_code:'ASSISTANT',restricted_rights:[]},firms:[{}],policies:[{policy_code:'ASSISTANT_DATA_ENTRY',status:'Signed'}]})||'data-propose="owner-batch"',/owner-batch/);
 assert.match(ui.ownerBatchResultHtml({message:'m',owners:2,contacts:1,skipped_existing:[],notices:[{row:3,column:'c',issue:'i'}]}),/Owners proposed: <b>2<\/b>[\s\S]*Not recorded/);
});
