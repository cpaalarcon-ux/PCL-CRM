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
const accounts=[{code:'20000',name:'Trade payables',category_code:'LIAB',status:'Active',is_legacy:false},{code:'36010',name:'Partner current accounts',category_code:'EQ',status:'Active',is_legacy:false},{code:'10000',name:'Cash',category_code:'ASSET',status:'Active',is_legacy:false}];
const request=async p=>{
 calls.push(p);
 if(p.action==='ledger_periods')return {periods:[period],accounts};
 if(p.action==='ledger_read')return {period,as_of:'2026-12-31',profit:{sales:0,gross_profit:0,profit_before_tax:0,statement:'Test'},journals:[],pending_sources:[],assets:[],ppe_sources:[],issues:[],disclosure:'Test'};
 if(p.action==='ledger_import_preview')return {sheet_name:'Opening TB',header_row:1,headers:['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],preview:[{source_row:2,values:['X1','Trade creditors','','',0,500]},{source_row:3,values:['X2','Partners current account','','',0,300]},{source_row:4,values:['X3','Mystery clearing','','',800,0]}],total_rows:3,settings:{document_id:'doc-1',header_row:1,kind:'Opening'}};
 if(p.action==='ledger_opening_suggest')return {suggestions:{'x1|trade creditors':{code:'20000',source:'rule',confidence:'High',basis:'Read from the account name'},'x2|partners current account':{code:'36010',source:'firm',confidence:'High',basis:'Approved for 2 other clients of this firm',clients:2},'x3|mystery clearing':{code:'10000',source:'firm',confidence:'Low',basis:'Clients of this firm disagree',clients:1}}};
 if(p.action==='ledger_import_commit')return {journal_id:'journal-1',imported_count:3,totals:{debit_kes:800,credit_kes:800,difference_kes:0},source_controls:[]};
 if(p.action==='ledger_journal_read')return {journal:{journal_id:'journal-1',kind:'Opening',reference:'OPEN-TB-2026',journal_date:'2026-01-01',description:'',evidence:'Approved source workbook and sign-off',source_snapshot:{kind:'Excel'},status:'Draft',prepared_by:'staff-1',last_prepared_by:'staff-1',revision:1},lines:[],accounts,issues:[]};
 throw new Error('Unexpected action '+p.action);
};
function modal(title,body,save,after){$('#title').textContent=title;$('#editorBody').innerHTML=body;const f=$('#editForm');if(f)f.onsubmit=async e=>{e.preventDefault();const result=await save(new FormData(f));if(after)await after(result);};}
const payrollImports=[];
const ui=createLedgerUI({$,esc,field,select,form,modal,request,notice:()=>{},shortDate:v=>String(v).slice(0,10),projectName:()=> 'Example project',data:()=>state},{onPayrollImport:projectId=>payrollImports.push(projectId)});
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function click(selector){const element=$(selector);assert.ok(element,selector);element.click();await pause();}

test('suggested opening accounts are pre-selected but never confirmed until the preparer accepts them',async()=>{
 await ui.open('project-1');
 await click('[data-ledger-tab="Import & post"]');
 await click('[data-ledger="import-opening"]');
 const selection=$('#editForm');selection.elements.document_id.value='doc-1';selection.elements.header_row.value='1';
 selection.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();await pause();
 const ask=calls.find(x=>x.action==='ledger_opening_suggest');assert.ok(ask,'asks for suggestions');
 assert.equal(ask.period_id,'period-2026');assert.equal(ask.rows.length,3);assert.equal(ask.rows[0].source_name,'Trade creditors');
 const sel=i=>document.querySelector('[data-opening-target="'+i+'"]'),chk=i=>document.querySelector('[data-opening-confirm="'+i+'"]');
 assert.equal(sel(0).value,'20000');assert.equal(sel(1).value,'36010');assert.equal(sel(2).value,'10000');
 assert.equal(chk(0).checked,false);assert.equal(chk(1).checked,false);
 assert.match($('#openingAccountMapping').textContent,/Approved for 2 other clients of this firm/);
 assert.match($('#openingAccountMapping').textContent,/2 accounts are suggested/);
 await click('#acceptSuggested');
 assert.equal(chk(0).checked,true);assert.equal(chk(1).checked,true);assert.equal(chk(2).checked,false,'a low-confidence suggestion is not accepted in bulk');
 // the preparer changes one suggestion: it becomes a manual choice
 sel(0).value='10000';sel(0).dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause();
 assert.equal(chk(0).checked,false);
 chk(0).checked=true;chk(0).dispatchEvent(new dom.window.Event('change',{bubbles:true}));chk(2).checked=true;chk(2).dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause();
 $('#editForm').elements.evidence.value='Approved 2025 closing trial balance and sign-off';$('#editForm').elements.confirm_opening_source.checked=true;
 $('#editForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();
 const commit=calls.find(x=>x.action==='ledger_import_commit');assert.ok(commit);
 assert.deepEqual([commit.mapping_sources['2'],commit.mapping_sources['3'],commit.mapping_sources['4']],['manual','firm-learned','firm-learned']);
 assert.deepEqual([commit.account_overrides['2'],commit.account_overrides['3'],commit.account_overrides['4']],['10000','36010','10000']);
 dom.window.close();
});
