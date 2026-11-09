// Audit build S8: the Assembly & milestones screen, the compare view, the server validators, the home model and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createAssemblyUI,compareView,lockState,policyValueText,anchorText,MANUAL_KINDS,POLICY_LABELS} from '../staff-audit-assembly.mjs';
import {assemblyAction,MILESTONE_KINDS} from '../supabase/functions/staff-workspace-v12/assembly-actions.ts';
import {homeModel,sectionTabs,SECTIONS} from '../staff-audit-home.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const F='44444444-4444-4444-8444-444444444444',A='55555555-5555-4555-8555-555555555555',B='66666666-6666-4666-8666-666666666666';
const ms=(seq,kind,label,o={})=>({milestone_id:o.id||`m${seq}`,seq,kind,label,note:o.note||'',file_status:o.st||'Prepared',fingerprint:'abcdef012345',taken_at:'2026-03-01T10:00:00Z',taken_by_name:'Mo Manager'});
const work=(o={})=>({lock:{sealed:false,amendment_open:false,enforced:false,not_enforced_because:'The deadline lock is switched off.',deadline:null,anchor:'REPORT_DATE',anchor_date:null,days:60,past_deadline:false,locked:false,locked_by:null},
 seal:null,seal_check:null,archive_issues:['A Partner has not recorded that assembly of the file is complete.'],
 policy:[{key:'AUDIT_DEADLINE_LOCK_ENFORCED',value:'false',confirmed:false},{key:'AUDIT_FILE_LOCK_ANCHOR',value:'REPORT_DATE',confirmed:false},{key:'AUDIT_FILE_LOCK_DAYS',value:'60',confirmed:true,confirmed_by_name:'Pat Partner'}],
 milestones:[ms(1,'Planning complete','Planning <done>'),ms(2,'Approved','File approved',{note:'Taken automatically.'})],amendments:[],...o});
const sealed=(o={})=>work({lock:{sealed:true,amendment_open:false,enforced:false,not_enforced_because:'x',deadline:'2026-05-19',anchor:'REPORT_DATE',anchor_date:'2026-03-20',days:60,past_deadline:false,locked:true,locked_by:'Assembly complete'},
 seal:{sealed_by_name:'Pat Partner',sealed_at:'2026-03-25T08:00:00Z',note:'Checked the file is complete'},seal_check:{same:true,changed:[]},archive_issues:[],...o});
const open=()=>sealed({lock:{...sealed().lock,locked:false,amendment_open:true,locked_by:null},seal_check:{same:false,changed:['Risks']},archive_issues:['A late change is still open and has not been reviewed.'],
 amendments:[{amendment_id:A,seq:1,reason:'Add a missing risk <after> assembly',status:'Open',opened_by:'s-p',opened_by_name:'Pat Partner',opened_at:'2026-04-01T08:00:00Z'}]});
const snap=(w,st='Completion')=>({file:{audit_file_id:F,project_id:'pr',file_status:st,ends_on:'2025-12-31'},assembly:w});
const calls=[];
const ui=(me,s)=>createAssemblyUI({esc,field:(n,l,v)=>`<input name="${n}" value="${esc(v)}">`,select:(n,l,o)=>`<select name="${n}">${(o||[]).map(x=>`<option>${Array.isArray(x)?x[0]:x}</option>`).join('')}</select>`,form:x=>x,modal:(...a)=>{calls.push({modal:a});},request:async a=>{calls.push({request:a});return {ok:true,components:[],same:true,a:{label:'a'},b:{label:'b'}};},notice:(m,bad)=>calls.push({notice:m,bad}),shortDate:v=>String(v||'').slice(0,10),data:()=>({me}),snapshot:()=>s,refresh:async()=>{}});
const btn=attrs=>({dataset:Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),hasAttribute:n=>n in attrs});
const partner={category_code:'PARTNER',staff_id:'s-p'},partner2={category_code:'PARTNER',staff_id:'s-p2'},manager={category_code:'MANAGER',staff_id:'s-m'},assistant={category_code:'ASSISTANT',staff_id:'s-a'};

test('helpers: lock state, policy text, and the lists the screen and server share',()=>{
 assert.deepEqual(lockState(work()),{label:'Open for work',tone:''});assert.equal(lockState(sealed()).label,'Locked: assembly complete');assert.equal(lockState(open()).label,'Late change open');
 assert.equal(lockState(work({lock:{...work().lock,locked:true,locked_by:'Assembly deadline'}})).label,'Locked: deadline passed');assert.equal(lockState(null).label,'Unknown');
 assert.equal(policyValueText('AUDIT_FILE_LOCK_DAYS','60'),'60 days');assert.equal(policyValueText('AUDIT_DEADLINE_LOCK_ENFORCED','true'),'On');assert.equal(anchorText('YEAR_END'),'the financial year end');
 assert.deepEqual(MANUAL_KINDS,MILESTONE_KINDS);assert.equal(Object.keys(POLICY_LABELS).length,3);
});

