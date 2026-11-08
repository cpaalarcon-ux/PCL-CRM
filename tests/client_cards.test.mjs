import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientProgress,nextStep,clientStatus,stateCounts,clientCard,chipRow} from '../staff-client-cards.mjs';

const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const structureLabel=c=>[c.legal_structure,c.legal_subtype].filter(Boolean).join(' · ');
const client={client_id:'c1',company_name:'UAT Fictional Geisha',kra_pin:'P051556782R',legal_structure:'Limited Company',legal_subtype:'Private',primary_sector:'Wholesale & Retail',branch_location:'Kisii'};
const ready={activity_count:1,stock_method_count:1,category_count:1,approved_account_count:20};
const base=over=>clientProgress({client,missing:[],compliance:{verified_at:'2026-11-01'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready,stagedTB:false,...over});

test('next step follows the set-up guide order and never skips a gate',()=>{
 assert.equal(nextStep(base({missing:['Financial year-end']})).key,'profile');
 assert.equal(nextStep(base({compliance:null})).key,'kyc');
 assert.match(nextStep(base({compliance:null,contacts:[]})).detail,/KYC verification, a contact/);
 assert.equal(nextStep(base({taxProfiles:[{client_id:'c1',status:'Draft'}]})).key,'tax');
 assert.equal(nextStep(base({taxProfiles:[{client_id:'other',status:'Verified'}]})).key,'tax','another client’s verified profile does not count');
 assert.equal(nextStep(base({readiness:undefined})).key,'loading');
 assert.equal(nextStep(base({readiness:{...ready,stock_method_count:0}})).key,'activities');
 assert.equal(nextStep(base()).key,'tb-stage');
 assert.equal(nextStep(base({stagedTB:true})).key,'tb-post');
 const done=clientProgress({client:{...client,has_opening_balance:true},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
 assert.equal(nextStep(done).key,'ready');
 const none=clientProgress({client:{...client,opening_balance_status:'No opening balances'},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
 assert.equal(nextStep(none).key,'ready','confirmed “no opening balances” also resolves the opening step');
});

test('a missing KRA PIN is a KYC gap',()=>{
 const p=clientProgress({client:{...client,kra_pin:''},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[],readiness:ready});
 assert.deepEqual(p.kycMissing,['KRA PIN']);assert.equal(p.kycOk,false);
});

test('status badge: Active only when everything is done; opening TB steps read as pending',()=>{
 assert.equal(clientStatus(base(),nextStep(base())).label,'Opening TB pending');
 assert.equal(clientStatus(base({compliance:null}),nextStep(base({compliance:null}))).label,'Onboarding');
 const done=clientProgress({client:{...client,has_opening_balance:true},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
 assert.equal(clientStatus(done,nextStep(done)).label,'Active');
});

test('manager card shows the three pills, one next step and both footer buttons',()=>{
 const p=base({readiness:{...ready,stock_method_count:0}});
 const html=clientCard({client,progress:p,esc,structureLabel,leader:true,searchText:'uat fictional geisha',detailsVisible:true});
 assert.match(html,/data-suite="compliance"[^>]*class="cc-pill ok"/);
 assert.match(html,/data-suite="tax-profile"[^>]*class="cc-pill ok"/);
 assert.match(html,/class="cc-pill warn" data-v3="client" data-id="c1"/);
 assert.equal((html.match(/class="cc-next /g)||[]).length,1);
 assert.match(html,/Finish activities and mappings/);
 assert.match(html,/data-client-accounts="c1">Client accounts/);assert.match(html,/data-setup-guide="c1">Continue setup/);assert.match(html,/data-client="c1">View details/);
 assert.match(html,/data-search="uat fictional geisha"/);assert.match(html,/data-state="onboarding"/);
 assert.doesNotMatch(html,/general mappings active|Opening TB setup required|Profile fields complete/,'the old paragraph text is gone');
});

test('KYC and tax next-step buttons open the right screen',()=>{
 assert.match(clientCard({client,progress:base({compliance:null}),esc,structureLabel,leader:true,searchText:'',detailsVisible:true}),/data-suite="compliance"[^>]*class="cc-next red"/);
 assert.match(clientCard({client,progress:base({taxProfiles:[]}),esc,structureLabel,leader:true,searchText:'',detailsVisible:true}),/data-suite="tax-profile"[^>]*class="cc-next amber"/);
});

test('non-leader card is light: no pills, no set-up status, role actions only',()=>{
 const html=clientCard({client,progress:base(),esc,structureLabel,leader:false,lightActions:'<button data-propose="client">Propose</button>',searchText:'x',detailsVisible:true});
 assert.doesNotMatch(html,/cc-pill|cc-next|data-setup-guide|Continue setup/);
 assert.match(html,/data-client-view="c1"/);assert.match(html,/data-propose="client"/);
 const hidden=clientCard({client,progress:base(),esc,structureLabel,leader:false,searchText:'x',detailsVisible:false});
 assert.match(hidden,/Assigned work needed to open the client file/);assert.doesNotMatch(hidden,/P051556782R/,'PIN stays hidden until work is assigned');
});

test('names are escaped',()=>{
 const html=clientCard({client:{...client,company_name:'<img src=x onerror=alert(1)>'},progress:base(),esc,structureLabel,leader:true,searchText:'',detailsVisible:true});
 assert.doesNotMatch(html,/<img src=x/);
});

test('chips count and mark the current filter',()=>{
 const counts=stateCounts([{status:{state:'ready'}},{status:{state:'onboarding'}},{status:{state:'onboarding'}}]);
 assert.deepEqual(counts,{all:3,action:2,onboarding:2,ready:1});
 const row=chipRow(counts,'action',esc);
 assert.match(row,/class="cc-chip on" data-client-state="action"/);assert.match(row,/Ready for work<em>1<\/em>/);
});

test('the Clients screen uses the card grid and keeps search, structure and state filtering',()=>{
 const pilot=readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),css=readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(pilot,/from '\.\/staff-client-cards\.mjs\?v=/);
 assert.match(pilot,/<div class="client-grid">\$\{body\}<\/div>/);
 assert.doesNotMatch(pilot,/<th>Purchase mapping setup<\/th>/);
 assert.match(pilot,/stateHidden/);assert.match(pilot,/repaintClientCards/);
 assert.match(css,/\.client-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,380px\),1fr\)\)/);
});
