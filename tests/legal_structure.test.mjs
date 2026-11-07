import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {applyLegalStructure,requireClassified,requireRightChart,classifyClientsAction} from '../supabase/functions/staff-workspace-v12/legal-structure-actions.ts';
import {familyFor,STRUCTURES} from '../supabase/functions/staff-workspace-v12/legal-structure.mjs';
import {familyOf,familyHint,legalStructureFields,unclassified,classifyTable,classifyItems} from '../staff-legal-structure.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),C2=id(),C3=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('Legal structure: mandatory classification, accounting family, audit trail and the history guard',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'LSQA','Fictional legal structure firm')`;
 const staff=async(role,cat,firm)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;};
 await staff('PARTNER','PARTNER',F);await staff('MANAGER','MANAGER',F);await staff('SUPERVISOR','SUPERVISOR',F);
 const save=(role,p,isNew=false,cid=C)=>as(role,a=>applyLegalStructure(tx,a,cid,p,isNew));
 const client=async cid=>(await tx`select legal_structure,legal_subtype,legal_entity_type,client_category,legal_structure_note from erp_private.clients where client_id=${cid}`)[0];
 const audit=async cid=>await tx`select after_values from erp_private.audit_events where action='LEGAL_STRUCTURE_CHANGE' and record_key=${cid}::text order by 1`;

 // The reference table holds the seven groups; NGO and CBO run on the Non-profit family, others are classified only.
 const rows=await tx`select structure,subtype,engine_family from erp_private.legal_structure_types`;
 assert.deepEqual([...new Set(rows.map(r=>r.structure))].sort(),[...STRUCTURES].sort());
 for(const s of ['NGO','CBO','PBO','Foundation','Self-Help Group'])assert.equal(familyFor(rows,'Non-Profit Organisation',s),'Non-profit organisation',s);
 assert.equal(familyFor(rows,'Individual','Sole Proprietor'),'Sole proprietor');assert.equal(familyFor(rows,'Individual','Individual Taxpayer'),'Other legal entity');
 for(const s of ['SACCO','Co-operative Union'])assert.equal(familyFor(rows,'Co-operative Society',s),'Other legal entity','not enabled for accounting yet: '+s);
 assert.equal(familyFor(rows,'Individual',null),null,'Individual alone is not enough to know the family');assert.equal(familyFor(rows,'Partnership',null),'Partnership');
 for(const r of rows)assert.equal(familyOf(rows,r.structure,r.subtype),r.engine_family,'screen and server agree');

 // Older records: an unambiguous category fills the structure; "Corporate" stays unclassified until staff confirm.
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,client_category) values(${C},'Mlima Traders',${actors.MANAGER.staff_id},'Corporate'),(${C2},'Tumaini Youth Group',${actors.MANAGER.staff_id},'Non-Profit'),(${C3},'Pwani Fresh',${actors.MANAGER.staff_id},null)`;
 assert.deepEqual(await client(C),{legal_structure:null,legal_subtype:null,legal_entity_type:null,client_category:'Corporate',legal_structure_note:''});
 assert.equal((await client(C2)).legal_structure,'Non-Profit Organisation');
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Mlima Traders accounts','TAX-COMP',${actors.MANAGER.staff_id})`;

 // A new client must be classified; a half choice or a mismatched pair is refused.
 await assert.rejects(()=>save('MANAGER',{},true),/Choose the client’s Legal structure and Subcategory/);
 await assert.rejects(()=>save('MANAGER',{legal_structure:'Partnership'}),/Choose the Subcategory/);
 await assert.rejects(()=>save('MANAGER',{legal_structure:'Partnership',legal_subtype:'SACCO'}),/does not belong/);
 await assert.rejects(()=>save('MANAGER',{legal_structure:'Charity',legal_subtype:'NGO'}),/Choose a Legal structure/);

 // First classification: no reason needed; the older category follows; the accounting family is left for the identity step.
 assert.equal((await save('MANAGER',{legal_structure:'Limited Company',legal_subtype:'Private Limited Company'})).changed,true);
 assert.deepEqual(await client(C),{legal_structure:'Limited Company',legal_subtype:'Private Limited Company',legal_entity_type:null,client_category:'Corporate',legal_structure_note:''});
 assert.equal((await save('MANAGER',{legal_structure:'Limited Company',legal_subtype:'Private Limited Company'})).changed,false,'saving the same choice changes nothing');

 // Changing it is for Managers and Partners, with a reason, and is audited.
 await assert.rejects(()=>save('SUPERVISOR',{legal_structure:'Partnership',legal_subtype:'General Partnership',legal_structure_reason:'Fictional correction of the structure'}),/access to this action/);
 await assert.rejects(()=>save('MANAGER',{legal_structure:'Partnership',legal_subtype:'General Partnership'}),/Record why the legal structure is being changed/);
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C}`;
 await tx`insert into erp_private.client_compliance(client_id,verified_by,verified_at) values(${C},${actors.PARTNER.staff_id},now())`;
 await save('MANAGER',{legal_structure:'Non-Profit Organisation',legal_subtype:'CBO',legal_structure_reason:'Fictional: registered as a CBO, not a company'});
 const afterCbo=await client(C);assert.equal(afterCbo.legal_entity_type,'Non-profit organisation','no accounting records yet, so the family follows');assert.equal(afterCbo.client_category,'Non-Profit');
 const kyc=(await tx`select verified_by,notes from erp_private.client_compliance where client_id=${C}`)[0];assert.equal(kyc.verified_by,null,'a verified KYC file goes back for re-verification');assert.match(kyc.notes,/KYC needs re-verification/);
 const trail=await audit(C);assert.equal(trail.length,2);assert.equal(trail[1].after_values.accounting_family,'Non-profit organisation');assert.match(trail[1].after_values.reason,/registered as a CBO/);
 assert.equal((await tx`select legal_structure_changed_by from erp_private.clients where client_id=${C}`)[0].legal_structure_changed_by,actors.MANAGER.staff_id);

 // The accounting engine accepts the Non-profit family; a ledger year then locks the family.
 await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${C},${F},'2027-01-01','2027-12-31','Non-profit organisation','Fictional registration certificate',${actors.MANAGER.staff_id})`;
 await assert.rejects(()=>save('PARTNER',{legal_structure:'Limited Company',legal_subtype:'Private Limited Company',legal_structure_reason:'Fictional attempt to rewrite history'}),/separate successor client/);
 assert.equal((await client(C)).legal_structure,'Non-Profit Organisation','a refused change leaves the record untouched');
 assert.equal((await save('PARTNER',{legal_structure:'Non-Profit Organisation',legal_subtype:'NGO',legal_structure_reason:'Fictional: confirmed NGO registration'})).changed,true,'a change inside the same family is allowed with history');
 assert.equal((await client(C)).legal_entity_type,'Non-profit organisation');

 // The gates: classification first, then the approved chart for the family, before project, client year and opening TB.
 const gate=(cid,fn=requireRightChart)=>as('MANAGER',()=>fn(tx,cid,'creating the client year'));
 await assert.rejects(()=>gate(C3),/Legal structure and Subcategory/);
 await assert.rejects(()=>gate(C3,requireClassified),/Legal structure and Subcategory/);
 await tx`update erp_private.clients set legal_structure='Non-Profit Organisation' where client_id=${C3}`;
 await assert.rejects(()=>gate(C3,requireClassified),/Legal structure and Subcategory/,'the subcategory is required too');
 await tx`update erp_private.clients set legal_subtype='NGO' where client_id=${C3}`;
 assert.equal((await gate(C3,requireClassified)).legal_subtype,'NGO','proposing a chart needs only the classification');
 await assert.rejects(()=>gate(C3),/Confirm the client’s legal entity type/);
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C3}`;
 await assert.rejects(()=>gate(C3),/does not match its Legal structure \(Non-profit organisation\)/);
 await tx`update erp_private.clients set legal_entity_type='Non-profit organisation' where client_id=${C3}`;
 await assert.rejects(()=>gate(C3),/chart of accounts for this Non-profit organisation client is not approved yet/);
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C3},'2027-01-01','Limited company','{Other}','{10000}','Approved',${actors.PARTNER.staff_id},${actors.MANAGER.staff_id},now(),'Fictional approval of the wrong family')`;
 await assert.rejects(()=>gate(C3),/not approved yet/,'a chart approved for another family is not the right chart');
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C3},'2027-01-01','Non-profit organisation','{Other}','{10000}','Approved',${actors.PARTNER.staff_id},${actors.MANAGER.staff_id},now(),'Fictional approval of the right family')`;
 assert.equal((await gate(C3)).legal_entity_type,'Non-profit organisation');

 // Draft non-profit accounts wait for a Partner; nothing is active by default.
 const npo=await tx`select code,status,entity_types from erp_private.account_catalog where 'Non-profit organisation'=any(entity_types) order by code`;
 assert.ok(npo.length>=8);assert.ok(npo.every(x=>x.status==='Draft'&&x.entity_types.length===1));

 // Bulk "Classify clients": all or nothing, one audit entry per client, Managers and Partners only.
 const C4=id(),C5=id(),C6=id();
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,client_category) values(${C4},'Kilele Hardware',${actors.MANAGER.staff_id},'Corporate'),(${C5},'Tumaini Women Group',${actors.MANAGER.staff_id},null),(${C6},'Safari Tyres',${actors.MANAGER.staff_id},null)`;
 const bulk=(role,p)=>as(role,a=>classifyClientsAction(tx,a,p));
 const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');assert.equal(areaForStaffAction('client_classify_save'),'clients');
 await assert.rejects(()=>bulk('SUPERVISOR',{items:[{client_id:C4,legal_structure:'Limited Company',legal_subtype:'Private Limited Company'}]}),/access to this action/);
 await assert.rejects(()=>bulk('MANAGER',{items:[{client_id:C4}]}),/at least one client/);
 await assert.rejects(()=>bulk('MANAGER',{items:[{client_id:C4,legal_structure:'Limited Company',legal_subtype:'Private Limited Company'},{client_id:C5,legal_structure:'Partnership',legal_subtype:'SACCO'}]}),/Tumaini Women Group: That subcategory does not belong/);
 assert.equal((await client(C4)).legal_structure,null,'one bad row saves nothing');
 await assert.rejects(()=>bulk('MANAGER',{items:[{client_id:C,legal_structure:'Partnership',legal_subtype:'General Partnership'}]}),/already classified/);
 const saved=await bulk('MANAGER',{note:'Fictional: classified from the registration certificates on file',items:[{client_id:C4,legal_structure:'Limited Company',legal_subtype:'Private Limited Company'},{client_id:C5,legal_structure:'Non-Profit Organisation',legal_subtype:'CBO'},{client_id:C6}]});
 assert.equal(saved.classified,2);
 assert.equal((await client(C5)).client_category,'Non-Profit');assert.equal((await client(C6)).legal_structure,null,'a blank row is left for later');
 for(const cid of [C4,C5]){const rows2=await audit(cid);assert.equal(rows2.length,1);assert.match(rows2[0].after_values.reason,/registration certificates/);}
 const list=unclassified(await tx`select client_id,company_name,legal_structure,legal_subtype,client_category,kra_pin from erp_private.clients`);assert.ok(list.some(x=>x.client_id===C6)&&!list.some(x=>x.client_id===C4));
 assert.match(classifyTable({clients:list,rows,esc:s=>String(s??''),options:(i,v,b)=>`<option>${b}</option>`}),/Safari Tyres/);
 const fd=new FormData();fd.set('structure_a','Partnership');fd.set('subtype_a','General Partnership');fd.set('structure_b','');fd.set('subtype_b','');fd.set('structure_c','Individual');fd.set('subtype_c','');
 assert.deepEqual(classifyItems(fd),[{client_id:'a',legal_structure:'Partnership',legal_subtype:'General Partnership'},{client_id:'c',legal_structure:'Individual',legal_subtype:''}]);

 // Screen helper: fields render the pairs, the hint explains the family, and a Supervisor cannot reopen a classified client.
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),options=(items,value,blank)=>`<option value="">${blank}</option>`+items.map(x=>`<option value="${esc(x)}"${x===value?' selected':''}>${esc(x)}</option>`).join('');
 const html=legalStructureFields({client:{legal_structure:'Non-Profit Organisation',legal_subtype:'CBO'},rows,isLeader:false,esc,options});
 assert.match(html,/name="legal_structure" required disabled/);assert.match(html,/Only a Manager or Partner can change a classified client/);
 assert.match(familyHint(rows,'Co-operative Society','SACCO'),/accounting engine is not enabled yet/);assert.match(familyHint(rows,'Non-Profit Organisation','NGO'),/available for this client/);
});
