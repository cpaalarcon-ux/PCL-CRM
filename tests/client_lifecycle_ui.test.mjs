// Build .107b: lifecycle buttons, badges, contact routing and the server wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {lifecycleActions,lifecycleBar,lifecycleBadge,lifecycleForm,routingCard,serviceLabel,isArchived} from '../staff-client-lifecycle.mjs';
import {clientProfile} from '../staff-client-profile.mjs';import {clientCard} from '../staff-client-cards.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mk=over=>({client_id:'c1',company_name:'Fictional Alpha Ltd',kra_pin:'A123456789Z',details_visible:true,record_status:'Existing',service_status:'Active',...over});
test('who sees which lifecycle buttons',()=>{
 assert.deepEqual(lifecycleActions(mk(),'MANAGER'),['Pause','Cancel']);
 assert.deepEqual(lifecycleActions(mk(),'PARTNER'),['Pause','Cancel','Archive']);
 assert.deepEqual(lifecycleActions(mk({service_status:'Paused'}),'MANAGER'),['Resume','Cancel']);
 assert.deepEqual(lifecycleActions(mk({service_status:'Cancelled'}),'MANAGER'),[],'only a Partner reinstates a cancelled client');
 assert.deepEqual(lifecycleActions(mk({service_status:'Cancelled'}),'PARTNER'),['Resume','Archive']);
 assert.deepEqual(lifecycleActions(mk({record_status:'Archived'}),'PARTNER'),['Restore']);
 assert.deepEqual(lifecycleActions(mk({record_status:'Archived'}),'MANAGER'),[]);
 for(const r of ['SUPERVISOR','ASSISTANT','INTERN'])assert.deepEqual(lifecycleActions(mk(),r),[]);
});
test('badge, bar and reason form',()=>{
 assert.equal(serviceLabel(mk()),'');assert.equal(lifecycleBadge(mk(),esc),'');
 assert.equal(serviceLabel(mk({service_status:'Paused'})),'Paused');assert.equal(serviceLabel(mk({record_status:'Archived',service_status:'Cancelled'})),'Archived');assert.ok(isArchived(mk({record_status:'Archived'})));
 const bar=lifecycleBar(mk({service_status:'Paused',lifecycle_reason:'Waiting for the new director',lifecycle_changed_at:'2026-11-09T00:00:00Z',lifecycle_changed_by_name:'Fictional Manager'}),'MANAGER',esc,x=>String(x).slice(0,10));
 assert.match(bar,/Paused\./);assert.match(bar,/Waiting for the new director/);assert.match(bar,/data-client-life="Resume"/);assert.match(bar,/data-client-life="Cancel"/);assert.doesNotMatch(bar,/Archive/);
 assert.match(lifecycleForm('Archive',esc),/minlength="10"/);
});
test('client file and card show the state; non-leaders see no buttons',()=>{
 const data={me:{category_code:'PARTNER'},clients:[mk({service_status:'Paused',lifecycle_reason:'Client asked us to stop'})],projects:[],tasks:[],documents:[],suite:{contacts:[]}};
 const ctx=(over={})=>({category:'PARTNER',data,clientId:'c1',esc,shortDate:x=>String(x).slice(0,10),badge:s=>s,staffName:i=>i,structureLabel:()=>'',leader:true,...over});
 let h=clientProfile(ctx());assert.match(h,/data-lifecycle-badge="Paused"/);assert.match(h,/data-client-life="Resume"/);assert.match(h,/data-client-life="Archive"/);
 h=clientProfile(ctx({leader:false}));assert.doesNotMatch(h,/data-client-life/);
 const card=clientCard({client:data.clients[0],progress:{profileOk:true,missing:[],kycOk:true,kycMissing:[],taxOk:true,activitiesOk:true,openingDone:true},esc,structureLabel:()=>'',leader:true,searchText:'x',detailsVisible:true});
 assert.match(card,/data-lifecycle-badge="Paused"/);
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
 assert.match(rd(fx+'staff-access-control.mjs'),/client_save\|client_lifecycle\|client_routing_/);
 const read=rd(fx+'workspace-read.ts');for(const col of ['c.record_status','c.service_status','c.lifecycle_reason','c.archive_reason','c.doc_request_contact_id','c.report_delivery_contact_id'])assert.ok(read.includes(col),col);
 const pilot=rd('staff-pilot.mjs');assert.match(pilot,/data-client-life|dataset\.clientLife/);assert.match(pilot,/clientShowArchived/);assert.match(pilot,/data-routing-form/);assert.match(pilot,/Show archived/);
 assert.match(rd('staff-pilot-auth.js'),/staff-pilot\.mjs\?v=20261109-cf-v2/);
});
