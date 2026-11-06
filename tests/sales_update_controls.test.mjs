import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectImportProfile,salesTotals} from '../supabase/functions/staff-workspace-v12/import-profiles.mjs';
import {classifySalesCoverage} from '../supabase/functions/staff-workspace-v12/period-import-actions.ts';
import {readSourceSheet} from '../supabase/functions/staff-workspace-v12/source-reader.mjs';

const headers=['Month','Sales category','Net sales','Output VAT','Gross amount','Credits','Credit notes net','Credit notes VAT'];
const sheet=(name,rows)=>({name,rowCount:rows.length,columnCount:Math.max(...rows.map(r=>r.length)),getRow:i=>({getCell:c=>({value:rows[i-1]?.[c-1]??null})})});

test('the downloadable sales CSV is recognised by the production sales import profile',async()=>{
 const bytes=fs.readFileSync(new URL('../outputs/sales-update-v1/Sales_Update_Template.csv',import.meta.url));
 const read=await readSourceSheet(bytes,'Sales_Update_Template.csv',null),profile=detectImportProfile(read.sheet);
 assert.equal(profile.id,'SALES-CATEGORIES-v3');
 assert.equal(profile.summary,true);
 assert.equal(read.sheet.rowCount,1,'the controlled template starts blank; it cannot import sample totals by accident');
 assert.match(salesTotals([{sheet:read.sheet,profile}],'2026-11-01','2026-11-06').issues.join(' '),/No sales values found/);
});

test('the sales screen links to the same controlled file and separates source and coverage inputs',()=>{
 const ui=fs.readFileSync(new URL('../staff-period-imports.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(ui,/href="\/outputs\/sales-update-v1\/Sales_Update_Template\.csv" download/);
 assert.match(ui,/select\('source_type','Sales source \*'/);
 assert.match(ui,/Reporting period starts \*/);assert.match(ui,/Reporting period ends \*/);
 assert.match(ui,/Weekly and month-to-date updates are comparison-only/);
 assert.match(ui,/higher gross of eTIMS and Z\/POS is used only as the bank-comparison benchmark/);
 assert.match(css,/a\.button\{display:inline-block/);
});

test('summary totals require all four categories and the credit split must agree to Credits',()=>{
 const valid=sheet('Sales Update',[headers,['2026-11','16%',1000,160,1160,116,100,16],['2026-11','8%',0,0,0,0,0,0],['2026-11','0%',0,0,0,0,0,0],['2026-11','Exempt',0,0,0,0,0,0]]),profile=detectImportProfile(valid),out=salesTotals([{sheet:valid,profile}],'2026-11-01','2026-11-06');
 assert.deepEqual(out.issues,[]);
 assert.equal(out.groups[0].file_credit_net,100);
 assert.equal(out.groups[0].file_credit_vat,16);
 const missing=sheet('Sales Update',[headers,['2026-11','16%',1000,160,1160,116,100,16]]);
 assert.ok(salesTotals([{sheet:missing,profile:detectImportProfile(missing)}],'2026-11-01','2026-11-06').issues.some(x=>x.includes('Add a 8% row')));
 const wrongCredits=sheet('Sales Update',[headers,['2026-11','16%',1000,160,1160,117,100,16],['2026-11','8%',0,0,0,0,0,0],['2026-11','0%',0,0,0,0,0,0],['2026-11','Exempt',0,0,0,0,0,0]]);
 assert.ok(salesTotals([{sheet:wrongCredits,profile:detectImportProfile(wrongCredits)}],'2026-11-01','2026-11-06').issues.some(x=>x.includes('Credits and split')));
});

test('coverage rules distinguish weekly, month-to-date, month-final and complete historical uploads',()=>{
 assert.equal(classifySalesCoverage('2026-11-02','2026-11-06','2026-11-06'),'WEEKLY');
 assert.equal(classifySalesCoverage('2026-11-01','2026-11-06','2026-11-06'),'MONTH_TO_DATE');
 assert.equal(classifySalesCoverage('2026-11-01','2026-11-30','2026-11-30'),'MONTH_FINAL');
 assert.equal(classifySalesCoverage('2026-10-01','2026-10-31','2026-11-06'),'HISTORICAL');
 assert.equal(classifySalesCoverage('2025-04-01','2026-03-31','2026-11-06',['2025-04-01|2026-03-31']),'HISTORICAL');
 assert.throws(()=>classifySalesCoverage('2026-11-01','2026-11-07','2026-11-06'),/future dates/);
 assert.throws(()=>classifySalesCoverage('2026-10-05','2026-10-31','2026-11-06'),/complete calendar month/);
});

test('obsolete category-only files do not pass the versioned sales template profile',()=>{
 const old=sheet('Old sales totals',[['Sales category','Net sales','Output VAT'],['16%',100,16]]);
 assert.equal(detectImportProfile(old),null);
});

test('source-aware sales migration preserves staging import-discard controls',()=>{
 const migration=fs.readFileSync(new URL('../supabase/migrations/20261106135331_source_aware_sales_period_imports.sql',import.meta.url),'utf8');
 assert.match(migration,/OLD\.status IN \('Superseded','Discarded'\)/);
 assert.match(migration,/NEW\.status='Discarded' AND OLD\.status IN \('Draft','Returned'\)/);
 assert.match(migration,/NEW\.status IN \('Superseded','Discarded'\) THEN DELETE FROM erp_private\.period_import_days/);
});
