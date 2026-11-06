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
 if(p.action==='ledger_opening_structure')return {sections:[{title:'Assets',accounts:[{code:'10000',name:'Cash on hand',normal_side:'Debit'}]},{title:'Liabilities',accounts:[{code:'20000',name:'Trade payables',normal_side:'Credit'}]},{title:'Equity',accounts:[]}],count:2,entity_type:'Partnership',chart_effective_from:'2026-01-01',opening_date:'2026-01-01'};
 if(p.action==='ledger_opening_template')return {name:'Opening_TB_T-structure_Test.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:Buffer.from('xlsx').toString('base64'),accounts:2};
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


test('the client T-structure can be viewed and downloaded from the opening step',async()=>{
 const saved=[];dom.window.URL.createObjectURL=b=>{saved.push(b);return 'blob:x';};dom.window.URL.revokeObjectURL=()=>{};globalThis.URL=dom.window.URL;globalThis.Blob=dom.window.Blob;globalThis.atob=s=>Buffer.from(s,'base64').toString('binary');
 dom.window.HTMLAnchorElement.prototype.click=function(){saved.push(this.download);};
 await ui.open('project-1');
 await click('[data-ledger-tab="Import & post"]');
 assert.ok($('[data-ledger="download-opening-structure"]'),'the client T-structure is the recommended download');assert.ok($('[data-ledger="opening-structure"]'));assert.ok($('[data-ledger="download-opening-template"]'),'the blank template stays available');
 await click('[data-ledger="opening-structure"]');
 const text=$('#editorBody').textContent;assert.match(text,/Assets · 1 account/);assert.match(text,/Liabilities · 1 account/);assert.match(text,/Equity · 0 accounts/);assert.match(text,/10000/);assert.match(text,/chart amendment/);
 await click('[data-ledger="download-opening-structure"]');
 assert.ok(saved.includes('Opening_TB_T-structure_Test.xlsx'));assert.ok(calls.some(x=>x.action==='ledger_opening_template'&&x.period_id==='period-2026'));
 dom.window.close();
});
