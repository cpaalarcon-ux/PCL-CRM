import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import ExcelJS from '../supabase/functions/staff-workspace-v6/node_modules/exceljs/excel.js';
import {detectTemplate,templateRow,normalizeTemplate,monthIncurred,shown} from '../supabase/functions/staff-workspace-v12/workbook-templates.mjs';
// Build 2897: non-eTIMS import fixes. No VAT column read, a month name read against the period, and rejection messages that name the cell value.
const HEAD=['Month incurred','Payee / supplier','PIN / country','Date','Document reference','Description','Legal non-eTIMS category','Gross amount','Input VAT claim','Legal basis / evidence','Return code','TB code','Tax treatment','Reviewer','Evidence file / reference','Review status'];
const sheet=(...rows)=>{const w=new ExcelJS.Workbook(),s=w.addWorksheet('D09 Non-eTIMS Expenditure');s.getRow(4).values=HEAD;rows.forEach((r,i)=>{s.getRow(5+i).values=r;});return s;};
const parse=(s,i,start='2026-01-01',end='2026-01-31')=>{const t=detectTemplate(s),b=t.blocks[0],v=templateRow(s,i,t,b);return v&&normalizeTemplate(v,t,b,start,end);};
const good=(over={})=>{const r=['JANUARY','Fictional bank','Kenya','2026-01-14','CHG-0126','Bank charge','Bank charge',3500,'No','Bank charges, statement','','','','','','' ];Object.entries(over).forEach(([i,v])=>{r[i]=v;});return r;};

test('the Input VAT claim column is never read: No and Review are not rejected, and VAT is nil',()=>{
 const s=sheet(good({8:'No'}),good({8:'Review — confirm eligibility',4:'CHG-2'}),good({8:16,4:'CHG-3'}));
 for(const i of [5,6,7]){const r=parse(s,i);assert.deepEqual(r.issues,[],'row '+i);assert.equal(r.row.vat,0);assert.equal(r.row.amount,3500);assert.equal(r.raw['9: Input VAT claim']===undefined,false,'the original cell is kept in the raw source');}
 const t=detectTemplate(s);assert.equal('vat' in t.blocks[0].column_map,false);
});
test('a month name is read against the selected period',()=>{
 assert.equal(parse(sheet(good()),5).row.return_month,'2026-01-01');
 for(const v of ['Jan','january 2026','2026-01','1/2026'])assert.equal(monthIncurred(v,'2026-01-01','2026-01-31').value,'2026-01-01',v);
 assert.equal(monthIncurred('FEB','2026-01-01','2026-03-31').value,'2026-02-01');
 assert.equal(monthIncurred('DECEMBER','2025-07-01','2026-06-30').value,'2025-12-01','the year comes from the period');
 assert.equal(monthIncurred('2026-01-15','2026-01-01','2026-01-31').value,'2026-01-15','a date is read as before');
 assert.equal(monthIncurred('','2026-01-01','2026-01-31').value,'');
 const r=parse(sheet(good({0:'MARCH'})),5);assert.match(r.issues.join(' '),/Month incurred "MARCH" is outside the selected period \(2026-01-01 to 2026-01-31\)/);
 const w=parse(sheet(good({0:'soon'})),5);assert.match(w.issues.join(' '),/Month incurred "soon" is not a date or a month name/);
});
test('rejection messages name the value they could not read',()=>{
 const r=parse(sheet(good({7:'about 3,500',3:'14th Jan'})),5);const t=r.issues.join(' | ');
 assert.match(t,/Amount is missing or invalid \(read "about 3,500"\)/);assert.match(t,/date is missing or invalid \(read "14th Jan"\)/);
 assert.equal(shown(''),'(blank)');assert.equal(shown(null),'(blank)');assert.equal(shown('x'.repeat(50)).length,43);assert.equal(shown(new Date('2026-01-05T00:00:00Z')),'"2026-01-05"');assert.equal(shown(new Date('x')),'an invalid date');
 const old=parse(sheet(good({7:''})),5);assert.match(old.issues.join(' '),/Amount is missing or invalid \(read \(blank\)\)/);
});
test('the downloadable template says there is no VAT and accepts a month name',async()=>{
 const w=new ExcelJS.Workbook();await w.xlsx.readFile(new URL('../templates/Non_eTIMS_Manual_Template.xlsx',import.meta.url).pathname);
 const s=w.getWorksheet('D09 Non-eTIMS Expenditure'),head=s.getRow(4).values;
 assert.equal(head[9],'Input VAT (not used)');assert.match(String(s.getCell('A2').value),/No VAT applies/);assert.match(String(s.getCell('A2').value),/JANUARY/);
 const dv=Object.keys(s.dataValidations?.model||{});assert.equal(dv.some(k=>k.startsWith('I')),false,'the old No / Review dropdown on the VAT column is gone');
 const t=detectTemplate(s);assert.equal(t.kind,'D09');assert.equal(t.blocks[0].header_row,4);
 const read=w.getWorksheet('Read first'),text=read.getSheetValues().flat().map(String).join(' ');assert.match(text,/carries no VAT/);assert.match(text,/month name such as JANUARY/);
});