test('an unsealed file in completion: a Partner can record assembly; nobody else can; nothing says locked',()=>{
 const s=snap(work()),p=ui(partner,s).panel(s.file,s);
 assert.match(p,/data-asm-seal/);assert.match(p,/Open for work/);assert.doesNotMatch(p,/data-asm-amend-open/);assert.match(p,/What stops the file being archived/);assert.match(p,/Planning &lt;done&gt;/);
 assert.match(p,/The deadline lock is not in force: The deadline lock is switched off/);assert.match(p,/Default, not yet confirmed by a Partner/);assert.match(p,/Confirmed by Pat Partner/);assert.match(p,/data-asm-policy="AUDIT_DEADLINE_LOCK_ENFORCED"/);
 const m=ui(manager,s).panel(s.file,s);assert.doesNotMatch(m,/data-asm-seal|data-asm-policy/);assert.match(m,/data-asm-milestone-new/);
 const a=ui(assistant,s).panel(s.file,s);assert.doesNotMatch(a,/data-asm-milestone-new|data-asm-seal/);assert.match(a,/data-asm-compare/,'anyone allowed to see the file can compare');
 const early=snap(work(),'Prepared');assert.doesNotMatch(ui(partner,early).panel(early.file,early),/data-asm-seal/,'only once the file is in completion');assert.match(ui(partner,early).panel(early.file,early),/must be in completion first/);
});

test('a sealed file: locked, the seal check, and the late-change buttons by role',()=>{
 const s=snap(sealed()),p=ui(partner,s).panel(s.file,s);
 assert.match(p,/Locked: assembly complete/);assert.match(p,/Nothing on the file has changed since assembly/);assert.match(p,/data-asm-amend-open/);assert.doesNotMatch(p,/data-asm-seal/);assert.doesNotMatch(p,/What stops the file being archived/);
 assert.doesNotMatch(ui(manager,s).panel(s.file,s),/data-asm-amend-open/,'only a Partner opens a late change');
 const d=snap(sealed({seal_check:{same:false,changed:['Risks','Reports']}})),dp=ui(partner,d).panel(d.file,d);assert.match(dp,/differs from the way it was/);assert.match(dp,/<li>Risks<\/li><li>Reports<\/li>/);
 const arch=snap(sealed(),'Archived');assert.doesNotMatch(ui(partner,arch).panel(arch.file,arch),/data-asm-amend-open/,'an archived file is not reopened');
});

test('a late change: the opener cannot close it; another Manager or Partner can; text is escaped',()=>{
 const s=snap(open());
 const op=ui(partner,s).panel(s.file,s);assert.match(op,/Late change 1 is open/);assert.match(op,/Add a missing risk &lt;after&gt; assembly/);assert.doesNotMatch(op,/data-asm-amend-close/);assert.doesNotMatch(op,/Add a missing risk <after>/);
 assert.match(ui(manager,s).panel(s.file,s),/data-asm-amend-close/);assert.match(ui(partner2,s).panel(s.file,s),/data-asm-amend-close/);assert.doesNotMatch(ui(assistant,s).panel(s.file,s),/data-asm-amend-close/);
 assert.match(op,/A late change is still open/);
 const closed=snap(sealed({amendments:[{amendment_id:A,seq:1,reason:'Add a missing risk after assembly',status:'Closed',opened_by:'s-p',opened_by_name:'Pat Partner',opened_at:'2026-04-01',closed_by_name:'Mo <Manager>',closed_at:'2026-04-02',close_note:'Reviewed the added risk',changes:[{key:'risks',title:'Risks',before:1,after:2,added:['R-002'],removed:[],edited:[],n_added:1,n_removed:0,n_edited:0}]}]}));
 const cp=ui(partner,closed).panel(closed.file,closed);assert.match(cp,/Mo &lt;Manager&gt;/);assert.match(cp,/<b>Risks<\/b>: 1 → 2 · added R-002/);
});

