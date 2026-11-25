// Client team screen: people by role, an owner per workstream, a project override, reasons for ending, and read-only for people who cannot edit.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<!doctype html><body><dialog id="editor"><div id="editorBody"></div></dialog></body>');
for(const key of ['window','document'])globalThis[key]=dom.window[key];
const {createClientTeamUI}=await import('../staff-client-team.mjs');
const cid='00000000-0000-4000-8000-000000000003',pid='00000000-0000-4000-8000-000000000004';
const P={asst:'00000000-0000-4000-8000-0000000000a1',mgr:'00000000-0000-4000-8000-0000000000a2',mlro:'00000000-0000-4000-8000-0000000000a3',sup:'00000000-0000-4000-8000-0000000000a4'};
const candidates=[{staff_id:P.asst,full_name:'Fictional Assistant',category_code:'ASSISTANT',is_mlro:false},{staff_id:P.mgr,full_name:'Fictional Manager',category_code:'MANAGER',is_mlro:false},{staff_id:P.mlro,full_name:'Fictional Partner',category_code:'PARTNER',is_mlro:true},{staff_id:P.sup,full_name:'Fictional Supervisor',category_code:'SUPERVISOR',is_mlro:false}];
const workstreams=[{code:'SALES',label:'Sales',covers:'Weekly sales upload'},{code:'PAYROLL',label:'Payroll',covers:'Payroll'}];
let members=[],canEdit=true,seq=0;const sent=[];
const handler=async p=>{sent.push(p);
 if(p.action==='client_team_read')return {client:{client_id:cid,company_name:'Fictional Client'},members,projects:[{project_id:pid,project_name:'Fictional 2026',status:'Open'}],workstreams,candidates:canEdit?candidates:[],holders:canEdit?[{staff_id:P.asst,staff_name:'Fictional Assistant',workstream:'SALES',tasks:3}]:[],can_edit:canEdit,note:'Named people are the defaults.'};
 if(p.action==='client_team_add'){const c=candidates.find(x=>x.staff_id===p.staff_id);members.push({team_member_id:'t'+(++seq),project_id:p.project_id||null,project_name:null,staff_id:p.staff_id,staff_name:c.full_name,category_code:c.category_code,role:p.role,workstream:p.workstream||null,assigned_at:'2026-11-24T07:00:00Z'});return {ok:true,staff_name:c.full_name};}
 if(p.action==='client_team_handover')return {ok:true,preview:p.preview===true,moving:3,staying:0,groups:[{staff_id:P.sup,staff_name:'Fictional Supervisor',tasks:3}]};
 if(p.action==='client_team_end'){members=members.filter(m=>m.team_member_id!==p.team_member_id);return {ok:true,open_tasks:2};}
 throw new Error('unexpected '+p.action);};
const notices=[];
const ui=createClientTeamUI({$:s=>document.querySelector(s),esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),shortDate:v=>String(v).slice(0,10),
 modal:(title,html)=>{document.querySelector('#editorBody').innerHTML=html;document.querySelector('#editorBody').dataset.title=title;},request:handler,notice:(m)=>notices.push(m)});
