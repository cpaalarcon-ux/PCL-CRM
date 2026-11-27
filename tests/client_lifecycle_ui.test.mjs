// Build .107b: lifecycle buttons, badges, contact routing and the server wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {lifecycleActions,lifecycleBar,lifecycleBadge,lifecycleForm,routingCard,serviceLabel,isArchived,clientStatus,heldWorkHtml} from '../staff-client-lifecycle.mjs';
import {clientProfile} from '../staff-client-profile.mjs';import {clientCard} from '../staff-client-cards.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mk=over=>({client_id:'c1',company_name:'Fictional Alpha Ltd',kra_pin:'A123456789Z',details_visible:true,record_status:'Existing',service_status:'Active',...over});
test('who may move a client to which status',()=>{
 assert.deepEqual(lifecycleActions(mk(),'MANAGER'),['Inactive']);
 assert.deepEqual(lifecycleActions(mk(),'PARTNER'),['Inactive','Dormant']);
 assert.deepEqual(lifecycleActions(mk({service_status:'Paused'}),'MANAGER'),['Active']);
 assert.deepEqual(lifecycleActions(mk({service_status:'Paused'}),'PARTNER'),['Active','Dormant']);
 assert.deepEqual(lifecycleActions(mk({record_status:'Archived'}),'PARTNER'),['Active'],'only a Partner brings a Dormant client back');
 assert.deepEqual(lifecycleActions(mk({record_status:'Archived'}),'MANAGER'),[]);
 for(const r of ['SUPERVISOR','ASSISTANT','INTERN'])assert.deepEqual(lifecycleActions(mk(),r),[]);
});
test('badge, bar and reason form',()=>{
 assert.equal(clientStatus(mk()),'Active');assert.equal(serviceLabel(mk()),'');assert.equal(lifecycleBadge(mk(),esc),'');
 assert.equal(serviceLabel(mk({service_status:'Paused'})),'Inactive');assert.equal(serviceLabel(mk({service_status:'Cancelled'})),'Inactive','an old cancelled record reads as Inactive');
 assert.equal(serviceLabel(mk({record_status:'Archived',service_status:'Paused'})),'Dormant');assert.ok(isArchived(mk({record_status:'Archived'})));
 assert.equal(clientStatus(mk({client_status:'Dormant'})),'Dormant','the server value wins');
 const bar=lifecycleBar(mk({service_status:'Paused',lifecycle_reason:'Waiting for the new director',lifecycle_changed_at:'2026-11-09T00:00:00Z',lifecycle_changed_by_name:'Fictional Manager'}),'MANAGER',esc,x=>String(x).slice(0,10));
 assert.match(bar,/Inactive\./);assert.match(bar,/Waiting for the new director/);assert.match(bar,/on hold/);assert.match(bar,/data-client-status="Active"/);assert.doesNotMatch(bar,/data-client-status="Dormant"/);assert.match(bar,/data-client-held="c1"/);
 assert.doesNotMatch(lifecycleBar(mk(),'ASSISTANT',esc,String),/data-client-held|data-client-status/);
 assert.match(lifecycleForm('Dormant',esc),/minlength="10"/);assert.match(lifecycleForm('Dormant',esc),/has left/);assert.match(lifecycleForm('Inactive',esc),/put on hold/);
 // A Dormant client coming back needs the choice about the earlier work; an Inactive one does not.
 assert.match(lifecycleForm('Active',esc,'Dormant'),/name="old_work" value="Resume" required/);assert.match(lifecycleForm('Active',esc,'Dormant'),/value="Leave archived"/);
 assert.doesNotMatch(lifecycleForm('Active',esc,'Inactive'),/old_work/);
 const held=heldWorkHtml({status:'Active',projects:[],tasks:[{task_name:'File <VAT>',status:'In Progress',client_hold:'Archived'}],to_redate:[{task_name:'PAYE',due_at:'2026-10-09',assigned_name:'Fictional'}],history:[{from_status:'Dormant',to_status:'Active',reason:'Came back',old_work:'Left archived',projects:1,tasks:2,changed_at:'2026-11-27',changed_by:'Fictional Partner'}]},esc,x=>String(x).slice(0,10));
 assert.match(held,/File &lt;VAT&gt;/);assert.match(held,/Left archived/);assert.match(held,/Tasks needing a new date \(1\)/);assert.match(held,/Dormant to Active/);assert.match(held,/1 project, 2 tasks/);
});
test('client file and card show the state; non-leaders see no buttons',()=>{
 const data={me:{category_code:'PARTNER'},clients:[mk({service_status:'Paused',lifecycle_reason:'Client asked us to stop'})],projects:[],tasks:[],documents:[],suite:{contacts:[]}};
 const ctx=(over={})=>({category:'PARTNER',data,clientId:'c1',esc,shortDate:x=>String(x).slice(0,10),badge:s=>s,staffName:i=>i,structureLabel:()=>'',leader:true,...over});
 let h=clientProfile(ctx());assert.match(h,/data-lifecycle-badge="Inactive"/);assert.match(h,/data-client-status="Active"/);assert.match(h,/data-client-status="Dormant"/);
 h=clientProfile(ctx({leader:false}));assert.doesNotMatch(h,/data-client-status/);
 const card=clientCard({client:data.clients[0],progress:{profileOk:true,missing:[],kycOk:true,kycMissing:[],taxOk:true,activitiesOk:true,openingDone:true},esc,structureLabel:()=>'',leader:true,searchText:'x',detailsVisible:true});
 assert.match(card,/data-lifecycle-badge="Inactive"/);
});
test('contact routing card',()=>{
 const contacts=[{contact_id:'k1',client_id:'c1',full_name:'Wanjiru Kamau',email_address:'w@example.com'},{contact_id:'k2',client_id:'c1',full_name:'Otieno'},{contact_id:'k9',client_id:'c2',full_name:'Other client contact'}];
 const c=mk({doc_request_contact_id:'k1'});
 let h=routingCard(c,contacts,true,esc);assert.match(h,/data-routing-form="c1"/);assert.match(h,/<option value="k1" selected>/);assert.doesNotMatch(h,/Other client contact/);assert.match(h,/Document requests go to <b>Wanjiru Kamau<\/b>/);assert.match(h,/Reports go to <b>no one chosen<\/b>/);
 h=routingCard(c,contacts,false,esc);assert.doesNotMatch(h,/<form/);assert.match(h,/Wanjiru Kamau/);
 assert.match(routingCard(c,[],true,esc),/Add a contact first/);
});
test('server and page wiring',()=>{
 const fx='supabase/functions/staff-workspace-v12/';
 const act=rd(fx+'client-lifecycle-actions.ts');assert.match(act,/client_lifecycle\(/);assert.match(act,/client_routing_save\(/);assert.match(act,/at least 10 characters/);
 assert.match(rd(fx+'index.ts'),/clientLifecycleAction\(tx,a,p\)/);
 assert.match(rd(fx+'staff-access-control.mjs'),/client_save\|(?:onboarding_batch_\|onboarding_template_\|)?client_lifecycle\|(?:client_status_set\|client_held_work\|)?client_routing_/);
 const read=rd(fx+'workspace-read.ts');for(const col of ['c.record_status','c.service_status','c.lifecycle_reason','c.archive_reason','c.doc_request_contact_id','c.report_delivery_contact_id'])assert.ok(read.includes(col),col);
 const pilot=rd('staff-pilot.mjs');assert.match(pilot,/dataset\.clientStatus/);assert.match(pilot,/client_status_set/);assert.match(pilot,/client_held_work/);assert.match(pilot,/data-routing-form/);const reg=rd('staff-client-register.mjs');assert.match(reg,/Client status/);for(const t of ['Active and Inactive','Inactive','Dormant archive'])assert.ok(reg.includes(t),t);assert.doesNotMatch(reg,/Cancelled|Show archived/);
 assert.match(act,/client_status_set\(/);assert.match(act,/Leave archived/);assert.match(rd(fx+'staff-access-control.mjs'),/client_status_set\|client_held_work/);
 assert.match(rd('staff-pilot-auth.js'),/staff-pilot\.mjs\?v=\d{8}-/);
});
