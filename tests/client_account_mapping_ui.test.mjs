import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';

const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM(await readFile(new URL('../staff-pilot.html',import.meta.url),'utf8'),{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
for(const key of ['window','document','location','history','sessionStorage','localStorage','FormData','HTMLElement'])globalThis[key]=dom.window[key];
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),clientId=id(2),firmId=id(3),staffId=id(1),otherStaff=id(9),docId=id(8),calls=[];
const me={staff_id:staffId,full_name:'Fictional QA Manager',category_code:'MANAGER',login_id:'qa.manager'};
const suite=Object.fromEntries(['leads','tax_profiles','rates','staff_rates','budgets','invoices','payments','communications','contacts','compliance','owners','engagements','tax_cases','leave','attendance','credentials','reviews','tickets'].map(k=>[k,[]]));
const workspace={me,firms:[{firm_id:firmId,firm_code:'QA',legal_name:'Fictional QA firm'}],staff:[me],staff_firms:[{staff_id:staffId,firm_id:firmId}],clients:[{client_id:clientId,company_name:'Fictional Mapping Client',kra_pin:'P000000000A',year_end_month:12,year_end_day:31,missing_fields:[]}],client_firms:[{client_id:clientId,firm_id:firmId}],projects:[],assignments:[],candidates:[{...me,firm_id:firmId}],tasks:[],documents:[],services:[],sectors:[],schedules:[],timesheets:[],notifications:[],task_events:[],workbook_batches:[],task_procedures:[],suite};
let mappings=[
 {mapping_id:id(10),client_id:clientId,source_account_code:'CASH-01',source_account_name:'Cash at bank',erp_account_code:'10000',erp_account_name:'Cash and cash equivalents',route:1,category_code:'ASSET',effective_from:'2026-01-01',status:'Draft',created_by:otherStaff,revision:1},
 {mapping_id:id(11),client_id:clientId,source_account_code:'SALES-01',source_account_name:'Sales revenue',erp_account_code:'40000',erp_account_name:'Sales',route:2,category_code:'INC01',effective_from:'2026-01-01',status:'Draft',created_by:otherStaff,revision:1},
];
const accountRead=()=>({client:workspace.clients[0],accounts:[{code:'10000',name:'Cash and cash equivalents',route:1,category_code:'ASSET'},{code:'40000',name:'Sales',route:2,category_code:'INC01'}],mappings,opening_sources:[{document_id:docId,file_name:'Fictional_Opening_TB.xlsx',uploaded_at:'2026-10-28T00:00:00Z'}]});
const preview={needs_sheet:false,document_id:docId,file_name:'Fictional_Opening_TB.xlsx',sheet_name:'Opening TB',effective_from:'2026-01-01',preview_fingerprint:'a'.repeat(64),ready_count:1,exception_count:1,proposals:[
 {source_row:2,source_rows:[2],source_account_code:'CASH-02',source_account_name:'Cash account two',routing_code:'ASSET',erp_account_code:'10000',erp_account_name:'Cash and cash equivalents',ready:true,state:'Ready'},
 {source_row:3,source_rows:[3],source_account_code:'BAD-01',source_account_name:'Bad code',routing_code:'BAD',erp_account_code:'99999',erp_account_name:'',ready:false,state:'Exception',issue:'Invalid routing and account code.'},
]};
globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);calls.push(p);let result={ok:true};
 if(p.action==='login')result={access_token:'qa',refresh_token:'refresh',expires_at:Date.now()/1000+3600,session_id:'qa'};
 if(p.action==='workspace')result=workspace;
 if(p.action==='presence_heartbeat')result={status:'Not clocked in',server_time:'2026-10-29T12:00:00Z'};
 if(p.action==='v3_client_mapping_readiness')result=[{client_id:clientId,approved_account_count:mappings.filter(x=>x.status==='Active').length,pending_account_count:mappings.filter(x=>x.status==='Draft').length}];
 if(p.action==='v3_client_accounts_read')result=accountRead();
 if(p.action==='v3_client_account_mapping_approve_batch'){for(const x of p.items){const row=mappings.find(m=>m.mapping_id===x.mapping_id);row.status='Active';row.revision++;}result={ok:true,approved_count:p.items.length};}
 if(p.action==='v3_client_account_mapping_tb_preview')result=preview;
 if(p.action==='v3_client_account_mapping_tb_save'){assert.deepEqual(p.source_rows,['2']);mappings.push({mapping_id:id(12),client_id:clientId,source_account_code:'CASH-02',source_account_name:'Cash account two',erp_account_code:'10000',erp_account_name:'Cash and cash equivalents',route:1,category_code:'ASSET',effective_from:p.effective_from,status:'Draft',created_by:staffId,revision:1});result={ok:true,draft_count:1};}
 return {ok:true,json:async()=>result};};
const pause=()=>new Promise(r=>setTimeout(r,60)),click=async selector=>{const b=document.querySelector(selector);assert.ok(b,'Missing control '+selector);b.click();await pause();};
await import('../staff-pilot.mjs');

test('client account setup has no separate mapping approval and routes opening TB to the single import flow',async t=>{
 t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value=me.login_id;document.querySelector('#loginForm [name=password]').value='TestPassword12345';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();
 await click('[data-view="clients"]');await click(`[data-client-accounts="${clientId}"]`);
 assert.equal(document.querySelectorAll('[data-client-map-select]').length,0,'no mapping selection for approval');
 assert.equal(document.querySelector('[data-client-map-approve],[data-client-map-approve-selected]'),null,'no separate mapping approval control');
 assert.match(document.querySelector('#editorBody').textContent,/Pending review/);
 assert.match(document.querySelector('#editorBody').textContent,/reviewed when a different Manager or Partner approves and posts the journal that uses it/);
 assert.match(document.querySelector('#editorBody').textContent,/There is no separate mapping approval/);
 assert.ok(!calls.some(x=>x.action==='v3_client_account_mapping_approve'||x.action==='v3_client_account_mapping_approve_batch'));
 assert.equal(document.querySelector(`[data-client-map-propose="${clientId}"]`),null,'opening TB no longer has a separate mapping proposal screen');
 assert.match(document.querySelector('#editorBody').textContent,/opening TB mappings are resolved on the import screen/i);
 assert.match(document.querySelector('#editorBody').textContent,/Continue opening TB setup/);
 assert.ok(!calls.some(x=>x.action==='v3_client_account_mapping_tb_preview'||x.action==='v3_client_account_mapping_tb_save'));
 dom.window.close();
});