const body=()=>document.querySelector('#editorBody'),pause=(ms=20)=>new Promise(r=>setTimeout(r,ms));
const pick=async(key,staff)=>{const s=body().querySelector(`[data-team-person="${key}"]`);assert.ok(s,'missing picker '+key);s.value=staff;};
const press=async sel=>{const b=body().querySelector(sel);assert.ok(b,'missing '+sel);b.click();await pause();};
test('two preparers, two MLROs and a different owner per workstream can be named',async()=>{
 await ui.open(cid);
 assert.match(body().textContent,/Fictional Client/);
 for(const w of ['Sales','Payroll'])assert.match(body().textContent,new RegExp(w));
 // Preparers: any of the four. Reviewers: no Assistant. MLRO: only people who hold the right.
 const options=key=>[...body().querySelectorAll(`[data-team-person="${key}"] option`)].map(o=>o.value).filter(Boolean);
 assert.equal(options('PREPARER').length,4);
 assert.ok(!options('REVIEWER').includes(P.asst),'an Assistant cannot review');
 assert.deepEqual(options('MLRO'),[P.mlro],'only someone who holds the MLRO right is offered');
 await pick('PREPARER',P.asst);await press('[data-team="add"][data-role="PREPARER"]');
 await pick('PREPARER',P.sup);await press('[data-team="add"][data-role="PREPARER"]');
 await pick('MLRO',P.mlro);await press('[data-team="add"][data-role="MLRO"]');
 await pick('WORKSTREAM_OWNER:SALES',P.asst);await press('[data-team="add"][data-workstream="SALES"]');
 await pick('WORKSTREAM_OWNER:PAYROLL',P.mgr);await press('[data-team="add"][data-workstream="PAYROLL"]');
 const adds=sent.filter(p=>p.action==='client_team_add');
 assert.equal(adds.length,5);assert.deepEqual(adds.map(a=>a.role),['PREPARER','PREPARER','MLRO','WORKSTREAM_OWNER','WORKSTREAM_OWNER']);
 assert.equal(adds[3].workstream,'SALES');assert.equal(adds[4].workstream,'PAYROLL');assert.ok(adds.every(a=>!a.project_id),'client defaults carry no project');
 assert.match(body().textContent,/Fictional Assistant/);assert.match(body().textContent,/Fictional Supervisor/);
 assert.ok(!options('PREPARER').includes(P.asst),'a person already named is not offered again for that role');
 assert.match(document.querySelector('#teamNotice').textContent,/added/);
 // Separation of duties on the screen: someone who prepares is not offered as reviewer or MLRO.
 assert.ok(!options('REVIEWER').includes(P.sup),'a named preparer is not offered as reviewer');
 assert.ok(!options('MLRO').includes(P.mlro),'a named MLRO is not offered again');
});
test('ending someone needs a reason; the project override replaces the client owner for that project only',async()=>{
 await press('[data-team="end"]');
 assert.match(document.querySelector('#teamNotice').textContent,/at least 5 characters/);
 assert.equal(sent.some(p=>p.action==='client_team_end'),false,'nothing was sent without a reason');
 body().querySelector('[name="teamReason"]').value='Moved to another client';await press('[data-team="end"]');
 const ended=sent.find(p=>p.action==='client_team_end');assert.equal(ended.reason,'Moved to another client');assert.equal(ended.client_id,cid);
 // Project scope.
 const sel=body().querySelector('[name="teamScope"]');sel.value=pid;sel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause();
 assert.match(body().textContent,/Client default: Fictional Assistant/,'the client owner shows as the default until the project names its own');
 assert.match(body().textContent,/MLROs are named for the whole client/);
 assert.equal(body().querySelector('[data-team="add"][data-role="MLRO"]'),null,'no MLRO control on a project');
 await pick('WORKSTREAM_OWNER:SALES',P.mgr);await press('[data-team="add"][data-workstream="SALES"]');
 const add=sent.filter(p=>p.action==='client_team_add').pop();assert.equal(add.project_id,pid);assert.equal(add.workstream,'SALES');
 assert.doesNotMatch(body().textContent,/Client default: Fictional Assistant/,'the project owner replaces the default in view');
});
test('hand over open tasks: the count is shown first, a reason is needed, then they move',async()=>{
 await ui.open(cid);
 const sel=n=>body().querySelector(`[name="${n}"]`);
 assert.match(body().textContent,/Hand over open tasks/);assert.match(sel('hoFrom').textContent,/Fictional Assistant · 3 not started/);
 assert.equal(body().querySelector('[data-team="ho-apply"]').disabled,true,'nothing can move before the count has been shown');
 await press('[data-team="ho-preview"]');assert.match(document.querySelector('#hoResult').textContent,/Choose whose tasks/);
 sel('hoFrom').value=P.asst;sel('hoWs').value='SALES';
 await press('[data-team="ho-preview"]');
 const pv=sent.filter(p=>p.action==='client_team_handover').pop();assert.equal(pv.preview,true);assert.equal(pv.from_staff_id,P.asst);assert.equal(pv.workstream,'SALES');assert.equal(pv.to_staff_id,undefined,'no person chosen means whoever is free');
 assert.match(document.querySelector('#hoResult').textContent,/3 tasks will move: Fictional Supervisor 3/);
 assert.equal(body().querySelector('[data-team="ho-apply"]').disabled,false);
 await press('[data-team="ho-apply"]');assert.match(document.querySelector('#teamNotice').textContent,/at least 10 characters/);
 const before=sent.filter(p=>p.action==='client_team_handover'&&p.preview===false).length;assert.equal(before,0,'nothing moved without a reason');
 sel('hoReason').value='On leave from 1 December';await press('[data-team="ho-apply"]');
 const ap=sent.filter(p=>p.action==='client_team_handover'&&p.preview===false).pop();assert.equal(ap.reason,'On leave from 1 December');
 assert.match(document.querySelector('#teamNotice').textContent,/3 tasks moved/);
});
test('ending someone says how many not-started tasks are still with them',async()=>{
 members=[{team_member_id:'z1',project_id:null,project_name:null,staff_id:P.asst,staff_name:'Fictional Assistant',category_code:'ASSISTANT',role:'PREPARER',workstream:null,assigned_at:'2026-11-24T07:00:00Z'}];
 await ui.open(cid);body().querySelector('[name="teamReason"]').value='Moved to another client';await press('[data-team="end"]');
 assert.match(document.querySelector('#teamNotice').textContent,/2 tasks not started are still with this person/);
});
test('a person who cannot edit sees the team but no controls',async()=>{
 members=[{team_member_id:'z2',project_id:null,project_name:null,staff_id:P.asst,staff_name:'Fictional Assistant',category_code:'ASSISTANT',role:'PREPARER',workstream:null,assigned_at:'2026-11-24T07:00:00Z'}];
 canEdit=false;await ui.open(cid);
 assert.match(body().textContent,/Only a Manager or Partner can change the team/);
 assert.equal(body().querySelector('[data-team]'),null);assert.equal(body().querySelector('select[data-team-person]'),null);
 assert.match(body().textContent,/Fictional Assistant/);
});
test('the Set-up tab and the project menu open it',async t=>{t.after(()=>dom.window.close());
 const imp=await readFile(new URL('../staff-improvements.mjs',import.meta.url),'utf8'),v6=await readFile(new URL('../staff-workspace-v6.mjs',import.meta.url),'utf8'),pilot=await readFile(new URL('../staff-pilot.mjs',import.meta.url),'utf8');
 assert.match(await readFile(new URL('../staff-setup-checklist.mjs',import.meta.url),'utf8'),/\['team','Client team'\]/);assert.match(imp,/if\(a==='team'\)\{await team\.open\(id,b\.dataset\.project\|\|''\)/);
 assert.match(v6,/data-v3=\\"team\\"|data-v3="team"/);assert.match(v6,/Project team/);
 assert.match(v6,/client_team_defaults/);assert.match(v6,/teamDefaults\(client,firm\)/);assert.match(v6,/projectTeamHint/);
 assert.match(imp,/staff-client-team\.mjs\?v=20261212-team-v2/);assert.match(pilot,/team=20261212-v2/);
});
