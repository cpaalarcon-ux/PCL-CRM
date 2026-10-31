import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuditUI} from '../staff-audit.mjs';

function setup(category='PARTNER'){
 const called=[];
 const ui=createAuditUI({
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  field:()=>'',select:()=>'',form:()=>'',modal:()=>{},request:async()=>({}),notice:()=>{},shortDate:()=>'',
  empty:message=>`<p>${message}</p>`,render:()=>{},data:()=>({me:{category_code:category}}),
  openClients:()=>called.push('clients'),openProjects:()=>called.push('projects'),createAuditProject:()=>called.push('create')
 });
 return {ui,called};
}

test('empty audit page explains setup and offers a one-click statutory audit project start',()=>{
 const {ui}=setup();const html=ui.render();
 assert.match(html,/Complete the client’s legal details and financial year-end/);
 assert.match(html,/Stage the prior-year opening TB/);
 assert.match(html,/data-audit-create-project/);
 assert.match(html,/Client TB and purchase uploads are working data, not audit evidence/);
});

test('audit project creation shortcut is limited to project editors',()=>{
 assert.match(setup('PARTNER').ui.render(),/data-audit-create-project/);
 assert.doesNotMatch(setup('ASSISTANT').ui.render(),/data-audit-create-project/);
});

test('empty audit shortcuts route users to clients, projects, and the audit project form',async()=>{
 const {ui,called}=setup();
 for(const attribute of ['data-audit-clients','data-audit-projects','data-audit-create-project']){
  await ui.handle({dataset:{},hasAttribute:name=>name===attribute});
 }
 assert.deepEqual(called,['clients','projects','create']);
});
