// Build .1081: paged Client Register with server-side filters. The database decides which clients match; the screens only show the page.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {DEFAULT_QUERY,queryToRequest,filterCount,toolbar,pager,rowMeta} from '../staff-client-register.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('request building, toolbar, pager and card figures',()=>{
 const q=DEFAULT_QUERY();assert.equal(filterCount(q),0);
 q.q='ngamu';q.kyc='outstanding';q.deadline='14';q.sort='deadline';q.size=50;q.page=2;q.archived=true;
 const r=queryToRequest(q,'firm-1');
 assert.deepEqual([r.action,r.q,r.firm_id,r.kyc,r.deadline_days,r.sort,r.page_size,r.page,r.show_archived],['client_register_page','ngamu','firm-1','outstanding',14,'deadline',50,2,true]);
 assert.equal(queryToRequest(DEFAULT_QUERY(),'').deadline_days,null);assert.equal(queryToRequest(DEFAULT_QUERY(),'').firm_id,null);
 assert.equal(filterCount(q),4);
 const bar=toolbar(q,{sectors:['Energy'],owners:[{staff_id:'m1',full_name:'Sarah <b>'}]},esc);
 assert.match(bar,/data-creg="service"/);assert.match(bar,/data-creg="owner"/);assert.match(bar,/Sarah &lt;b&gt;/);assert.match(bar,/data-creg="sector"/);assert.match(bar,/<option value="outstanding" selected>/);assert.match(bar,/Clear filters \(4\)/);
 assert.match(toolbar(DEFAULT_QUERY(),{},esc),/data-creg-clear disabled>Clear filters</);
 const pg=pager({total:60,page:1,pages:3,page_size:25},esc);
 assert.match(pg,/Showing 26–50 of 60 clients/);assert.match(pg,/Page 2 of 3/);assert.doesNotMatch(pg,/data-creg-page="prev" disabled/);assert.doesNotMatch(pg,/data-creg-page="next" disabled/);
 assert.match(pager({total:0,page:0,pages:1,page_size:25},esc),/No clients match/);assert.match(pager({total:5,page:0,pages:1,page_size:25},esc),/data-creg-page="prev" disabled/);
 assert.equal(pager(null,esc),'');
 const m=rowMeta({active_projects:1,open_tasks:3,overdue_tasks:2,next_deadline:'2030-01-01T00:00:00Z'},esc,()=>'1 Jan 2030');
 assert.match(m,/1 active project</);assert.match(m,/3 open tasks/);assert.match(m,/2 overdue/);assert.match(m,/Next deadline 1 Jan 2030/);
 assert.match(rowMeta({active_projects:0,open_tasks:0,overdue_tasks:0,next_deadline:null},esc,()=>''),/No open deadline/);assert.equal(rowMeta(null,esc,()=>''),'');
});
test('page and server wiring',()=>{
 const pilot=rd('staff-pilot.mjs');assert.match(pilot,/staff-client-register\.mjs\?v=/);assert.match(pilot,/queryToRequest\(clientQuery,firm\)/);assert.match(pilot,/data-creg-page|cregPage/);
 assert.match(rd('staff-client-cards.mjs'),/extra=''/);
 const act=rd(fx+'client-register-actions.ts');assert.match(act,/client_register_page/);assert.match(act,/erp_private\.client_register\(/);
 assert.match(rd(fx+'index.ts'),/clientRegisterAction\(tx,a,p\)/);assert.match(rd(fx+'staff-access-control.mjs'),/client_register_/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),F2=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('the register filters, sorts and pages in the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'RGA','Fictional register firm A'),(${F2},'RGB','Fictional register firm B')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;for(const f of [F,F2])await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${f},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,names={};
 const mkClient=async(key,name,{owner=M,firm=F,pin=null,sector=null,structure=null}={})=>{const c=names[key]=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,kra_pin,primary_sector) values(${c},${name},${owner},${pin},${sector})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${firm})`;return c;};
 const asciiProject=async(c,firm=F,status='Active')=>{const p=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${c},${firm},'Fictional register project','TAX-COMP',${M})`;if(status==='Active')await tx`update erp_private.projects set status='Active' where project_id=${p}`;return p;};
 // Fixture: eight fictional clients.
 const a=await mkClient('alpha','Alpha Register Ltd',{pin:'A000000001A',sector:'Energy'});
 const b=await mkClient('bravo','Bravo Register Ltd',{pin:'A000000002B',owner:M2,firm:F2});
 await mkClient('charlie','Charlie 100% Register Ltd');
 await mkClient('delta','Delta Register Ltd');
 await mkClient('echo','Echo Register Ltd');
 await mkClient('foxtrot','Foxtrot Register Ltd');
 await mkClient('golf','Golf Register Ltd');
 const h=await mkClient('hotel','Hotel Register Ltd');
 // Alpha: KYC complete (PIN + verified compliance + a contact), tax verified, two Active projects with tasks (one overdue).
 await tx`insert into erp_private.client_compliance(client_id,verified_by,verified_at) values(${a},${M},now())`;
 await tx`insert into erp_private.client_contacts(client_id,full_name,role_in_decision) values(${a},'Fictional Contact','Decision Maker')`;
 await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,status,created_by,verified_by,verified_at) values(${a},'Company','Resident','Standard',${tx.array(['VAT'])}::text[],'2026-01-01','2026-12-31','Fictional profile','Verified',${M},${M2},now())`;
 const pa1=await asciiProject(a),pa2=await asciiProject(a);
 for(const pr of [pa1,pa2])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pr},${M},${F},'MANAGER')`;
 await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at) values(${pa1},${M},'Fictional overdue task',now()-interval '3 days'),(${pa1},${M},'Fictional soon task',now()+interval '5 days'),(${pa2},${M},'Fictional later task',now()+interval '40 days')`;
 // Bravo: one Active project, next deadline in 20 days.
 const pb=await asciiProject(b,F2);await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pb},${M2},${F2},'MANAGER')`;await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at) values(${pb},${M2},'Fictional bravo task',now()+interval '20 days')`;
 // Echo is on opening balances 'No opening balances'; Hotel is archived by a Partner; Delta is Paused.
 await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional: client starts trading this year',opening_balance_confirmed_by=${M},opening_balance_confirmed_at=now() where client_id=${names.echo}`;
 await as('PARTNER',()=>tx`select erp_private.client_lifecycle(${names.delta}::uuid,'Pause','Fictional pause for the register test')`);
 await as('PARTNER',()=>tx`select erp_private.client_lifecycle(${h}::uuid,'Archive','Fictional archive for the register test')`);
 const reg=(role,o={})=>as(role,()=>tx`select * from erp_private.client_register(${o.q??''},${o.firm??null}::uuid,${o.sector??null},${o.service??null},${o.archived??false},${o.owner??null}::uuid,${o.kyc??null},${o.tax??null},${o.opening??null},${o.projects??null},${o.days??null}::integer,${o.sort??'name'},${o.limit??25},${o.offset??0})`);
 const nm=async(role,o)=>{const rows=await reg(role,o),back=Object.fromEntries(Object.entries(names).map(([k,v])=>[v,k]));return rows.map(r=>back[r.client_id]);};
 // Default: archived hidden, ordered by name, total counts every match.
 let rows=await reg('MANAGER');assert.equal(rows.length,7);assert.equal(Number(rows[0].total),7);assert.deepEqual(await nm('MANAGER'),['alpha','bravo','charlie','delta','echo','foxtrot','golf']);
 assert.deepEqual(await nm('MANAGER',{archived:true}),['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel']);
 // Paging: totals stay the same, pages do not overlap, limits are clamped.
 assert.deepEqual(await nm('PARTNER',{limit:3,offset:0}),['alpha','bravo','charlie']);assert.deepEqual(await nm('PARTNER',{limit:3,offset:3}),['delta','echo','foxtrot']);assert.deepEqual(await nm('PARTNER',{limit:3,offset:6}),['golf']);
 assert.equal(Number((await reg('PARTNER',{limit:3,offset:3}))[0].total),7);assert.equal((await reg('PARTNER',{limit:1000})).length,7);assert.equal((await reg('PARTNER',{limit:0})).length,1,'limit is at least one');assert.deepEqual(await nm('PARTNER',{offset:50}),[]);
 // Filters.
 assert.deepEqual(await nm('MANAGER',{service:'Paused'}),['delta']);assert.deepEqual(await nm('MANAGER',{service:'Active'}),['alpha','bravo','charlie','echo','foxtrot','golf']);
 assert.deepEqual(await nm('MANAGER',{owner:M2}),['bravo']);assert.deepEqual(await nm('MANAGER',{firm:F2}),['bravo']);assert.deepEqual(await nm('MANAGER',{sector:'Energy'}),['alpha']);
 assert.deepEqual(await nm('MANAGER',{kyc:'complete'}),['alpha']);assert.equal((await nm('MANAGER',{kyc:'outstanding'})).length,6);
 assert.deepEqual(await nm('MANAGER',{tax:'verified'}),['alpha']);assert.equal((await nm('MANAGER',{tax:'unverified'})).length,6);
 assert.deepEqual(await nm('MANAGER',{opening:'done'}),['echo']);assert.ok((await nm('MANAGER',{opening:'pending'})).includes('alpha'));
 assert.deepEqual(await nm('MANAGER',{projects:'some'}),['alpha','bravo']);assert.equal((await nm('MANAGER',{projects:'none'})).length,5);
 assert.deepEqual(await nm('MANAGER',{days:7}),['alpha'],'alpha has an overdue task and one due in 5 days; bravo is 20 days out');assert.deepEqual(await nm('MANAGER',{days:30}),['alpha','bravo']);
 // Search: name, PIN, and a percent sign is matched literally by the server action (here the raw function is called, so check the escaped form).
 assert.deepEqual(await nm('MANAGER',{q:'bravo'}),['bravo']);assert.deepEqual(await nm('MANAGER',{q:'a000000002b'}),['bravo']);assert.deepEqual(await nm('MANAGER',{q:'100\\%'}),['charlie']);assert.deepEqual(await nm('MANAGER',{q:'zzz'}),[]);
 // Sorting and figures.
 assert.deepEqual((await nm('MANAGER',{sort:'deadline'})).slice(0,2),['alpha','bravo'],'earliest deadline first, no deadline last');
 assert.equal((await nm('MANAGER',{sort:'deadline'})).at(-1),'golf');assert.equal((await nm('MANAGER',{sort:'projects'}))[0],'alpha');assert.equal((await nm('MANAGER',{sort:'overdue'}))[0],'alpha');
 const al=(await reg('MANAGER',{q:'alpha'}))[0];assert.deepEqual([al.active_projects,al.open_tasks,al.overdue_tasks,al.kyc_complete,al.tax_verified],[2,3,1,true,true]);
 // Filters combine.
 assert.deepEqual(await nm('MANAGER',{projects:'some',kyc:'outstanding'}),['bravo']);
 // The server action is leader-only and validates its input.
 const act=rd(fx+'client-register-actions.ts');assert.match(act,/Manager or Partner/);
});
