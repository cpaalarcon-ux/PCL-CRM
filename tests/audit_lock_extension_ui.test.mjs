// Audit build S8.1: the extension of the assembly deadline: the Assembly tab, the clicks, the server checks and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createAssemblyUI,extensionDays,EXTENSION_PRESETS,policyValueText,POLICY_LABELS} from '../staff-audit-assembly.mjs';
import {assemblyAction} from '../supabase/functions/staff-workspace-v12/assembly-actions.ts';
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

const extended=(o={})=>work({lock:{...work().lock,deadline:'2026-06-18',base_deadline:'2026-05-19',extra_days:30,extensions:2,extension_allowed:true,anchor_date:'2026-03-20',days:60},
 policy:[{key:'AUDIT_LOCK_EXTENSION_ALLOWED',value:'true',confirmed:false}],
 extensions:[{extension_id:'e1',seq:1,extra_days:14,old_deadline:'2026-05-19',new_deadline:'2026-06-02',reason:'Client accounts arrived <late> for the file',extended_by_name:'Pat Partner',extended_at:'2026-05-10T08:00:00Z'},
  {extension_id:'e2',seq:2,extra_days:16,old_deadline:'2026-06-02',new_deadline:'2026-06-18',reason:'Group instructions still outstanding',extended_by_name:'Pat Partner',extended_at:'2026-05-30T08:00:00Z'}],...o});

test('days: a preset or a typed number from 1 to 365, nothing else',()=>{
 assert.deepEqual(EXTENSION_PRESETS.map(x=>x[0]),['14','30','other']);
 assert.equal(extensionDays('14',''),14);assert.equal(extensionDays('30','99'),30,'the typed number is ignored unless "different" is chosen');
 assert.equal(extensionDays('other',' 45 '),45);assert.equal(extensionDays('other','365'),365);assert.equal(extensionDays('other','1'),1);
 for(const bad of ['0','366','-3','4.5','abc','','1e2',' ','1000'])assert.equal(extensionDays('other',bad),null,bad);
 assert.equal(extensionDays('other',undefined),null);assert.equal(extensionDays(undefined,undefined),null);
 assert.equal(policyValueText('AUDIT_LOCK_EXTENSION_ALLOWED','true'),'Yes');assert.equal(policyValueText('AUDIT_LOCK_EXTENSION_ALLOWED','false'),'No');
 assert.match(POLICY_LABELS.AUDIT_LOCK_EXTENSION_ALLOWED,/extend the assembly deadline/);
});

test('the screen: the deadline shows its parts, says it is not a statutory date, and only a Partner can extend an unsealed file',()=>{
 const s=snap(extended()),p=ui(partner,s).panel(s.file,s);
 assert.match(p,/Assembly deadline: <b>2026-06-18<\/b> \(60 days after the audit report date, 2026-03-20, plus 30 days added by a Partner\)/);
 assert.match(p,/not a statutory date/);assert.match(p,/financial statements or tax returns are separate/);
 assert.match(p,/data-asm-extend/);assert.match(p,/Extend the assembly deadline/);
 assert.match(p,/Deadline extensions/);assert.match(p,/2026-05-19 → <b>2026-06-02<\/b>/);assert.match(p,/2026-06-02 → <b>2026-06-18<\/b>/);assert.match(p,/Client accounts arrived &lt;late&gt; for the file/);assert.doesNotMatch(p,/arrived <late>/);
 assert.match(p,/A Partner may extend the assembly deadline of a file/);assert.match(p,/Default, not yet confirmed by a Partner/);
 for(const who of [manager,assistant]){const o=ui(who,s).panel(s.file,s);assert.doesNotMatch(o,/data-asm-extend/);assert.match(o,/Deadline extensions/,'everyone who can see the tab sees the log');}
 // Not offered: sealed, archived, no deadline yet, or switched off.
 const sealedS=snap(extended({lock:{...extended().lock,sealed:true,locked:true,locked_by:'Assembly complete'}}));assert.doesNotMatch(ui(partner,sealedS).panel(sealedS.file,sealedS),/data-asm-extend/);
 const arch=snap(extended(),'Archived');assert.doesNotMatch(ui(partner,arch).panel(arch.file,arch),/data-asm-extend/);
 const none=snap(work());assert.doesNotMatch(ui(partner,none).panel(none.file,none),/data-asm-extend/,'no deadline yet');assert.doesNotMatch(ui(partner,none).panel(none.file,none),/Deadline extensions/);
 const off=snap(extended({lock:{...extended().lock,extension_allowed:false}}));assert.doesNotMatch(ui(partner,off).panel(off.file,off),/data-asm-extend/);
 const plain=snap(work({lock:{...work().lock,deadline:'2026-05-19',anchor_date:'2026-03-20',extension_allowed:true}})),pp=ui(partner,plain).panel(plain.file,plain);
 assert.doesNotMatch(pp,/plus \d+ days added/);assert.match(pp,/data-asm-extend/);
});

