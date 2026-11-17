// Build 2848: client set-up and returns live in the client file. The Set-up tab and the Tax & returns tab host the screens that used to sit
// behind the card menu item "Entity and activities". Layout and names only: no approval, posting or tax rule changes.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clientProfile,PROFILE_TABS} from '../staff-client-profile.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const data={me:{category_code:'MANAGER'},clients:[{client_id:'c1',company_name:'Fictional Alpha Ltd',kra_pin:'A123456789Z',details_visible:true}],projects:[],tasks:[],documents:[],firms:[],suite:{contacts:[],compliance:[],tax_profiles:[]}};
const ctx=(over={})=>({data,clientId:'c1',esc,shortDate:x=>String(x).slice(0,10),badge:s=>esc(s),staffName:id=>id,structureLabel:()=>'',leader:true,...over});

test('seven tabs; Set-up sits after Projects & Tasks and Tax Obligations is now Tax & returns',()=>{
 assert.deepEqual(PROFILE_TABS.map(x=>x[0]),['overview','contacts','projects','setup','documents','activity','tax','aml','understanding']);
 assert.equal(PROFILE_TABS.find(x=>x[0]==='setup')[1],'Set-up');assert.equal(PROFILE_TABS.find(x=>x[0]==='tax')[1],'Tax & returns');
});

test('a Manager or Partner gets the Set-up tab, with a host the page fills from the existing client read',()=>{
 const h=clientProfile(ctx({tab:'setup'}));
 assert.match(h,/data-cprofile-tab="setup"/);assert.match(h,/aria-selected="true"[^>]*data-cprofile-tab="setup"/);
 assert.match(h,/<div id="clientTabHost" class="section-space" data-tab="setup" data-id="c1">/);
 assert.match(h,/legal identity, activities, chart of accounts, VAT categories, reporting periods and stock/);
});

test('anyone else does not see the Set-up tab, and cannot land on it',()=>{
 const h=clientProfile(ctx({leader:false,tab:'setup',data:{...data,me:{category_code:'ASSISTANT'}}}));
 assert.doesNotMatch(h,/data-cprofile-tab="setup"/);assert.doesNotMatch(h,/clientTabHost/);assert.match(h,/aria-selected="true"[^>]*data-cprofile-tab="overview"/);
 const t=clientProfile(ctx({leader:false,tab:'tax',data:{...data,me:{category_code:'ASSISTANT'}}}));
 assert.doesNotMatch(t,/data-v3="returns"|data-v3="exceptions"|routing-map-open|clientTabHost/,'no set-up controls and no host for staff who cannot use them');
});

test('Tax & returns: tax profile, payroll returns, tax rule exceptions and the routing map, then the verified obligations',()=>{
 const h=clientProfile(ctx({tab:'tax'}));
 for(const [attr,label] of [['data-suite="tax-profile"','Open tax profile'],['data-v3="returns"','Payroll returns'],['data-v3="exceptions"','Tax rule exceptions'],['data-suite="routing-map-open"','Routing map']])assert.match(h,new RegExp(attr.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' data-id="c1"[^>]*>'+label+'<'),label);
 assert.match(h,/data-tab="tax" data-id="c1"/);
});

test('the old long window is split in two and every entry point lands in the file',()=>{
 const imp=rd('staff-improvements.mjs');
 const i=imp.indexOf('function clientParts('),j=imp.indexOf('async function paintClientTab');const body=imp.slice(i,j);
 const set=body.slice(body.indexOf('setup:`'),body.indexOf(',tax:`')),tax=body.slice(body.indexOf(',tax:`'));
 assert.match(tax,/Active tax obligations/);assert.doesNotMatch(set,/Active tax obligations/);
 for(const t of ['Activities','Current dependency map','Setup changes waiting for review','Verified reporting periods','Stock settings history'])assert.match(set,new RegExp('<h3>'+t+'</h3>'),t);
 for(const b of ["'activity'","'chart'","'vat-cats'","'period'","'identity'","'setup-review'"])assert.match(set,new RegExp('button\\('+b),b);
 assert.doesNotMatch(set,/Payroll returns|Tax rule exceptions|routing-map-open/,'these moved to Tax & returns');
 assert.match(imp,/async function client\(id,options=\{\}\)\{if\(options\.stockSetup\)\{await loadClient\(id\);policy\(options\);return;\}openFile\(id,'setup'\);\}/);
 assert.match(imp,/b\.dataset\.clientOpen=id;b\.dataset\.clientTab=tab/);assert.match(imp,/return \{client,project,bank,chart,paintClientTab\}/);
 assert.match(imp,/\['identity','vat-cats','activity','period','partners','stock-policy'\]\.includes\(a\)&&clientData\?\.client\?\.client_id!==id\)await loadClient\(id\)/,'a button in the tab always works on this client');
 assert.match(imp,/now\.dataset\.tab!==tab\|\|now\.dataset\.id!==id\)return/,'a slow answer for a tab the person has left is dropped');
});

test('the page paints the host after every render of the tab, for Managers and Partners only, and shows a failure in place',()=>{
 const p=rd('staff-pilot.mjs');
 assert.match(p,/if\(view==='clientfile'&&\(\(isLeader\(\)&&\['setup','tax'\]\.includes\(clientTab\)\)\|\|\['aml','understanding'\]\.includes\(clientTab\)\)\)void improvements\.paintClientTab\(clientTab,selectedClient\)\.catch\(/);
 assert.match(p,/staff-improvements\.mjs\?v=20261121-wiz-v1/);
});

test('names: the card menu says Set-up and opens the tab; the old seven-name window title is gone',()=>{
 const c=rd('staff-client-cards.mjs');assert.match(c,/data-client-open="\$\{id\}" data-client-tab="setup"`,'Set-up'\]/);assert.doesNotMatch(c,/Entity and activities/);
 assert.doesNotMatch(rd('staff-improvements.mjs'),/Client setup · activities, obligations & reporting/);
 assert.match(rd('staff-client-profile.mjs'),/'Continue set-up','primary'/);
});

test('presentation only: no new server action and nothing posts or approves',()=>{
 for(const f of ['staff-client-profile.mjs'])assert.doesNotMatch(rd(f),/request\(|fetch\(/);
 assert.match(rd('staff-improvements.mjs'),/action:'v3_client_read'/);
});