test('compare view lists only what changed and says so when nothing did',()=>{
 const html=compareView({a:{label:'Planning <x>',taken_at:'2026-03-01T00:00:00Z'},b:{label:'The file as it is now'},same:false,components:[
  {key:'risks',title:'Risks',changed:true,before:1,after:3,added:['R-002','R-003'],removed:[],edited:['R-001'],n_added:2,n_removed:0,n_edited:1},
  {key:'workpapers',title:'Working papers',changed:false,before:2,after:2,added:[],removed:[],edited:[],n_added:0,n_removed:0,n_edited:0},
  {key:'tb_lines',title:'Trial balance lines',changed:true,before:10,after:11,added:[],removed:[],edited:[],n_added:0,n_removed:0,n_edited:0}]});
 assert.match(html,/Planning &lt;x&gt;/);assert.match(html,/Added \(2\)<\/b>: R-002, R-003/);assert.match(html,/Changed \(1\)<\/b>: R-001/);assert.doesNotMatch(html,/Working papers/);assert.match(html,/not itemised for this part/);
 assert.match(compareView({a:{label:'a'},b:{label:'b'},same:true,components:[]}),/Nothing on the file differs/);assert.equal(compareView(null),'');
 const many=compareView({a:{label:'a'},b:{label:'b'},same:false,components:[{key:'risks',title:'Risks',changed:true,before:0,after:40,added:Array.from({length:30},(_,i)=>'R'+i),removed:[],edited:[],n_added:40,n_removed:0,n_edited:0}]});assert.match(many,/Added \(40\)/);assert.match(many,/, …/);
});

test('clicks send the right requests',async()=>{
 const s=snap(sealed()),u=ui(partner,s);calls.length=0;
 await u.handle(btn({'data-asm-seal':''}),s.file);assert.match(calls.at(-1).modal[0],/record that assembly is complete/);
 await calls.at(-1).modal[2](new Map([['note','Checked everything']]));assert.deepEqual(calls.at(-1).request,{action:'audit_assembly_seal',audit_file_id:F,note:'Checked everything'});
 await u.handle(btn({'data-asm-amend-open':''}),s.file);await calls.at(-1).modal[2](new Map([['reason','Add a missing risk after assembly']]));assert.deepEqual(calls.at(-1).request,{action:'audit_amend_open',audit_file_id:F,reason:'Add a missing risk after assembly'});
 await u.handle(btn({'data-asm-amend-close':''}),s.file);await calls.at(-1).modal[2](new Map([['note','Reviewed the added risk and agreed']]));assert.deepEqual(calls.at(-1).request,{action:'audit_amend_close',audit_file_id:F,note:'Reviewed the added risk and agreed'});
 await u.handle(btn({'data-asm-milestone-new':''}),s.file);await calls.at(-1).modal[2](new Map([['kind','Fieldwork complete'],['label','Fieldwork done'],['note','']]));assert.deepEqual(calls.at(-1).request,{action:'audit_assembly_milestone_take',audit_file_id:F,kind:'Fieldwork complete',label:'Fieldwork done',note:''});
 await u.handle(btn({'data-asm-policy':'AUDIT_FILE_LOCK_DAYS'}),s.file);await calls.at(-1).modal[2](new Map([['value','45'],['note','Agreed with the Partners']]));assert.deepEqual(calls.at(-1).request,{action:'audit_policy_save',key:'AUDIT_FILE_LOCK_DAYS',value:'45',note:'Agreed with the Partners'});
 // compare reads the two selects
 const els={'#asmA':{value:'m1'},'#asmB':{value:''}};globalThis.document={querySelector:q=>els[q]||null};
 calls.length=0;await u.handle(btn({'data-asm-compare':''}),s.file);assert.deepEqual(calls[0].request,{action:'audit_assembly_compare',audit_file_id:F,a:'m1',b:null});assert.equal(calls[1].modal[0],'What changed');
 els['#asmB'].value='m2';calls.length=0;await u.handle(btn({'data-asm-compare':''}),s.file);assert.equal(calls[0].request.b,'m2');
 els['#asmA'].value='';calls.length=0;await u.handle(btn({'data-asm-compare':''}),s.file);assert.equal(calls[0].bad,true,'no milestone chosen');
 delete globalThis.document;
 assert.equal(await u.handle(btn({'data-other':''}),s.file),false);
 assert.equal(await ui(partner,{file:s.file,assembly:null}).handle(btn({'data-asm-seal':''}),s.file),false);
});

