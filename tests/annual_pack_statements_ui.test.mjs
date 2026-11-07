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
let statementsReply;
const accounts=[{code:'20000',name:'Trade payables',category_code:'LIAB',status:'Active',is_legacy:false},{code:'36010',name:'Partner current accounts',category_code:'EQ',status:'Active',is_legacy:false},{code:'10000',name:'Cash',category_code:'ASSET',status:'Active',is_legacy:false}];
const request=async p=>{
 calls.push(p);
 if(p.action==='ledger_pack_readiness')return {ready:false,status:'Not ready',blocked:1,summary:'Not ready: Prior-year comparatives.',checks:[{code:'COMPARATIVES',label:'Prior-year comparatives',status:'Blocked',detail:'Waiting'}],reporting:{framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings'},comparatives:{statements:[],detail:''}};
 if(p.action==='ledger_reporting_read')return {saved:true,reporting:{},problems:[]};
 if(p.action==='ledger_pack_statements')return statementsReply;
 if(p.action==='ledger_periods')return {periods:[period],accounts};
 if(p.action==='ledger_read')return {period,as_of:'2026-12-31',profit:{sales:0,gross_profit:0,profit_before_tax:0,statement:'Test'},journals:[],pending_sources:[],assets:[],ppe_sources:[],issues:[],disclosure:'Test'};
 if(p.action==='ledger_import_preview')return {sheet_name:'Opening TB',header_row:1,headers:['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],preview:[{source_row:2,values:['X1','Trade creditors','','',0,500]},{source_row:3,values:['X2','Partners current account','','',0,300]},{source_row:4,values:['X3','Mystery clearing','','',800,0]}],total_rows:3,settings:{document_id:'doc-1',header_row:1,kind:'Opening'}};
 if(p.action==='ledger_opening_structure')return {sections:[{title:'Assets',accounts:[{code:'10000',name:'Cash on hand',normal_side:'Debit'},{code:'10020',name:'Bank - operating',normal_side:'Debit'}]},{title:'Liabilities',accounts:[{code:'20000',name:'Trade payables',normal_side:'Credit'}]},{title:'Equity',accounts:[{code:'30000',name:'Share capital',normal_side:'Credit'}]}],count:2,entity_type:'Partnership',chart_effective_from:'2026-01-01',opening_date:'2026-01-01'};
 if(p.action==='ledger_opening_template')return {name:'Opening_TB_T-structure_Test.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:Buffer.from('xlsx').toString('base64'),accounts:2};
 if(p.action==='ledger_opening_suggest')return {suggestions:{'x1|trade creditors':{code:'20000',source:'rule',confidence:'High',basis:'Read from the account name'},'x2|partners current account':{code:'36010',source:'firm',confidence:'High',basis:'Approved for 2 other clients of this firm',clients:2},'x3|mystery clearing':{code:'10000',source:'firm',confidence:'Low',basis:'Clients of this firm disagree',clients:1}}};
 if(p.action==='ledger_import_commit')return {journal_id:'journal-1',imported_count:3,totals:{debit_kes:800,credit_kes:800,difference_kes:0},source_controls:[]};
 if(p.action==='ledger_journal_read')return {journal:{journal_id:'journal-1',kind:'Opening',reference:'OPEN-TB-2026',journal_date:'2026-01-01',description:'',evidence:'Approved source workbook and sign-off',source_snapshot:{kind:'Excel'},status:'Draft',prepared_by:'staff-1',last_prepared_by:'staff-1',revision:1},lines:[],accounts,issues:[]};
 if(p.action==='ledger_journal_save')return {journal_id:'journal-9'};
 throw new Error('Unexpected action '+p.action);
};
function modal(title,body,save,after){$('#title').textContent=title;$('#editorBody').innerHTML=body;const f=$('#editForm');if(f)f.onsubmit=async e=>{e.preventDefault();const result=await save(new FormData(f));if(after)await after(result);};}
const payrollImports=[];
const ui=createLedgerUI({$,esc,field,select,form,modal,request,notice:()=>{},shortDate:v=>String(v).slice(0,10),projectName:()=> 'Example project',data:()=>state},{onPayrollImport:projectId=>payrollImports.push(projectId)});
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
async function click(selector){const element=$(selector);assert.ok(element,selector);element.click();await pause();}



const row=(kind,label,current,prior=null,code=null)=>({kind,label,code,current,prior});
test('annual accounts offers the draft statements and shows them with prior-year columns and the problems',async()=>{
 statementsReply={client:{name:'Fictional Mlima Traders',kra_pin:'P000000000X'},reporting:{framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings'},status:'Draft - not ready',readiness:{ready:false,summary:'Not ready: Prior-year comparatives.'},
  statements:{period:{starts_on:'2026-01-01',ends_on:'2026-12-31',as_of:'2026-12-31'},presentation:{unit_label:'KES'},problems:['There are no approved prior-year profit or loss comparatives, so that column is not shown.'],
   profit_or_loss:{title:'Statement of profit or loss',has_prior:true,rows:[{kind:'heading',label:'Revenue'},row('line','Revenue',1000000,800000,'PL.REVENUE'),row('line','Cost of sales',-400000,-300000),row('subtotal','Gross profit',600000,500000),row('total','Profit for the year',250000,0)]},
   financial_position:{title:'Statement of financial position',has_prior:false,rows:[{kind:'heading',label:'Current assets'},row('line','Cash and cash equivalents',500000),row('total','Total assets',500000)]}}};
 await ui.open('project-1');
 await click('[data-ledger-tab="Annual accounts"]');await pause();
 assert.ok($('[data-ledger="pack-statements"]'),'the draft statements are offered to every role that can see the tab');
 await click('[data-ledger="pack-statements"]');
 const text=$('#editorBody').textContent;
 assert.ok(calls.some(x=>x.action==='ledger_pack_statements'&&x.period_id==='period-2026'&&x.as_of==='2026-12-31'));
 assert.match(text,/Draft - not ready/);assert.match(text,/Fictional Mlima Traders/);assert.match(text,/Statement of profit or loss for the year ended 2026-12-31/);
 assert.match(text,/1,000,000/);assert.match(text,/800,000/);assert.match(text,/\(400,000\)/,'costs show in brackets');assert.match(text,/–/,'a zero shows as a dash');
 assert.match(text,/no approved prior-year profit or loss comparatives/);
 const heads=[...document.querySelectorAll('#editorBody h4')].map(x=>x.textContent);assert.ok(heads.some(h=>/Statement of financial position at 2026-12-31/.test(h)));
 const tables=document.querySelectorAll('#editorBody .stmt table');assert.equal(tables.length,2);
 assert.equal(tables[0].querySelectorAll('thead th').length,3,'prior-year column present when comparatives exist');assert.equal(tables[1].querySelectorAll('thead th').length,2,'no prior column without comparatives');
});
test('statements escape text from the server and never render markup',async()=>{
 statementsReply={client:{name:'<img src=x onerror=alert(1)>'},reporting:{framework:'F',edition:'E'},status:'Draft - not ready',readiness:{summary:'<b>x</b>'},statements:{period:{ends_on:'2026-12-31'},presentation:{unit_label:'KES'},problems:[],profit_or_loss:{title:'P',has_prior:false,rows:[row('line','<script>x</script>',1)]},financial_position:{title:'F',has_prior:false,rows:[]}}};
 await ui.open('project-1');await click('[data-ledger-tab="Annual accounts"]');await pause();await click('[data-ledger="pack-statements"]');
 assert.equal(document.querySelectorAll('#editorBody img, #editorBody script').length,0);assert.match($('#editorBody').textContent,/<script>x<\/script>/);
});
