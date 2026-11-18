import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from '../supabase/functions/staff-workspace-v6/node_modules/exceljs/excel.js';
import {detectTemplate,templateRow,normalizeTemplate,expenditureCodes,rowWarnings} from '../supabase/functions/staff-workspace-v12/workbook-templates.mjs';
import {expenseHeaders} from './workbook_templates.test.mjs';

const accounts=[
 {code:'61000',name:'Fictional operating expense',route:2,category_code:'EXP01',status:'Active',is_legacy:false},
 {code:'61100',name:'Fictional admin expense',route:2,category_code:'EXP02',status:'Active',is_legacy:false},
 {code:'61999',name:'Fictional closed expense',route:2,category_code:'EXP01',status:'Inactive',is_legacy:false},
 {code:'61998',name:'Fictional legacy expense',route:2,category_code:'EXP01',status:'Active',is_legacy:true},
 {code:'10100',name:'Fictional stock',route:1,category_code:'STOCK',status:'Active',is_legacy:false},
 {code:'15000',name:'Fictional vehicle',route:3,category_code:'PPE25V',status:'Active',is_legacy:false}
];
test('a matching category and TB code is a suggestion only; nothing is mapped by the upload',()=>{
 const x=expenditureCodes({category:'EXP01',tb:'61000'},accounts);
 assert.equal(x.routing_code,'EXP01');assert.deepEqual(x.suggestion,{route:2,category_code:'EXP01',account_code:'61000',confirmed:false});assert.equal(x.issue,undefined);
 assert.deepEqual(expenditureCodes({category:'exp01',tb:' 61000 '},accounts).suggestion.account_code,'61000','case and spaces are tidied, nothing else');
});
test('nothing entered gives nothing; a category alone is a key; a TB code alone is never used to choose the category',()=>{
 assert.deepEqual(expenditureCodes({category:'',tb:''},accounts),{});
 assert.deepEqual(expenditureCodes({category:'EXP02',tb:''},accounts),{routing_code:'EXP02'});
 const x=expenditureCodes({category:'',tb:'61000'},accounts);assert.equal(x.routing_code,undefined);assert.match(x.issue,/A TB code alone is not used/);
});
test('a pair that does not match an active expenditure account is reported by name and never suggested',()=>{
 assert.match(expenditureCodes({category:'EXP02',tb:'61000'},accounts).issue,/does not match ERP TB item code 61000.*uses routing code EXP01/);
 assert.match(expenditureCodes({category:'EXP01',tb:'61999'},accounts).issue,/not an active expenditure account/);
 assert.match(expenditureCodes({category:'EXP01',tb:'61998'},accounts).issue,/not an active expenditure account/);
 assert.match(expenditureCodes({category:'EXP01',tb:'10100'},accounts).issue,/routing 1/);
 assert.match(expenditureCodes({category:'EXP01',tb:'15000'},accounts).issue,/routing 3/);
 assert.match(expenditureCodes({category:'EXP01',tb:'99999'},accounts).issue,/not an account in the master chart/);
 assert.match(expenditureCodes({category:'EXP01',tb:'6100'},accounts).issue,/five-digit/);
 assert.match(expenditureCodes({category:'02-OPEX',tb:'61000'},accounts).issue,/such as EXP01/);
 for(const c of [{category:'EXP02',tb:'61000'},{category:'EXP01',tb:'10100'},{category:'EXP01',tb:'99999'}])assert.equal(expenditureCodes(c,accounts).suggestion,undefined);
});
const sheet=()=>{const w=new ExcelJS.Workbook(),s=w.addWorksheet('B03 Expenditure Review');s.getRow(5).values=expenseHeaders;return s;};
const row=(group,tb)=>['2026-10-01','DIRECT-01','Fictional supplier','2026-09-21','Direct','02-OPEX',2,group,100,'Standard',tb,'eTIMS source','Example reviewer','Review','Approved'];
const parse=(s,i,acc)=>{const t=detectTemplate(s),b=t.blocks[0],v=templateRow(s,i,t,b);return v&&normalizeTemplate(v,t,b,'2026-10-01','2026-10-31',acc);};
test('an expenditure workbook row with a recognised P&L group and a matching TB code carries a suggested pair',()=>{
 const s=sheet();s.getRow(6).values=row('Operating expenditure','61000');
 const n=parse(s,6,accounts);assert.deepEqual(n.issues,[]);assert.equal(n.row.routing_code,'EXP01');assert.equal(n.row.tb_code,'61000');assert.equal(n.row.mapping_suggestion.account_code,'61000');assert.equal(n.row.mapping_suggestion.confirmed,false);
 assert.equal(n.route,2);assert.equal(n.category_code,'EXP01');
 assert.ok(rowWarnings({dataset:'Expenditure',normalized:n.row,review_details:{}}).some(w=>/Upload suggests route 2 and TB account 61000/.test(w)));
});
test('a mismatched or unknown pair keeps the row importable and shows the reason; a group with no TB code still carries the category',()=>{
 const s=sheet();s.getRow(6).values=row('Administrative expenditure','61000');s.getRow(7).values=row('Operating expenditure','');s.getRow(8).values=row('Something unrecognised','61000');s.getRow(9).values=row('','');
 const a=parse(s,6,accounts);assert.deepEqual(a.issues,[]);assert.equal(a.row.mapping_suggestion,undefined);assert.match(a.row.mapping_suggestion_issue,/uses routing code EXP01/);
 const b=parse(s,7,accounts);assert.equal(b.row.routing_code,'EXP01');assert.equal(b.row.mapping_suggestion_issue,undefined);
 const c=parse(s,8,accounts);assert.equal(c.row.routing_code,undefined);assert.match(c.row.mapping_suggestion_issue,/TB code alone/);
 const d=parse(s,9,accounts);assert.equal(d.row.routing_code,undefined);assert.equal(d.row.mapping_suggestion_issue,undefined);
});
test('without the account list nothing is suggested and the pair is reported, so an older caller cannot map by accident',()=>{
 const s=sheet();s.getRow(6).values=row('Operating expenditure','61000');
 const n=parse(s,6);assert.equal(n.row.mapping_suggestion,undefined);assert.match(n.row.mapping_suggestion_issue,/not an account in the master chart/);
});
test('purchase workbooks are unchanged: no routing code is added to B02 rows',async()=>{
 const {purchaseHeaders}=await import('./workbook_templates.test.mjs');
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('B02A Purchases 16%');s.getRow(5).values=['VAT CLAIM MONTH 10','2026-10-01'];s.getRow(6).values=purchaseHeaders;
 s.getRow(7).values=['Local','P000000001A','Fictional supplier','2026-10-03','TEST-CU-001','Paper','',100,16,{formula:'H7+I7',result:116},2,'02-OPEX','61000','Operating expenditure','Approved','EXP01'];
 const t=detectTemplate(s),b=t.blocks[0],n=normalizeTemplate(templateRow(s,7,t,b),t,b,'2026-10-01','2026-10-31',accounts);assert.equal(n.row.routing_code,undefined);assert.equal(n.row.mapping_suggestion,undefined);
});