test('server validators: roles, kinds and unknown actions',async()=>{
 const reached=[];const tx=(parts,...v)=>{reached.push(v);return Promise.resolve([{r:{ok:true}}]);};
 const run=(cat,p)=>assemblyAction(tx,{category_code:cat},p);
 assert.equal(await run('PARTNER',{action:'audit_other'}),undefined);
 await assert.rejects(run('ASSISTANT',{action:'audit_assembly_milestone_take',audit_file_id:F,kind:'Other',label:'x'}),/Manager or Partner/);
 await assert.rejects(run('MANAGER',{action:'audit_assembly_milestone_take',audit_file_id:F,kind:'Approved',label:'Not by hand'}));
 await assert.rejects(run('MANAGER',{action:'audit_assembly_seal',audit_file_id:F,note:'x'.repeat(12)}),/Partner/);
 await assert.rejects(run('MANAGER',{action:'audit_amend_open',audit_file_id:F,reason:'x'.repeat(25)}),/Partner/);
 await assert.rejects(run('ASSISTANT',{action:'audit_amend_close',audit_file_id:F,note:'x'.repeat(25)}),/Manager or Partner/);
 await assert.rejects(run('PARTNER',{action:'audit_assembly_seal',audit_file_id:'not-a-uuid',note:'x'.repeat(12)}));
 await assert.rejects(run('PARTNER',{action:'audit_assembly_compare',audit_file_id:F}),/./,'a milestone to compare from is needed');
 assert.equal(reached.length,0,'nothing reached the database');
 assert.deepEqual(await run('PARTNER',{action:'audit_assembly_compare',audit_file_id:F,a:A,b:B}),{ok:true});assert.deepEqual(await run('PARTNER',{action:'audit_assembly_compare',audit_file_id:F,a:A}),{ok:true});
 assert.deepEqual(await run('PARTNER',{action:'audit_assembly_seal',audit_file_id:F,note:'Checked the file is complete'}),{ok:true});
});

test('home model: tab, archive items, the late-change block and the next step',()=>{
 const archive=SECTIONS.find(x=>x.key==='archive');assert.ok(archive.tabs.includes('Assembly & milestones'));assert.ok(sectionTabs('archive',false).includes('Assembly & milestones'),'shown for every audit file');
 const base=st=>({file:{audit_file_id:F,file_status:st,reporting_framework:'IFRS for SMEs'},readiness:{framework_approved:true},workpapers:[],reports:[],report_status:[]});
 let m=homeModel({...base('Completion'),assembly:work()},partner);
 assert.ok(m.sections.find(x=>x.key==='archive').items.some(i=>i.key==='assembly'&&i.state==='todo'));
 assert.ok(m.focus.rows.some(r=>r.text==='Record that assembly is complete'));
 m=homeModel({...base('Completion'),assembly:sealed()},partner);assert.ok(m.sections.find(x=>x.key==='archive').items.some(i=>i.key==='assembly'&&i.state==='done'));
 m=homeModel({...base('Completion'),assembly:open()},partner);
 assert.ok(m.blockers.some(b=>b.kind==='amendment'&&b.tab==='Assembly & milestones'));assert.equal(m.next.kind,'amendment','a late change waiting for review is the first thing to do');assert.ok(!m.focus.rows.some(r=>/late change/.test(r.text)),'the opener has nothing to review');
 m=homeModel({...base('Completion'),assembly:open()},manager);assert.ok(m.focus.rows.some(r=>r.text==='Review and close the late change'));
 m=homeModel({...base('Completion'),assembly:open()},partner2);assert.ok(m.focus.rows.some(r=>r.text==='Review and close the late change'));
 m=homeModel({...base('Prepared'),assembly:null},partner);assert.ok(!m.blockers.some(b=>b.kind==='amendment'));assert.equal(m.sections.find(x=>x.key==='archive').items.some(i=>i.key==='assembly'),false);
});

test('wiring: migration, server, snapshot, tabs and cache busters',()=>{
 const mig=rd('supabase/migrations/20261109256000_audit_assembly_lock.sql');
 assert.match(mig,/CREATE TRIGGER milestone_auto AFTER UPDATE OF file_status ON erp_private\.audit_files/);assert.match(mig,/CREATE TRIGGER archive_gate BEFORE UPDATE OF file_status ON erp_private\.audit_files/);
 assert.match(mig,/'AUDIT_DEADLINE_LOCK_ENFORCED','false'/,'the deadline lock is off by default');
 assert.doesNotMatch(mig,/\b\d+\s+(years|months)\b/i,'no retention period in years or months');
 const act=rd(fx+'audit-actions.ts');
 assert.match(act,/assemblyAction\(tx,a,p\)/);assert.match(act,/assemblyWorkspace\(tx,file\.audit_file_id\)/);assert.match(act,/return \{sasra,sacco,pack,assembly,populations/);assert.match(act,/if\(!file\)return \{sacco:null,pack:null,assembly:null/);
 assert.match(rd(fx+'sasra-actions.ts'),/'AUDIT_DEADLINE_LOCK_ENFORCED'\]/);
 const aud=rd('staff-audit.mjs');
 assert.match(aud,/import \{createAssemblyUI\} from '\.\/staff-audit-assembly\.mjs\?v=/);assert.match(aud,/activeTab==='Assembly & milestones'\?assembly\.panel\(file,s\)/);assert.match(aud,/await assembly\.handle\(b,selectedFile\(\)\)/);
 const busters=new Set([...aud.matchAll(/staff-audit-(?:pack|sacco|assembly)\.mjs\?v=([\w-]+)/g)].map(x=>x[1]));assert.equal(busters.size,1,[...busters].join());
});
