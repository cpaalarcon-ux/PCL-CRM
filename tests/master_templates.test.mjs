// The firm's own upload templates are used exactly as they are (attached 14 Nov 2026). These tests use the headings of those files.
import test from 'node:test';import assert from 'node:assert/strict';
import {detectTemplate,templateRow,normalizeTemplate,rowWarnings,legalCategories} from '../supabase/functions/staff-workspace-v12/workbook-templates.mjs';
const sheet=(name,rows)=>({name,rowCount:rows.length,columnCount:Math.max(...rows.map(r=>r.length)),getRow:i=>({getCell:c=>({value:rows[i-1]?.[c-1]??null})})});
const d09Top=['Month incurred','Source','Payee / bank','Statement reference','Description','Legal category','Tax treatment','Gross amount','Review status'];
const d09Input=['Month incurred','Payee / supplier','PIN / country','Date','Document reference','Description','Legal non-eTIMS category','Gross amount','Input VAT claim','Legal basis / evidence','Return code','TB code','Tax treatment','Reviewer','Evidence file / reference','Review status'];
const d09=()=>{const rows=Array.from({length:21},()=>[]);rows[0]=['D09 — NON-eTIMS EXPENDITURE & EXCEPTIONS'];rows[4]=d09Top;rows[5]=['2026-10-01','Banking test','Financial institution','',' Bank charges','Financial-institution fee','No input VAT','', 'No bank charge entered'];
 rows[19]=['MANUAL NON-eTIMS CONTROLLED INPUT — SUPPORTED EXCEPTIONS ONLY'];rows[20]=d09Input;
 rows.push(['2026-10-01','Safaricom Ltd','P000000001A','2026-10-03','BANKCHG-01','Bank charges Oct','Financial-institution fee',1200,0,'Bank statement; no eTIMS invoice','02-OPEX','51070','No input VAT','Reviewer A','EV-001','']);
 rows.push(['2026-10-01','Kenya Airways','KE','2026-10-09','TKT-889','Staff ticket','Passenger ticket',45000,'','','','','','','','']);
 rows.push([],[]);return sheet('D09 Non-eTIMS Expenditure',rows);};
test('manual non-eTIMS workbook (D09, 16 columns) is read from its controlled input block, not the linked bank-charge block above it',()=>{
 const s=d09(),t=detectTemplate(s);assert.equal(t.kind,'D09');assert.equal(t.dataset,'Non-eTIMS');assert.equal(t.blocks.length,1);assert.equal(t.blocks[0].header_row,21);assert.equal(t.blocks[0].first_row,22);
 const rows=[];for(let i=t.blocks[0].first_row;i<=s.rowCount;i++){const v=templateRow(s,i,t,t.blocks[0]);if(v)rows.push(normalizeTemplate(v,t,t.blocks[0],'2026-10-01','2026-10-31'));}
 assert.equal(rows.length,2);assert.deepEqual(rows[0].issues,[]);assert.equal(rows[0].row.legal_category,'Financial-institution fee');assert.equal(rows[0].row.amount,1200);assert.equal(rows[0].row.evidence,'EV-001');
 assert.ok(legalCategories.includes(rows[0].row.legal_category)&&legalCategories.includes(rows[1].row.legal_category));
 // Nothing is approved by the file: the reviewer name and the return code are source evidence only, and gaps are flagged.
 const warn=rowWarnings({dataset:'Non-eTIMS',normalized:rows[1].row,review_details:{}});assert.ok(warn.some(w=>/Missing legal basis/.test(w)));assert.ok(warn.some(w=>/Missing receipt/.test(w)));assert.ok(warn.some(w=>/Tax reviewer confirmation required/.test(w)));
 assert.equal(rows[0].category_code,null);
});
