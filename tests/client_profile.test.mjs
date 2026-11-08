// Build .107: client profile page with six tabs, opened from the client card and by link.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clientProfile,PROFILE_TABS} from '../staff-client-profile.mjs';import {workspaceRoute} from '../staff-task-workspace.mjs';import {clientCard} from '../staff-client-cards.mjs';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const base={me:{category_code:'MANAGER'},clients:[{client_id:'c1',company_name:'Fictional Alpha Ltd',kra_pin:'A123456789Z',primary_sector:'Retail',branch_location:'Nairobi',legal_structure:'Company',details_visible:true,owner_staff_id:'s1'},{client_id:'c2',company_name:'Fictional Beta',details_visible:false}],
 projects:[{project_id:'p1',client_id:'c1',project_name:'Fictional tax compliance',status:'Active'},{project_id:'p2',client_id:'c2',project_name:'Other client project'}],
 tasks:[{task_id:'t1',project_id:'p1',task_name:'VAT return Nov',status:'In Progress',due_at:'2026-11-20T00:00:00Z',assigned_to:'s1'},{task_id:'t2',project_id:'p2',task_name:'Other client task',status:'Pending'},{task_id:'t3',project_id:'p1',task_name:'Old task',status:'Completed'}],
 documents:[{document_id:'d1',client_id:'c1',file_name:'cert.pdf',category:'KYC',uploaded_at:'2026-11-01T00:00:00Z'},{document_id:'d2',client_id:'c2',file_name:'secret.pdf'}],
 suite:{contacts:[{client_id:'c1',full_name:'Wanjiru Kamau',job_title:'MD',role_in_decision:'Decision Maker',email_address:'w@example.com',phone_number:'+254700000201'}],compliance:[{client_id:'c1',verified_at:'2026-11-05T00:00:00Z'}],kyc_evidence:[{client_id:'c1',document_type:'Certificate of Incorporation',evidence_form:'Physical document sighted',covered_items:['Registration / identity']}],
  communications:[{client_id:'c1',communication_date:'2026-11-06',channel:'Call',subject:'Asked for bank statements'},{client_id:'c1',communication_date:'2026-11-07',channel:'Internal note',subject:'Chase Friday'},{client_id:'c2',communication_date:'2026-11-07',channel:'Call',subject:'Other client call'}],
  kyc_changes:[{client_id:'c1',recorded_at:'2026-11-04T00:00:00Z',change_reason:'Updated director list'}],tax_profiles:[{client_id:'c1',status:'Verified',effective_from:'2026-01-01',effective_to:null,entity_type:'Company',regime:'Standard'}]}};
const ctx=(over={})=>({data:base,clientId:'c1',esc,shortDate:x=>String(x).slice(0,10),badge:s=>`<span class="badge">${esc(s)}</span>`,staffName:id=>'Fictional '+id,structureLabel:c=>c.legal_structure||'',leader:true,...over});
test('six tabs, Overview first, and each tab shows only this client’s records',()=>{
 assert.deepEqual(PROFILE_TABS.map(x=>x[1]),['Overview','Contacts','Projects & Tasks','Documents / KYC','Communication & Activity','Tax Obligations']);
 let h=clientProfile(ctx());for(const [,l] of PROFILE_TABS)assert.match(h,new RegExp('>'+l.replace(/&/g,'&amp;')+'<'));assert.match(h,/A123456789Z/);assert.match(h,/aria-selected="true"[^>]*data-cprofile-tab="overview"/);
 h=clientProfile(ctx({tab:'contacts'}));assert.match(h,/Wanjiru Kamau/);assert.match(h,/data-suite="compliance"/);
 h=clientProfile(ctx({tab:'projects'}));assert.match(h,/Fictional tax compliance/);assert.match(h,/VAT return Nov/);assert.doesNotMatch(h,/Other client/);assert.doesNotMatch(h,/Old task/,'completed tasks are not listed as open');assert.match(h,/data-open-project="p1"/);assert.match(h,/data-open-task="t1"/);
 h=clientProfile(ctx({tab:'documents'}));assert.match(h,/KYC verified/);assert.match(h,/Certificate of Incorporation/);assert.match(h,/cert\.pdf/);assert.doesNotMatch(h,/secret\.pdf/);
 h=clientProfile(ctx({tab:'activity'}));assert.match(h,/Asked for bank statements/);assert.match(h,/Updated director list/);assert.doesNotMatch(h,/Other client call/);assert.ok(h.indexOf('Chase Friday')<h.indexOf('Asked for bank statements'),'newest first');assert.match(h,/Internal/);
 h=clientProfile(ctx({tab:'tax'}));assert.match(h,/Verified/);assert.match(h,/data-suite="tax-profile"/);
});
test('rights stay as they were: non-leaders get no edit buttons, hidden client details stay hidden, unknown clients are refused',()=>{
 const h=clientProfile(ctx({leader:false,tab:'contacts'}));assert.doesNotMatch(h,/data-suite=/);
 assert.doesNotMatch(clientProfile(ctx({leader:false})),/data-client=|data-setup-guide/);
 const hid=clientProfile(ctx({clientId:'c2'}));assert.match(hid,/Client details open once work/);assert.doesNotMatch(hid,/Not recorded/);
 assert.match(clientProfile(ctx({clientId:'nope'})),/Client unavailable/);
});
test('the route, the card link and the page wiring open the profile',()=>{
 assert.deepEqual(workspaceRoute('#client=c1'),{view:'clientfile',id:'c1'});
 const card=clientCard({client:base.clients[0],progress:{profileOk:true,missing:[],kycOk:true,kycMissing:[],taxOk:true,activitiesOk:true,openingDone:true},esc,structureLabel:c=>c.legal_structure,leader:true,searchText:'x',detailsVisible:true});
 assert.match(card,/data-client-open="c1"/);
 const app=fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8');
 assert.match(app,/clientfile:renderClientProfile/);assert.match(app,/navigateWorkspace\('clientfile'/);assert.match(app,/data-cprofile-tab|dataset\.cprofileTab/);
});
