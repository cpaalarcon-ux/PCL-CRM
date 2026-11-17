import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {cleanValue,sourceProblem,requiredFor,readiness,canVerify,canRecord,setupReport,elapsedMinutes}=await import('../supabase/functions/staff-workspace-v12/client-master-rules.mjs');
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const fact=(k,v,x={})=>({fact_id:k,field_key:k,value:v,source_kind:'Document',status:'Verified',recorded_by:'a',...x});
test('values are checked and cleaned only by trimming',()=>{
 assert.equal(cleanValue('kra_pin',' a000000001z ').value,'A000000001Z');assert.equal(cleanValue('kra_pin','12345').ok,false);
 assert.equal(cleanValue('year_end','12-31').ok,true);assert.equal(cleanValue('year_end','31-12').ok,false);
 assert.equal(cleanValue('incorporation_date','2020-02-29').ok,true);assert.equal(cleanValue('incorporation_date','29/02/2020').ok,false);
 assert.equal(cleanValue('contact_phone','+254 700 000 001').ok,true);assert.equal(cleanValue('colour','x').ok,false);assert.equal(cleanValue('contact_person','   ').ok,false);
});
test('the source must be something a reviewer can open or look up',()=>{
 assert.ok(sourceProblem({source_kind:'Document'}));assert.equal(sourceProblem({source_kind:'Document',document_id:'d'}),null);
 assert.ok(sourceProblem({source_kind:'Online register'}));assert.equal(sourceProblem({source_kind:'Import',source_reference:'clients.xlsx row 4'}),null);
 assert.equal(sourceProblem({source_kind:'Client statement'}),null);assert.ok(sourceProblem({source_kind:'Telepathy'}));
});
test('required facts depend on the entity type; a sole proprietor needs an ID, not a registration number',()=>{
 const co=requiredFor('Limited company').map(f=>f.key),sp=requiredFor('Sole proprietor').map(f=>f.key);
 assert.ok(co.includes('registration_number')&&co.includes('incorporation_date')&&!co.includes('national_id'));
 assert.ok(sp.includes('national_id')&&!sp.includes('registration_number')&&!sp.includes('incorporation_date'));
});
test('readiness lists exceptions only: missing, waiting, statement-only and differing facts',()=>{
 const facts=[fact('company_name','Acme Ltd'),fact('kra_pin','A000000001Z',{status:'Recorded',source_kind:'Client statement'}),fact('registration_number','C1',{status:'Recorded'}),fact('year_end','12-31',{status:'Superseded'})];
 const r=readiness({entityType:'Limited company',facts,master:{company_name:'Acme Ltd',kra_pin:'A000000001Z'}});
 assert.equal(r.verified,1);assert.equal(r.ready,false);
 assert.match(r.exceptions.find(e=>e.key==='kra_pin').issue,/Only the client's own statement/);
 assert.match(r.exceptions.find(e=>e.key==='registration_number').issue,/different Supervisor/);
 assert.equal(r.exceptions.find(e=>e.key==='year_end').state,'Missing','a superseded fact does not count');
 const d=readiness({entityType:'Limited company',facts:[fact('company_name','Acme Ltd')],master:{company_name:'Acme Limited'}});
 assert.equal(d.rows[0].state,'Differs');assert.match(d.rows[0].issue,/client record says "Acme Limited"/);
 const unk=readiness({entityType:null,facts:[fact('company_name','Acme Ltd'),fact('registration_number','C1')],master:{}});assert.equal(unk.ready,false);assert.equal(unk.exceptions[0].key,'legal_entity_type');assert.ok(unk.rows.find(r=>r.key==='registration_number').extra);assert.equal(unk.required,7);
 const all=readiness({entityType:'Sole proprietor',facts:requiredFor('Sole proprietor').map(f=>fact(f.key,'v')),master:{}});assert.equal(all.ready,true);assert.equal(all.percent,100);
});
test('who may verify and record',()=>{
 const f={status:'Recorded',recorded_by:'a',source_kind:'Document'};
 assert.equal(canVerify(f,{staff_id:'b',category_code:'SUPERVISOR'}),true);assert.equal(canVerify(f,{staff_id:'a',category_code:'MANAGER'}),false);
 assert.equal(canVerify(f,{staff_id:'b',category_code:'ASSISTANT'}),false);assert.equal(canVerify({...f,source_kind:'Client statement'},{staff_id:'b',category_code:'PARTNER'}),false);
 assert.equal(canVerify({...f,status:'Verified'},{staff_id:'b',category_code:'PARTNER'}),false);
 assert.equal(canRecord({category_code:'ASSISTANT'}),true);assert.equal(canRecord({category_code:'INTERN'}),false);
});
test('set-up report averages elapsed minutes and compares with a baseline',()=>{
 assert.equal(elapsedMinutes('2026-11-15T08:00:00Z','2026-11-15T09:30:00Z'),90);assert.equal(elapsedMinutes('2026-11-15T09:00:00Z','2026-11-15T08:00:00Z'),null);
 const s=setupReport([{started_at:'2026-11-15T08:00:00Z',ready_at:'2026-11-15T08:30:00Z'},{started_at:'2026-11-15T08:00:00Z',ready_at:'2026-11-15T09:30:00Z'},{started_at:'2026-11-15T08:00:00Z',ready_at:null}],120);
 assert.equal(s.clients_started,3);assert.equal(s.clients_ready,2);assert.equal(s.average_minutes,60);assert.equal(s.reduction_percent,50);
 assert.equal(setupReport([],'').average_minutes,null);assert.equal(setupReport([],'').reduction_percent,null);
});
test('screens and server are wired',()=>{
 assert.match(rd('staff-improvements.mjs'),/staff-client-master\.mjs\?v=20261121-scope-v1/);assert.match(rd('staff-improvements.mjs'),/Client master facts/);
 assert.match(rd('staff-pilot.mjs'),/staff-improvements\.mjs\?v=20261121-comply-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/clientMasterAction/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/client_master_/);
 const ui=rd('staff-client-master.mjs');assert.match(ui,/client_master_verify/);assert.match(ui,/Set-up time report/);
});
