import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {templateFor,evidenceRequirements,templateChecklist}=await import('../supabase/functions/staff-workspace-v12/client-template-rules.mjs');
const {occurrences,dueOn,planTasks,periodProblem,taskKey,MAX_TASKS}=await import('../supabase/functions/staff-workspace-v12/engagement-setup-rules.mjs');
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const map=[{structure:'Individual',subtype:'*',template_code:'INDIVIDUAL'},{structure:'Other',subtype:'Trust',template_code:'NONPROFIT'},{structure:'Co-operative Society',subtype:'*',template_code:'COOPERATIVE'},{structure:'Co-operative Society',subtype:'Special',template_code:'COMPANY'}];
test('a legal structure maps to a template; a named subtype wins; no row means no template',()=>{
 assert.equal(templateFor('Individual','Sole Proprietor',map),'INDIVIDUAL');assert.equal(templateFor('Other','Trust',map),'NONPROFIT');assert.equal(templateFor('Other','Estate',map),null);
 assert.equal(templateFor('Public Entity','County Government',map),null);assert.equal(templateFor(null,null,map),null);assert.equal(templateFor('Co-operative Society','Special',map),'COMPANY');assert.equal(templateFor('Co-operative Society','SACCO',map),'COOPERATIVE');
});
test('evidence requirements: a named subtype overrides the structure default per rule',()=>{
 const rows=[{subtype:'*',rule_code:'A',requirement:'Required',sort_order:1},{subtype:'*',rule_code:'B',requirement:'If applicable',sort_order:2},{subtype:'X',rule_code:'B',requirement:'Required',sort_order:2}];
 assert.deepEqual(evidenceRequirements('X',rows).map(r=>[r.rule_code,r.requirement]),[['A','Required'],['B','Required']]);assert.deepEqual(evidenceRequirements('Y',rows).map(r=>[r.rule_code,r.requirement]),[['A','Required'],['B','If applicable']]);
});
const fields=[{field_key:'company_name',requirement:'Required'},{field_key:'authority_basis',requirement:'Required'},{field_key:'business_name',requirement:'If applicable'}];
const fact=(k,status)=>({field_key:k,value:'x y z w',status,source_kind:'Document',recorded_by:'r',fact_id:k,revision:1});
test('nothing is confirmed unless it is verified: facts, evidence on a verified KYC file, people, licences',()=>{
 const base={template:'COMPANY',fields,facts:[fact('company_name','Verified'),fact('authority_basis','Recorded')],master:{},requirements:[{rule_code:'KRA_PIN',requirement:'Required'},{rule_code:'BANK_MANDATE',requirement:'If applicable'}],ruleLabels:{KRA_PIN:'KRA PIN'},evidence:[{document_type:'KRA_PIN'}],kycVerified:false,parties:[{role:'Shareholder',shareholding_percentage:60}],partyRules:[{role:'Director',min_count:1,requirement:'Required',label:'Directors'},{role:'Shareholder',min_count:1,requirement:'Required',label:'Shareholders'}],licenceExpectations:[{type_code:'SACCO_LICENCE',label:'SASRA licence'}],licences:[],on:'2026-11-15'};
 const c=templateChecklist(base);
 assert.equal(c.ready,false);assert.equal(c.facts_ready,false);
 assert.equal(c.evidence[0].state,'Recorded');assert.match(c.evidence[0].issue,/not been verified/);
 assert.equal(c.parties.find(p=>p.key==='party:Director').state,'Missing');assert.equal(c.parties.find(p=>p.key==='party:Shareholder').state,'Differs');assert.match(c.parties.find(p=>p.key==='party:Shareholder').issue,/60%/);
 assert.equal(c.licences[0].state,'Missing');assert.ok(c.exceptions.some(e=>e.key==='licence:SACCO_LICENCE'));
 assert.ok(c.facts.some(r=>r.key==='business_name'&&r.optional));
 const ok=templateChecklist({...base,facts:[fact('company_name','Verified'),fact('authority_basis','Verified')],kycVerified:true,parties:[{role:'Director'},{role:'Shareholder',shareholding_percentage:100}],licenceExpectations:[],evidence:[{document_type:'KRA_PIN'}]});
 assert.equal(ok.ready,true);assert.equal(ok.exceptions.length,0);assert.equal(ok.evidence[0].state,'Verified');
 const expired=templateChecklist({...base,evidence:[{document_type:'KRA_PIN',expires_on:'2026-01-01'}],kycVerified:true});assert.equal(expired.evidence[0].state,'Missing');
 const hidden=templateChecklist({...base,restricted:true});assert.equal(hidden.restricted,true);assert.equal(hidden.ready,false);assert.ok(hidden.evidence.every(e=>e.state==='Not visible'));
 const none=templateChecklist({...base,template:null});assert.equal(none.ready,false);assert.match(none.exceptions[0].label,/Legal entity type/);
});
test('recurring tasks are laid out inside the period, never past it',()=>{
 assert.equal(occurrences('Monthly','2026-01-01','2026-03-31').length,3);assert.equal(occurrences('Quarterly','2026-01-01','2026-12-31').length,4);assert.deepEqual(occurrences('Annual','2026-01-01','2026-06-30'),[{start:'2026-01-01',end:'2026-06-30'}]);
 assert.deepEqual(occurrences('Once','2026-01-01','2026-03-31'),[{start:'2026-01-01',end:'2026-03-31'}]);assert.deepEqual(occurrences('Monthly','2026-03-01','2026-02-01'),[]);
 const feb=occurrences('Monthly','2028-01-31','2028-03-31');assert.deepEqual(feb.map(o=>o.start),['2028-01-31','2028-02-29','2028-03-31']);
 assert.equal(dueOn('Period end',5,{start:'2026-01-01',end:'2026-01-31'}),'2026-02-05');assert.equal(dueOn('Start',30,{start:'2026-01-01',end:'2026-12-31'}),'2026-01-31');
 assert.equal(periodProblem('2026-01-01','2026-12-31'),null);assert.match(periodProblem('2026-01-01','2029-01-01'),/two years/);assert.match(periodProblem('x','y'),/Choose/);
 assert.equal(taskKey('TAX-MONTHLY',2,'sales','2026-01-01'),'tpl:TAX-MONTHLY:v2:sales:2026-01-01');
});
const tasks=[{task_key:'a',task_name:'A',recurrence:'Monthly',due_basis:'Period end',due_days:5,owner_role:'RESPONSIBLE',mandatory:true,sort_order:1},{task_key:'b',task_name:'B',recurrence:'Once',due_basis:'Start',due_days:1,owner_role:'REVIEWER',mandatory:false,requires_obligation:'VAT',sort_order:2},{task_key:'c',task_name:'C',recurrence:'Once',due_basis:'Start',due_days:1,owner_role:'RESPONSIBLE',mandatory:true,requires_licence:'EPRA',sort_order:3},{task_key:'d',task_name:'D',recurrence:'Once',due_basis:'Start',due_days:1,owner_role:'RESPONSIBLE',mandatory:true,requires_client_template:['NONPROFIT'],sort_order:4}];
test('only tasks whose conditions the confirmed profile meets are created; the rest say why; the client type alone selects nothing',()=>{
 const period={start:'2026-01-01',end:'2026-02-28'};
 const none=planTasks({tasks,period,facts:{obligations:new Set(),licences:new Set(),clientTemplate:'COMPANY'},actorCategory:'MANAGER'});
 assert.deepEqual(none.create.map(c=>c.task_key),['a','a']);assert.deepEqual(none.skipped.map(s=>s.task_key),['b','c','d']);assert.match(none.skipped[0].reason,/does not show VAT/);assert.match(none.skipped[1].reason,/EPRA/);assert.match(none.skipped[2].reason,/different type/);
 const all=planTasks({tasks,period,facts:{obligations:new Set(['VAT']),licences:new Set(['EPRA']),clientTemplate:'NONPROFIT'},actorCategory:'MANAGER'});assert.equal(all.create.length,5);assert.equal(all.skipped.length,0);
 // No tasks exist without a template and a chosen service: the client types hold no task or service at all.
 const sql=rd('supabase/migrations/20261115130000_client_and_service_templates.sql');
 assert.doesNotMatch(sql.match(/CREATE TABLE erp_private\.client_type_templates[\s\S]*?\);/)[0],/service|task/i);assert.doesNotMatch(sql.match(/CREATE TABLE erp_private\.client_template_fields[\s\S]*?\);/)[0],/service_code|task/i);
});
test('dropping tasks: an optional one freely; a required one only by a Manager or Partner with a reason; unknown keys are refused',()=>{
 const f={obligations:new Set(),licences:new Set(),clientTemplate:null},period={start:'2026-01-01',end:'2026-01-31'};
 assert.equal(planTasks({tasks,period,facts:{...f,obligations:new Set(['VAT'])},exclusions:[{task_key:'b'}],actorCategory:'SUPERVISOR'}).problems.length,0);
 assert.match(planTasks({tasks,period,facts:f,exclusions:[{task_key:'a',reason:'client closed'}],actorCategory:'SUPERVISOR'}).problems[0],/Only a Manager or Partner/);
 assert.match(planTasks({tasks,period,facts:f,exclusions:[{task_key:'a',reason:'x'}],actorCategory:'MANAGER'}).problems[0],/Say why/);
 const ok=planTasks({tasks,period,facts:f,exclusions:[{task_key:'a',reason:'Client closed the branch'}],actorCategory:'PARTNER'});assert.equal(ok.problems.length,0);assert.equal(ok.skipped[0].kind,'Dropped');assert.equal(ok.skipped[0].mandatory,true);
 assert.match(planTasks({tasks,period,facts:f,exclusions:[{task_key:'zzz',reason:'none'}],actorCategory:'MANAGER'}).problems[0],/no task "zzz"/);
 const big=planTasks({tasks:[{...tasks[0],recurrence:'Monthly'}],period:{start:'2026-01-01',end:'2027-12-31'},facts:f,actorCategory:'MANAGER'});assert.equal(big.create.length,24);assert.ok(MAX_TASKS>=24);
});
test('server and screens are wired',()=>{
 const idx=rd('supabase/functions/staff-workspace-v12/index.ts');assert.match(idx,/serviceTemplateAction/);
 const ac=rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs');assert.match(ac,/service_template_/);assert.match(ac,/client_template_/);
 const sql=rd('supabase/migrations/20261115130000_client_and_service_templates.sql');assert.match(sql,/UNIQUE\(client_id,service_code,period_start,period_end\)/);assert.match(sql,/service_templates_one_approved_uidx/);
});
