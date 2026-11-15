// Build 2799: monthly bank totals and adjustments from the firm's five-bank workbook (sheet BANK INPUTS), read as it is.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const fx='supabase/functions/staff-workspace-v12/',rd=f=>fs.readFileSync(f,'utf8');
const {readBankInputs,computeBankTotals,reviewProblem,MONTHS,ADJUSTMENTS}=await import('../'+fx+'bank-totals-rules.mjs');
const sheet=rows=>({name:'BANK INPUTS',rowCount:rows.length,columnCount:Math.max(...rows.map(r=>r.length)),getRow:i=>({getCell:c=>({value:rows[i-1]?.[c-1]??null})})});
const H={bank:['Account code','Bank / account name','Account reference (last 4)','Active?','Currency','Notes'],total:['Month','Account code','Bank name (linked)','Gross bank credits (KES)','Bank charges (KES)','Loan interest (KES)','Excise on bank fees (KES)','Other finance costs (KES)','Statement debit total (optional)','Statement ref / notes'],adj:['Month','Account code','Date','Bank reference','Narration / source','Direction','Adjustment category','Amount (KES)','Evidence / document','Review status']};
function book({totals=[],adj=[],year=2026}={}){
 const rows=[['PCL PMS  |  BANK INPUTS  |  MONTHLY MONEY-IN & ADJUSTMENTS'],[],[],['Client / firm','X','', 'Financial year',year],[],[],['01  BANK ACCOUNT REGISTER'],H.bank,['BANK1','KCB Bank Ltd','0686','Yes','KES',''],['BANK2','Equity Bank','D002','Yes','KES',''],[],[],[],['02  MONTHLY BANK TOTALS'],[],H.total,...totals,[],['03  NON-TRADE CREDIT'],H.adj,...adj];
 rows[3]=['Client / firm','X','','Financial year',year];
 return sheet(rows);
}
test('the BANK INPUTS blocks are found by their headings and the year is read',()=>{
 const r=readBankInputs(book({totals:[['January','BANK1','',1000,10,0,0,0,'', '']],adj:[['January','BANK1','2026-01-05','R1','Loan','Credit','Loan received',200,'Agreement','Approved']]}));
 assert.equal(r.recognised,true);assert.deepEqual(r.issues,[]);assert.equal(r.year,2026);assert.equal(r.banks.length,2);assert.equal(r.months.length,1);assert.equal(r.adjustments.length,1);
 assert.equal(readBankInputs(sheet([['Something else'],['a']])).recognised,false);
});
test('adjusted trade collections follow the workbook: credits less non-trade credits less bounced cheques plus corrections',()=>{
 const r=readBankInputs(book({totals:[['January','BANK1','',1000,10,5,2,1,'',''],['January','BANK2','',500,'','','','','',''],['February','BANK1','',0,'','','','','','']],
  adj:[['January','BANK1','2026-01-05','R1','Loan','Credit','Loan received',200,'Agreement','Approved'],['January','BANK1','2026-01-09','R2','Bounced','Debit','Bounced cheque reversal',50,'Bank advice',''],['January','BANK1','2026-01-10','R3','Correction','Credit','Trade receipt correction (+)',30,'',''],['January','BANK2','2026-01-12','R4','Fix','Debit','Trade receipt correction (-)',20,'','']]}));
 const c=computeBankTotals(r,{year:2026});assert.deepEqual(c.issues,[]);
 const b1=c.rows.find(x=>x.bank==='BANK1'&&x.month==='January'),b2=c.rows.find(x=>x.bank==='BANK2');
 assert.equal(b1.adjusted_trade,780);assert.equal(b1.finance_costs,18);assert.equal(b2.adjusted_trade,480);
 assert.equal(c.totals.credits,1500);assert.equal(c.totals.non_trade,200);assert.equal(c.totals.bounced,50);assert.equal(c.totals.correction,10);assert.equal(c.totals.adjusted_trade,1260);assert.equal(c.by_kind['Loan received'],200);
 assert.equal(c.warnings.filter(w=>/no evidence/.test(w)).length,2,'rows with no evidence are flagged, never rejected');
});
test('wrong direction, unknown bank, missing credits, negative result and duplicates are listed problems',()=>{
 const r=readBankInputs(book({totals:[['January','BANK1','',100,'','','','','',''],['January','BANK1','',100,'','','','','',''],['February','BANK9','',5,'','','','','',''],['March','BANK2','','','','','','','','']],
  adj:[['January','BANK1','2026-01-05','R1','x','Debit','Loan received',10,'e',''],['January','BANK1','2026-01-05','R2','x','Credit','Capital injection',500,'e',''],['March','BANK2','2026-03-05','R3','x','Credit','Other non-trade credit',-5,'e',''],['March','BANK2','2026-03-06','R4','x','Credit','Other non-trade credit',5,'e',''],['April','BANK1','2026-04-06','R5','x','Credit','Made-up kind',5,'e','']]}));
 const text=computeBankTotals(r,{year:2026}).issues.join(' | ');
 for(const re of [/Loan received must be a credit/,/appears twice/,/BANK9 is not in the bank register/,/enter the amount as a positive number/,/has adjustments but no statement credit total/,/exceed the statement credits/,/choose an adjustment category/])assert.match(text,re);
});
test('an uploaded Approved status or reviewer is never accepted: a different Manager or Partner confirms with a note and a tick',()=>{
 const b={status:'Draft',created_by:'s1'};
 assert.match(reviewProblem({batch:b,actor:{category_code:'ASSISTANT',staff_id:'s2'},note:'checked all months',agreed:true}),/Manager or Partner/);
 assert.match(reviewProblem({batch:b,actor:{category_code:'MANAGER',staff_id:'s1'},note:'checked all months',agreed:true}),/different Manager or Partner/);
 assert.match(reviewProblem({batch:b,actor:{category_code:'MANAGER',staff_id:'s2'},note:'short',agreed:true}),/at least 10/);
 assert.match(reviewProblem({batch:b,actor:{category_code:'MANAGER',staff_id:'s2'},note:'checked all months',agreed:false}),/Tick/);
 assert.equal(reviewProblem({batch:b,actor:{category_code:'PARTNER',staff_id:'s2'},note:'checked all months',agreed:true}),null);
 assert.equal(MONTHS.length,12);assert.equal(Object.keys(ADJUSTMENTS).length,11);
});
test('migration: row security forced, no delete, audit, one live batch per client and year, confirmation by a different Manager or Partner',()=>{
 const m=rd('supabase/migrations/20261114120000_bank_total_batches.sql');
 for(const re of [/CREATE TABLE erp_private\.bank_total_batches/,/FORCE ROW LEVEL SECURITY/,/reject_delete/,/log_change\('batch_id'\)/,/bank_total_batches_live_uq[\s\S]*WHERE status<>'Withdrawn'/,/Only a Manager or Partner can confirm a bank totals batch/,/cannot confirm it/,/GRANT SELECT,INSERT,UPDATE ON erp_private\.bank_total_batches TO erp_api/])assert.match(m,re);
 assert.doesNotMatch(m,/excise|duty|schedule/i);assert.match(m,/source_document_id[\s\S]*bank_total_batches_source_document_idx|CREATE INDEX bank_total_batches_source_document_idx/);
});
test('server wiring: the action is registered and reads only the server-parsed workbook',()=>{
 const idx=rd(fx+'index.ts'),act=rd(fx+'bank-totals-actions.ts');
 assert.match(idx,/bankTotalsAction/);assert.match(idx,/bankTotalsAction\(tx,a,p,admin\.storage\.from\(BUCKET\)\)/);
 for(const n of ['bank_totals_read','bank_totals_preview','bank_totals_save','bank_totals_confirm','bank_totals_withdraw'])assert.match(act,new RegExp(n));
 assert.doesNotMatch(act,/p\.result|p\.inputs/,'figures sent by the browser are never trusted');
 assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261116-tbimport-v1/);assert.match(rd('staff-ledger.mjs'),/staff-bank-totals\.mjs\?v=20261114-banktotals-v1/);assert.match(rd('staff-ledger.mjs'),/btn\('bank-totals'/);
 assert.equal(JSON.parse(rd(fx+'release.json')).build,'2026-11-14.2828');assert.match(rd('staff-pilot.html'),/2026-11-14\.2828/);
});
const dom=new JSDOM('<!doctype html><dialog id="editor"><div id="editorBody"></div></dialog>');globalThis.document=dom.window.document;
const {createBankTotalsUI,resultView}=await import('../staff-bank-totals.mjs');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const table=(h,rows)=>`<table><tr>${h.map(x=>`<th>${x}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
test('screen: workbook list, check, then confirm only by someone other than the preparer',async()=>{
 let me={category_code:'MANAGER',staff_id:'s2'},sent=[],title='',submit=null,after=null;
 const batches=[{batch_id:'b1',starts_on:'2026-01-01',status:'Draft',created_by:'s1',prepared_by_name:'A',created_at:'2026-11-14',file_name:'five.xlsx',revision:1,result:{totals:{credits:5},by_month:[],issues:[],warnings:[]}}];
 const ctx={$:s=>document.querySelector(s),esc,select:(n,l,items)=>`<label>${l}<select name="${n}"><option value=""></option>${items.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>`,field:()=>'',form:(b,l)=>`<form id="editForm">${b}<button type="submit">${l}</button></form>`,
  modal:(t,h,fn,aft)=>{title=t;document.querySelector('#editorBody').innerHTML=h;submit=fn;after=aft;},table,shortDate:v=>String(v).slice(0,10),notice:()=>{},data:()=>({me}),
  request:async p=>{sent.push(p.action);if(p.action==='bank_totals_read')return {batches,documents:[{document_id:'d1',file_name:'five.xlsx'}],bank_register:[]};if(p.action==='bank_totals_preview')return {year:2026,sheet:'BANK INPUTS',file_name:'five.xlsx',blocked:false,result:{totals:{credits:10,non_trade:1,bounced:0,correction:0,adjusted_trade:9,finance_costs:1},by_month:[{month:'January',credits:10,non_trade:1,bounced:0,correction:0,adjusted_trade:9,finance_costs:1}],by_kind:{'Loan received':1},links:[],issues:[],warnings:['x']}};return {ok:true};}};
 const ui=createBankTotalsUI(ctx);await ui.open('c1');assert.equal(title,'Monthly bank totals (workbook)');
 const body=document.querySelector('#editorBody');assert.ok(body.querySelector('[data-bt="confirm"]'),'a different Manager sees Confirm');
 me={category_code:'MANAGER',staff_id:'s1'};await ui.open('c1');assert.equal(document.querySelector('#editorBody [data-bt="confirm"]'),null,'the preparer does not');
 me={category_code:'ASSISTANT',staff_id:'s3'};await ui.open('c1');assert.equal(document.querySelector('#editorBody [data-bt="confirm"]'),null);assert.equal(document.querySelector('#editorBody [data-bt="withdraw"]'),null);
 const fd=new Map([['document_id','d1']]);const out=await submit({get:k=>fd.get(k)});await after(out);assert.equal(title,'Bank totals for 2026');assert.match(document.querySelector('#editorBody').textContent,/Adjusted trade collections/);
 assert.match(resultView({issues:['Row 5 problem'],warnings:[],totals:{},by_month:[]},{esc,table}),/To fix in the workbook/);
});
