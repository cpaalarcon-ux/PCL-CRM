// Build 2801: every template under Resources is a real, clean file that the matching ERP importer recognises.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import ExcelJS from '../supabase/functions/staff-workspace-v6/node_modules/exceljs/excel.js';
import {readWorkbookSheet} from '../supabase/functions/staff-workspace-v12/workbook-reader.mjs';
import {detectImportProfile,payrollRows} from '../supabase/functions/staff-workspace-v12/import-profiles.mjs';
import {purchaseUploadProfile} from '../supabase/functions/staff-workspace-v12/purchase-upload.mjs';
import {detectTemplate} from '../supabase/functions/staff-workspace-v12/workbook-templates.mjs';
import {readBankInputs,computeBankTotals} from '../supabase/functions/staff-workspace-v12/bank-totals-rules.mjs';
import {TEMPLATES} from '../staff-resources.mjs';
import JSZip from '../supabase/functions/staff-workspace-v6/node_modules/jszip/lib/index.js';
const root=path.resolve(import.meta.dirname,'..'),bytes=async f=>new Uint8Array(await fs.readFile(path.join(root,f)));
const sheetNames=async b=>[...(await (await JSZip.loadAsync(b)).file('xl/workbook.xml').async('string')).matchAll(/<sheet [^>]*?name="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));
const byLabel=l=>TEMPLATES.find(t=>t.label===l).file;
test('every template listed under Resources exists, opens, has a purpose, and holds no client data',async()=>{
 assert.ok(TEMPLATES.length>=10);const areas=new Set(TEMPLATES.map(t=>t.area));for(const a of ['Opening balances','Sales','Purchases','Payroll','Bank','Clients'])assert.ok(areas.has(a),a);
 assert.equal(new Set(TEMPLATES.map(t=>t.file)).size,TEMPLATES.length,'no template is listed twice');
 for(const t of TEMPLATES){
  assert.match(t.file,/^\/(templates\/)?[A-Za-z0-9_]+\.xlsx$/);assert.ok(t.about.length>20,t.label);
  const b=await bytes(t.file),names=await sheetNames(b);assert.ok(names.length>=1,t.file);
  for(const n of names){const {sheet}=await readWorkbookSheet(b,n);for(let r=1;r<=Math.min(sheet.rowCount,700);r++)for(let c=1;c<=sheet.columnCount;c++){const v=sheet.getRow(r).getCell(c).value;if(typeof v==='string')assert.doesNotMatch(v,/\bP\d{9}[A-Z]\b|STEPEX|FICTIONAL|DEMO ONLY|AFRICA REAGE/i,`${t.file} ${n} r${r}c${c} carries sample or client data`);}}
 }
});
test('sales templates are recognised: net only (calculated VAT) and category totals',async()=>{
 const n=(await readWorkbookSheet(await bytes(byLabel('Sales update (net only)')),'Sales Update')).sheet;assert.equal(detectImportProfile(n).id,'SALES-NET-ONLY-v1');
 const c=(await readWorkbookSheet(await bytes(byLabel('Sales category totals')),'Sales Update')).sheet;assert.equal(detectImportProfile(c).id,'SALES-CATEGORIES-v3');
});
test('purchase templates: the standard 14 columns, and all four sheets of the firm\'s layout',async()=>{
 const std=(await readWorkbookSheet(await bytes(byLabel('Purchases (one template, all categories)')),'Purchase Upload')).sheet;assert.equal(purchaseUploadProfile(std,true).id,'PCL-PURCHASES-1');
 for(const name of ['Gen Purchase Upload','Other Purchase Upload','Zero Purchase Upload','Exempt Purchase Upload']){
  const s=(await readWorkbookSheet(await bytes('/templates/Purchases_Monthly_Four_Sheet_Template.xlsx'),name)).sheet,p=purchaseUploadProfile(s,false);
  assert.equal(p.source_layout,true,name);assert.equal(p.header_row,2,name);assert.equal(p.derive_vat,true);
 }
 const d=(await readWorkbookSheet(await bytes(byLabel('Non-eTIMS expenditure (D09)')),'D09 Non-eTIMS Expenditure')).sheet,t=detectTemplate(d);assert.equal(t.kind,'D09');assert.equal(t.blocks[0].header_row,4);
});
test('payroll template: the ERP reads its source and statutory columns, and PIN-less casuals still need their details',async()=>{
 const s=(await readWorkbookSheet(await bytes(byLabel('Monthly payroll')),'Payroll')).sheet,p=detectImportProfile(s);
 assert.equal(p.id,'PAYROLL-BREAKDOWN-v1');for(const k of ['taxable','paye','employee_nssf','employer_nssf','shif','employee_ahl','employer_ahl','employer_nita','resident','employment_type','phone','date_paid'])assert.ok(p.column_map[k],k);
 assert.equal(payrollRows(s,p).rows.length,0,'a blank template has no employees');
});
test('bank templates: the five-bank workbook is blank, keeps its reconciliation sheet, and reads as BANK INPUTS',async()=>{
 const b=await bytes(byLabel('Five-bank monthly totals and adjustments'));
 assert.deepEqual(await sheetNames(b),['BANK INPUTS','BANK RECONCILIATION']);
 const s=(await readWorkbookSheet(b,'BANK INPUTS')).sheet,r=readBankInputs(s);assert.equal(r.recognised,true);assert.deepEqual(r.issues,[]);
 assert.equal(r.adjustments.length,0);assert.equal(r.year,null,'the financial year is entered by the user');
 assert.equal(r.banks.length,5);assert.ok(r.banks.every(x=>x.code&&!x.name));
 const out=computeBankTotals(r,{year:2026});assert.match(out.issues.join(' '),/enter the bank name/i);
});
test('client import template keeps every heading and none of the sample clients',async()=>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(await bytes(byLabel('Client import')));const names=wb.worksheets.map(w=>w.name);
 for(const n of ['Client Import','Client Details','KYC Reviews','Contacts','Tax Obligations','Engagements'])assert.ok(names.includes(n),n);
 for(const n of names.filter(x=>!['Start Here','CRM Lists','Industry & Activities'].includes(x))){let filled=0;wb.getWorksheet(n).eachRow((row,i)=>{if(i>1)row.eachCell(c=>{if(c.value!==null&&c.value!==''&&c.value!==undefined)filled++;});});assert.equal(filled,0,n+' holds sample data');}
});
