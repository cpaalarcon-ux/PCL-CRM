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
const calls=[];let accounts=[];
const request=async p=>{
 calls.push(p);
 if(p.action==='ledger_periods')return {periods:[period],accounts};
 if(p.action==='ledger_read')return {period,as_of:'2026-12-31',profit:{sales:0,gross_profit:0,profit_before_tax:0,statement:'Test'},journals:[],pending_sources:[],assets:[],ppe_sources:[],issues:[],disclosure:'Test'};
 if(p.action==='ledger_import_preview')return {sheet_name:'Opening TB',header_row:1,headers:['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],preview:[{source_row:2,values:['OLD-CASH','Cash','ASSET','10000',100,0]}],settings:{document_id:'doc-1',header_row:1,kind:'Opening'}};
 if(p.action==='ledger_import_commit')return {journal_id:'journal-1',imported_count:1,totals:{debit_kes:100,credit_kes:100,difference_kes:0},source_controls:[]};
 if(p.action==='ledger_journal_read')return {journal:{journal_id:'journal-1',kind:'Opening',reference:'OPEN-TB-2026',journal_date:'2026-01-01',description:'',evidence:'Approved source workbook and sign-off',source_snapshot:{kind:'Excel'},status:'Draft',prepared_by:'staff-1',last_prepared_by:'staff-1',revision:1},lines:[],accounts,issues:[]};
 throw new Error('Unexpected action '+p.action);
};
function modal(title,body,save,after){$('#title').textContent=title;$('#editorBody').innerHTML=body;const f=$('#editForm');if(f)f.onsubmit=async e=>{e.preventDefault();const result=await save(new FormData(f));if(after)await after(result);};}
const ui=createLedgerUI({$,esc,field,select,form,modal,request,notice:()=>{},shortDate:v=>String(v).slice(0,10),projectName:()=> 'Example project',data:()=>state});
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function click(selector){const element=$(selector);assert.ok(element,selector);element.click();await pause();}

test('standard opening template auto-maps six columns and asks for evidence once',async()=>{
 await ui.open('project-1');
 await click('[data-ledger-tab="Import & post"]');
 await click('[data-ledger="import-opening"]');
 const selection=$('#editForm');selection.elements.document_id.value='doc-1';selection.elements.header_row.value='1';
 selection.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();
 assert.match($('#editorBody').textContent,/Standard six-column template detected/);
 assert.equal(document.querySelector('[name="source_name"]'),null);
 assert.equal(document.querySelector('[name="source_status"]'),null);
 assert.equal(document.querySelector('[name="source_reference"]'),null);
 assert.equal(document.querySelector('[name="journal_date"]'),null);
 assert.equal($('#editForm').elements.reference.value,'OPEN-TB-2026');
 const confirm=$('#editForm').elements.confirm_opening_source;assert.ok(confirm.required);
 $('#editForm').elements.evidence.value='Approved 2025 closing trial balance and sign-off';confirm.checked=true;
 $('#editForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();
 const commit=calls.find(x=>x.action==='ledger_import_commit');assert.ok(commit);
 assert.deepEqual(commit.column_map,{legacy_code:'1',source_name:'2',routing_code:'3',tb_item_code:'4',debit:'5',credit:'6'});
 assert.equal(commit.confirm_opening_source,true);assert.equal(commit.journal_date,'2026-01-01');
 dom.window.close();
});
