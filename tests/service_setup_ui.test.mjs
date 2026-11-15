import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const {createServiceSetupUI}=await import('../staff-service-setup.mjs');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mk=cat=>createServiceSetupUI({esc,field:()=>'',select:()=>'',form:()=>'',modal:()=>{},request:async()=>({}),notice:()=>{},shortDate:x=>x,data:()=>({me:{category_code:cat}})});
test('the client-type block names the type, lists evidence, people and licences, and never offers a service',()=>{
 const ui=mk('MANAGER');
 const html=ui.clientTypeBlock({name:'Limited company',controls:'Registration, PIN',restricted:false,evidence:[{key:'KRA_PIN',label:'KRA PIN',requirement:'Required',state:'Missing',issue:'No evidence on the KYC file yet.'}],parties:[{key:'party:Director',label:'Directors',requirement:'Required',state:'Verified'}],licences:[{key:'licence:X',label:'<b>SASRA</b>',state:'Missing',issue:'No current licence on record.'}]});
 assert.match(html,/Limited company/);assert.match(html,/KRA PIN/);assert.match(html,/Directors/);assert.match(html,/Regulator licences/);assert.match(html,/&lt;b&gt;SASRA/);assert.match(html,/Nothing here selects a service/);
 assert.equal(ui.clientTypeBlock(null),'');
 const hidden=ui.clientTypeBlock({name:'Individual',controls:'Identity',restricted:true,evidence:[],parties:[],licences:[]});assert.match(hidden,/kept by Managers and Partners/);
});
test('only reviewers see the Service templates button; the screens are wired with versioned imports',()=>{
 assert.match(mk('MANAGER').button(),/data-svc="templates"/);assert.equal(mk('ASSISTANT').button(),'');assert.equal(mk('INTERN').button(),'');
 assert.match(rd('staff-improvements.mjs'),/staff-service-setup\.mjs\?v=20261115-types-v1/);assert.match(rd('staff-improvements.mjs'),/Set up a service/);assert.match(rd('staff-improvements.mjs'),/templateBlock/);
 assert.match(rd('staff-client-master.mjs'),/templateBlock/);assert.match(rd('staff-workspace-v6.mjs'),/data-svc="templates"/);
 const src=rd('staff-service-setup.mjs');assert.match(src,/engagement_setup_plan/);assert.match(src,/engagement_setup_apply/);assert.match(src,/confirm:true/);assert.match(src,/service_template_approve/);
 assert.match(src,/does not select|never selects|Choose the service yourself|selects a service/);
});
