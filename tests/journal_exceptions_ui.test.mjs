import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createLedgerUI} from '../staff-ledger.mjs';

const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<dialog id="editor"><h2 id="title"></h2><p id="editorNotice"></p><div id="editorBody"></div></dialog>',{url:'https://example.test/staff-pilot'});
globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(n,l,v='',t='text',extra='')=>`<label>${l}<input name="${n}" value="${esc(v)}" type="${t}" ${extra}></label>`;
const select=(n,l,items,value='')=>`<label>${l}<select name="${n}"><option value="">Choose</option>${items.map(x=>{const [k,v]=Array.isArray(x)?x:[x,x];return `<option value="${k}" ${k===value?'selected':''}>${v}</option>`;}).join('')}</select></label>`;
const form=(body,label='Save')=>`<form id="editForm">${body}<button type="submit">${label}</button></form>`;
const period={period_id:'period-2026',starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open',entity_type:'Limited company'};
const state={me:{staff_id:'staff-1',category_code:'ASSISTANT'},documents:[{document_id:'doc-1',project_id:'project-1',file_name:'Opening_TB.xlsx'}]};
const calls=[];
let statementsReply;const fixes=[],journalState={fixed:false,me:'staff-1',status:'Draft'};
const accounts=[{code:'20000',name:'Trade payables',category_code:'LIAB',status:'Active',is_legacy:false},{code:'36010',name:'Partner current accounts',category_code:'EQ',status:'Active',is_legacy:false},{code:'10000',name:'Cash',category_code:'ASSET',status:'Active',is_legacy:false}];
const request=async p=>{
 calls.push(p);
 if(p.action==='ledger_pack_readiness')return {ready:false,status:'Not ready',blocked:1,summary:'Not ready: Prior-year comparatives.',checks:[{code:'COMPARATIVES',label:'Prior-year comparatives',status:'Blocked',detail:'Waiting'}],reporting:{framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings'},comparatives:{statements:[],detail:''}};
 if(p.action==='ledger_reporting_read')return {saved:true,reporting:{},problems:[]};
 if(p.action==='ledger_pack_statements')return statementsReply;
 if(p.action==='ledger_periods')return {periods:[period],accounts};
 if(p.action==='ledger_read')return {period,as_of:'2026-12-31',profit:{sales:0,gross_profit:0,profit_before_tax:0,statement:'Test'},journals:[{journal_id:'journal-1',kind:'Opening',reference:'OPEN-TB-2026',journal_date:'2026-01-01',status:'Draft'}],pending_sources:[],assets:[],ppe_sources:[],issues:[],disclosure:'Test'};
 if(p.action==='ledger_import_preview')return {sheet_name:'Opening TB',header_row:1,headers:['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],preview:[{source_row:2,values:['X1','Trade creditors','','',0,500]},{source_row:3,values:['X2','Partners current account','','',0,300]},{source_row:4,values:['X3','Mystery clearing','','',800,0]}],total_rows:3,settings:{document_id:'doc-1',header_row:1,kind:'Opening'}};
 if(p.action==='ledger_opening_structure')return {sections:[{title:'Assets',accounts:[{code:'10000',name:'Cash on hand',normal_side:'Debit'},{code:'10020',name:'Bank - operating',normal_side:'Debit'}]},{title:'Liabilities',accounts:[{code:'20000',name:'Trade payables',normal_side:'Credit'}]},{title:'Equity',accounts:[{code:'30000',name:'Share capital',normal_side:'Credit'}]}],count:2,entity_type:'Partnership',chart_effective_from:'2026-01-01',opening_date:'2026-01-01'};
 if(p.action==='ledger_opening_template')return {name:'Opening_TB_T-structure_Test.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:Buffer.from('xlsx').toString('base64'),accounts:2};
 if(p.action==='ledger_opening_suggest')return {suggestions:{'x1|trade creditors':{code:'20000',source:'rule',confidence:'High',basis:'Read from the account name'},'x2|partners current account':{code:'36010',source:'firm',confidence:'High',basis:'Approved for 2 other clients of this firm',clients:2},'x3|mystery clearing':{code:'10000',source:'firm',confidence:'Low',basis:'Clients of this firm disagree',clients:1}}};
 if(p.action==='ledger_import_commit')return {journal_id:'journal-1',imported_count:3,totals:{debit_kes:800,credit_kes:800,difference_kes:0},source_controls:[]};
 if(p.action==='ledger_journal_read')return journalReply();
 if(p.action==='ledger_journal_line_fix'){fixes.push(p);journalState.fixed=true;return {ok:true,journal_id:'journal-1'};}
 if(p.action==='ledger_journal_save')return {journal_id:'journal-9'};
 throw new Error('Unexpected action '+p.action);
};
function modal(title,body,save,after){$('#title').textContent=title;$('#editorBody').innerHTML=body;const f=$('#editForm');if(f)f.onsubmit=async e=>{e.preventDefault();const result=await save(new FormData(f));if(after)await after(result);};}
const payrollImports=[];
const ui=createLedgerUI({$,esc,field,select,form,modal,request,notice:()=>{},shortDate:v=>String(v).slice(0,10),projectName:()=> 'Example project',data:()=>state},{onPayrollImport:projectId=>payrollImports.push(projectId)});
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function click(selector){const element=$(selector);assert.ok(element,selector);element.click();await pause();}




const baseJournal=()=>({journal_id:'journal-1',kind:'Opening',reference:'OPEN-TB-2026',journal_date:'2026-01-01',description:'',evidence:'Approved source workbook and sign-off',source_snapshot:{kind:'Excel',source_rows:[]},status:journalState.status,prepared_by:'staff-1',last_prepared_by:'staff-1',revision:3});
const lineRows=()=>[{line_no:1,account_code:'10000',source_name:'Cash',legacy_code:'A1',source_status:'Confirmed',description:'',debit:800,credit:0,source_reference:'Opening.xlsx | TB | row 2'},{line_no:2,account_code:journalState.fixed?'20000':'',source_name:'Trade creditors',legacy_code:'A2',source_status:'Confirmed',description:'',debit:0,credit:800,source_reference:'Opening.xlsx | TB | row 3'}];
function journalReply(){
 if(journalState.legacy)return {journal:baseJournal(),lines:lineRows(),accounts,check:{needed:false},issues:['Line 2: map to an active detailed account.']};
 const fixed=journalState.fixed,exceptions=fixed?[]:[{scope:'line',kind:'UNMAPPED',line_no:2,source_row:3,account_code:null,source_name:'Trade creditors',message:'Line 2: map to an active detailed account.'}];
 return {journal:baseJournal(),lines:lineRows(),accounts,check:{needed:false},issues:exceptions.map(e=>e.message),exceptions,exception_summary:{rows_total:2,rows_failing:exceptions.length?1:0,rows_passing:exceptions.length?1:2,journal_exceptions:0,debit:800,credit:800,difference:0,ready:!exceptions.length},corrections:fixed?[{line_no:2,source_row:3,before:{account_code:null,debit:0,credit:800},after:{account_code:'20000',debit:0,credit:800},reason:'Fictional creditor account chosen from the chart',by:'staff-1',at:'2026-11-07T10:00:00Z'}]:[]};
}
async function openJournal(){await ui.open('project-1');await click('[data-ledger-tab="Entry register"]');await click('[data-ledger="journal"]');}
test('a flagged entry shows only the broken rows, locks submission, and a recorded correction clears it',async()=>{
 await openJournal();
 const panel=$('[data-entry-check]');assert.ok(panel,'the check banner is shown');assert.match(panel.textContent,/1 of 2 rows need correction/);assert.match(panel.textContent,/1 row pass/);
 const grid=[...document.querySelectorAll('#editorBody table')].find(t=>/Excel row/.test(t.textContent));assert.ok(grid,'the exception grid is shown');
 assert.equal(grid.querySelectorAll('tbody tr').length,1,'only the failing row is listed, not all rows');assert.match(grid.textContent,/Trade creditors/);assert.match(grid.textContent,/map to an active detailed account/);
 const submit=[...document.querySelectorAll('#editorBody button')].find(b=>/Submit for independent review/.test(b.textContent));assert.ok(submit&&submit.disabled,'sending for review is locked while an exception remains');assert.match(submit.textContent,/1 to fix first/);
 assert.equal($('[data-ledger="journal-submit"]'),null,'no active submit button while locked');
 await click('[data-ledger="journal-fix"]');
 assert.match($('#title').textContent,/Correct line 2/);assert.ok($('#editForm').elements.reason&&$('#editForm').elements.reason.required,'a reason is required');
 $('#editForm').elements.account_code.value='20000';$('#editForm').elements.reason.value='Fictional creditor account chosen from the chart';
 $('#editForm').requestSubmit?$('#editForm').requestSubmit():$('#editForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await pause();await pause();
 assert.equal(fixes.length,1);assert.deepEqual([fixes[0].journal_id,fixes[0].line_no,fixes[0].account_code,fixes[0].revision],['journal-1',2,'20000',3]);assert.equal(fixes[0].reason,'Fictional creditor account chosen from the chart');
 assert.match($('[data-entry-check]').textContent,/All rows pass/);
 assert.ok($('[data-ledger="journal-submit"]'),'the entry can now be sent for review');assert.match($('#editorBody').textContent,/1 correction made on this entry/);assert.match($('#editorBody').textContent,/Fictional creditor account chosen from the chart/);
});
test('an older server reply without row checks still shows the plain issue list and does not lock the button on the screen',async()=>{
 journalState.legacy=true;journalState.fixed=false;
 await openJournal();
 assert.equal($('[data-entry-check]'),null,'no row-level panel without row-level data');assert.match($('#editorBody').textContent,/Line 2: map to an active detailed account/);
 assert.ok($('[data-ledger="journal-submit"]'),'the server still refuses a submit with open issues, so the screen leaves the choice to it');
 journalState.legacy=false;
});