test('clicking extend: the days and the reason are sent; a bad number never reaches the server',async()=>{
 const s=snap(extended()),u=ui(partner,s);calls.length=0;
 await u.handle(btn({'data-asm-extend':''}),s.file);assert.match(calls.at(-1).modal[0],/extend the assembly deadline/);assert.match(calls.at(-1).modal[1],/2026-06-18/);assert.match(calls.at(-1).modal[1],/does not move any statutory filing date/);
 await calls.at(-1).modal[2](new Map([['preset','30'],['custom',''],['reason','The group audit instructions are still outstanding']]));
 assert.deepEqual(calls.at(-1).request,{action:'audit_lock_extend',audit_file_id:F,days:30,reason:'The group audit instructions are still outstanding'});
 await u.handle(btn({'data-asm-extend':''}),s.file);await calls.at(-1).modal[2](new Map([['preset','other'],['custom','21'],['reason','Client accounts arrived late, so more time is needed']]));
 assert.equal(calls.at(-1).request.days,21);
 const before=calls.filter(c=>c.request).length;
 await u.handle(btn({'data-asm-extend':''}),s.file);
 for(const custom of ['','0','400','x'])await assert.rejects(async()=>calls.at(-1).modal[2](new Map([['preset','other'],['custom',custom],['reason','Client accounts arrived late, so more time is needed']])),/from 1 to 365/);
 assert.equal(calls.filter(c=>c.request).length,before,'nothing was sent');
 await u.handle(btn({'data-asm-policy':'AUDIT_LOCK_EXTENSION_ALLOWED'}),s.file);await calls.at(-1).modal[2](new Map([['value','false'],['note','The firm does not allow extensions']]));
 assert.deepEqual(calls.at(-1).request,{action:'audit_policy_save',key:'AUDIT_LOCK_EXTENSION_ALLOWED',value:'false',note:'The firm does not allow extensions'});
});

test('server: only a Partner extends; days are checked before the database is reached',async()=>{
 const reached=[];const tx=(parts,...v)=>{reached.push(v);return Promise.resolve([{r:{ok:true}}]);};
 const run=(cat,p)=>assemblyAction(tx,{category_code:cat},p);const R='x'.repeat(25);
 for(const cat of ['MANAGER','SUPERVISOR','ASSISTANT','INTERN'])await assert.rejects(run(cat,{action:'audit_lock_extend',audit_file_id:F,days:14,reason:R}),/Only a Partner/);
 for(const days of [0,366,1.5,'abc',null,undefined,-1])await assert.rejects(run('PARTNER',{action:'audit_lock_extend',audit_file_id:F,days,reason:R}),/from 1 to 365/);
 await assert.rejects(run('PARTNER',{action:'audit_lock_extend',audit_file_id:'not-a-uuid',days:14,reason:R}));
 await assert.rejects(run('PARTNER',{action:'audit_lock_extend',audit_file_id:F,days:14,reason:'   '}));
 assert.equal(reached.length,0,'nothing reached the database');
 assert.deepEqual(await run('PARTNER',{action:'audit_lock_extend',audit_file_id:F,days:14,reason:R}),{ok:true});assert.equal(reached.length,1);assert.equal(reached[0][1],14);
 assert.deepEqual(await run('PARTNER',{action:'audit_lock_extend',audit_file_id:F,days:'30',reason:R}),{ok:true},'a number sent as text is accepted when it is a whole number');
});

test('wiring: the setting is accepted by the policy action, the function is granted, and the build moved on',()=>{
 const sasra=rd(fx+'sasra-actions.ts');assert.match(sasra,/POLICY_KEYS=\[[^\]]*'AUDIT_LOCK_EXTENSION_ALLOWED'/);assert.match(sasra,/key==='AUDIT_LOCK_EXTENSION_ALLOWED'\)choice\(value,\['true','false'\]\)/);
 const mig=rd('supabase/migrations/20261109257000_audit_lock_extension.sql');
 assert.match(mig,/GRANT EXECUTE ON FUNCTION erp_private\.audit_lock_extend\(uuid,integer,text\) TO erp_api/);assert.match(mig,/REVOKE ALL ON FUNCTION erp_private\.audit_lock_extension_immutable\(\) FROM PUBLIC,anon,authenticated,service_role,erp_api/);
 assert.match(mig,/ENABLE ROW LEVEL SECURITY/);assert.match(mig,/FORCE ROW LEVEL SECURITY/);assert.match(mig,/no_delete BEFORE DELETE ON erp_private\.audit_lock_extensions/);
 assert.match(mig,/INSERT INTO erp_private\.system_settings\(key,value,note\) VALUES\s*\('AUDIT_LOCK_EXTENSION_ALLOWED','true'/,'the default is yes, and it is inserted without a confirming Partner (no updated_by)');
 const act=rd(fx+'assembly-actions.ts');assert.match(act,/'audit_lock_extend'\]\.includes\(act\)/);
 assert.match(rd('staff-audit.mjs'),/createAssemblyUI/);
});
