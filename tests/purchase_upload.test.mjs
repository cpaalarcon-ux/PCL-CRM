import test from 'node:test';import assert from 'node:assert/strict';
import {money} from '../supabase/functions/staff-workspace-v12/workspace-rules.mjs';
import {purchaseDisplayValues,purchaseUploadHeaders,purchaseUploadLegacyHeaders,purchaseUploadMap,purchaseUploadProfile,purchaseUploadRows,normalizePurchaseUpload,purchaseUploadSummary,importRowRange,purchaseUploadValues} from '../supabase/functions/staff-workspace-v12/purchase-upload.mjs';
const sheet=rows=>({name:'Purchase Upload',rowCount:rows.length,columnCount:Math.max(...rows.map(r=>r.length)),getRow:i=>({getCell:c=>({value:rows[i-1]?.[c-1]??null})})});
const row=()=>['Local','P000000001A','Example supplier','2026-10-03','0000123','Supplies','',100,16,116,'','','',''];
test('fixed template validates header order but imports only row two onwards, skipping blanks',()=>{
 const s=sheet([purchaseUploadHeaders,[],row(),Array(12).fill('')]);const p=purchaseUploadProfile(s);assert.equal(p.header_row,1);assert.deepEqual(p.column_map,purchaseUploadMap);const data=purchaseUploadRows(s);assert.equal(data.rows.length,1);assert.equal(data.rows[0].source_row,3);assert.equal(data.ignored,2);
 const swapped=[...purchaseUploadHeaders];[swapped[7],swapped[8]]=[swapped[8],swapped[7]];assert.throws(()=>purchaseUploadProfile(sheet([swapped,row()])),/Column H/);
 assert.throws(()=>purchaseUploadProfile(sheet([[...purchaseUploadHeaders,'Account code'],row()])),/14 columns/);
});
test('updated template accepts the legacy 12-column upload but uses M and N for checked account suggestions',()=>{
 const legacy=sheet([purchaseUploadLegacyHeaders,row().slice(0,12)]);assert.equal(purchaseUploadProfile(legacy).version,1);
 const v=row();v[12]='EXP02';v[13]='61000';const accounts=[{code:'61000',name:'Office expense',route:2,category_code:'EXP02',status:'Active',is_legacy:false}];
 const n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31',accounts);assert.deepEqual(n.issues,[]);assert.deepEqual(n.row.mapping_suggestion,{route:2,category_code:'EXP02',account_code:'61000',confirmed:false});
 v[12]='PPE10B';const mismatch=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31',accounts);assert.equal(mismatch.row.mapping_suggestion,undefined);assert.match(mismatch.row.mapping_suggestion_issue,/does not match/);assert.deepEqual(mismatch.issues,[]);
 v[12]='';assert.match(normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31',accounts).row.mapping_suggestion_issue,/both ERP routing code/);
});
test('decimal money rounds half away from zero without rejecting Excel floating tails',()=>{
 for(const [input,expected] of [[7126.9728000000005,7126.97],['10912.478400000002',10912.48],['1.005',1.01],[-1.005,-1.01],['(1,234.565)',-1234.57],[1e-7,0],['0',0],[-0,0]])assert.equal(money(input),expected);
 for(const input of ['',null,true,NaN,Infinity,new Date(),{},'1,23','12 EUR','1e3',1e12])assert.equal(money(input),null);
});
test('net, VAT and gross are fixed numeric columns, source amounts retained and gross reconciled',()=>{
 const v=row();v[7]=44543.58;v[8]=7126.9728000000005;v[9]=51670.552800000005;let n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.deepEqual(n.issues,[]);assert.equal(n.row.amount,44543.58);assert.equal(n.row.vat,7126.97);assert.equal(n.row.gross,51670.55);assert.equal(n.raw['9: VAT amount'],7126.9728000000005);assert.ok(n.row.rounded_fields.includes('vat'));assert.equal(n.route,null);assert.equal(n.category_code,null);
 v[9]=60000;n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.match(n.issues.join(' '),/Column J/);v[8]='';n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.match(n.issues.join(' '),/Column I/);assert.equal(n.row.vat,null);
});
test('zero-rated and exempt remain distinct ERP choices without an extra spreadsheet column',()=>{
 for(const rate of ['0%','Exempt']){const v=row();v[8]=0;v[9]=100;const n=normalizePurchaseUpload(v,rate,'2026-10-01','2026-10-31');assert.deepEqual(n.issues,[]);assert.equal(n.row.vat_category,rate);assert.equal(n.row.vat,0);}
 assert.throws(()=>normalizePurchaseUpload(row(),'','2026-10-01','2026-10-31'),/Select the VAT category/);
 assert.match(normalizePurchaseUpload(row(),'Exempt','2026-10-01','2026-10-31').issues.join(' '),/VAT must be zero/);
 assert.match(normalizePurchaseUpload(row(),'8%','2026-10-01','2026-10-31').issues.join(' '),/selected category/);
});
test('credit notes require original details, preserve signs and permit prior-period original dates',()=>{
 const v=row();v[3]='2026-10-10';v[4]='CN-001';v[7]=-100;v[8]=-16;v[9]=-116;let n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.deepEqual(n.issues,[]);assert.match(n.pending.join(' '),/Column K/);assert.match(n.pending.join(' '),/Column L/);
 v[10]='0000123';v[11]='24/09/2026';n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.deepEqual(n.issues,[]);assert.equal(n.row.original_invoice_date,'2026-09-24');assert.equal(n.row.amount,-100);assert.equal(n.row.document_type,'Credit note');assert.equal(n.row.return_month,'2026-10-01');v[8]=16;assert.match(normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31').issues.join(' '),/same sign/);
});
test('invoice dates remain separate from selected claim period and source identifiers stay text',()=>{
 const v=row();v[3]='2026-09-10';assert.deepEqual(normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31').issues,[]);v[3]='2026-11-01';assert.match(normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31').issues.join(' '),/period end/);v[4]=123;assert.match(normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31').issues.join(' '),/as text/);
});
test('row limit counts populated transactions, not blank template space or the header',()=>{
 const rows=[purchaseUploadHeaders,...Array.from({length:10000},()=>row()),...Array.from({length:500},()=>[])];assert.equal(purchaseUploadRows(sheet(rows)).rows.length,10000);rows.push(row());assert.throws(()=>purchaseUploadRows(sheet(rows)),/10,001 populated purchase rows/);
});
test('range errors state the actual cause and accept exactly 10000 data rows',()=>{
 assert.deepEqual(importRowRange({header:1,first:2,last:10001,rowCount:10001}),{first:2,last:10001});
 for(const [args,pattern] of [[{first:1,last:3},/after header/],[{first:5,last:4},/before the first/],[{first:2,last:21},/ends at row 20/],[{first:2.5,last:5},/whole numbers/],[{first:2,last:15,block:{first_row:10,last_row:20}},/monthly section/]])assert.throws(()=>importRowRange({header:1,rowCount:20,...args}),pattern);
});
test('review totals exclude rejected rows visibly and distinguish zero rows from blank rows',()=>{
 const good=row(),bad=row();bad[9]=200;const s=sheet([purchaseUploadHeaders,good,[],bad]);const summary=purchaseUploadSummary(purchaseUploadRows(s).rows,'16%','2026-10-01','2026-10-31');assert.equal(summary.source_count,2);assert.equal(summary.rejected_count,1);assert.equal(summary.valid_count,1);assert.equal(summary.net,100);assert.equal(summary.vat,16);assert.equal(summary.gross,116);assert.equal(summary.issues[0].row,4);
});

test('optional blanks and N/A are missing values only in optional columns',()=>{
 for(const value of ['', 'N/A',' n/a ','NA','Not applicable','—','-']){const v=row();v[6]=v[10]=v[11]=value;const n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.deepEqual(n.issues,[]);assert.deepEqual(n.pending,[]);assert.equal(n.row.customs_entry,'');assert.equal(n.row.original_invoice,'');}
 const v=row();v[8]='N/A';assert.match(normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31').issues.join(' '),/Column I/);
 v[7]=-100;v[8]=-16;v[9]=-116;v[10]=v[11]='N/A';let n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.equal(n.pending.length,2);assert.deepEqual(n.issues,[]);assert.equal(n.raw['11: Original invoice number'],'N/A');v[11]='invalid-date';n=normalizePurchaseUpload(v,'16%','2026-10-01','2026-10-31');assert.match(n.issues.join(' '),/Column L/);
});
test('whole-file and pending totals preserve signed credits without disguising missing numbers',()=>{
 const credit=row();credit[4]='CN-PENDING';credit[7]=-100;credit[8]=-16;credit[9]=-116;
 const records=[{source_row:2,values:row()},{source_row:3,values:credit}],s=purchaseUploadSummary(records,'16%','2026-10-01','2026-10-31');
 assert.equal(s.pending_count,1);assert.equal(s.valid_count,1);assert.equal(s.rejected_count,0);assert.deepEqual(s.pending_totals,{net:-100,vat:-16,gross:-116});assert.deepEqual(s.source_totals,{net:0,vat:0,gross:0,complete:true});assert.equal(s.gross,116);assert.equal(s.pending_issues[0].row,3);
 credit[8]='';assert.equal(purchaseUploadSummary(records,'16%','2026-10-01','2026-10-31').source_totals.complete,false);
});
test('standard purchase dates display as calendar dates and preserve text references',()=>{
 const v=row();v[3]=46030;v[11]='46043';const shown=purchaseDisplayValues(v);assert.equal(shown[3],'08/01/2026');assert.equal(shown[11],'21/01/2026');assert.equal(shown[4],'0000123');assert.equal(v[3],46030);
});
const srcHeaders=['TYPE OF PURCHASE','PIN OF PURCHASER','NAME OF PURCHASER','INVOICE DATE','INVOICE NO.','DESCRIPTION OF GDS/SRVS','CUSTOM ENTRY NUMBER','TAXABLE VALUE','RELV INV NUMBER','RELV INV DATE','ROUTING CODE','T.B CODE'];
const srcSheet=(rows,name='Sheet2')=>({...sheet(rows),name});
test('firm source purchase layout (title row, headings on row 2, net only) is recognised for every VAT category and VAT is calculated',()=>{
 const s=srcSheet([['General rated purchase source layout | source workbook uses header row 2'],srcHeaders,['Local','P000000001A','Supplier','2026-10-03','INV-1','Goods','',1000,'','','','EXP02','61000'],[],['Local','P000000001A','Supplier','2026-10-04','INV-2','Goods','',250.5,'','','','','']]);
 const p=purchaseUploadProfile(s);assert.equal(p.recognised,true);assert.equal(p.source_layout,true);assert.equal(p.header_row,2);assert.equal(p.derive_vat,true);assert.deepEqual(p.column_map,purchaseUploadMap);
 const data=purchaseUploadRows(s,p);assert.equal(data.rows.length,2);assert.equal(data.rows[0].source_row,3);assert.equal(data.derive_vat,true);assert.equal(data.rows[0].values.length,14);assert.equal(data.rows[0].values[7],1000);
 let n=normalizePurchaseUpload(data.rows[0].values,'16%','2026-10-01','2026-10-31',[],undefined,true);assert.deepEqual(n.issues,[]);assert.equal(n.row.vat,160);assert.equal(n.row.gross,1160);assert.equal(n.row.vat_basis,'Calculated from the selected category rate');
 n=normalizePurchaseUpload(data.rows[1].values,'8%','2026-10-01','2026-10-31',[],undefined,true);assert.deepEqual(n.issues,[]);assert.equal(n.row.vat,20.04);assert.equal(n.row.gross,270.54);
 for(const rate of ['0%','Exempt']){n=normalizePurchaseUpload(data.rows[0].values,rate,'2026-10-01','2026-10-31',[],undefined,true);assert.deepEqual(n.issues,[]);assert.equal(n.row.vat,0);assert.equal(n.row.gross,1000);assert.equal(n.row.vat_category,rate);}
 const summary=purchaseUploadSummary(data.rows,'16%','2026-10-01','2026-10-31',[],undefined,true);assert.equal(summary.rejected_count,0);assert.equal(summary.net,1250.5);assert.equal(summary.vat,200.08);
});
test('source layout: credit notes use RELV INV columns, the zero-rated variant has no customs column, and nothing is assumed when type is blank',()=>{
 const zero=['TYPE OF PURCHASE','PIN OF PURCHASER','NAME OF PURCHASER','INVOICE DATE','INVOICE NO.','DESCRIPTION OF GDS/SRVS','TAXABLE VALUE','RELV INV NUMBER','RELV INV DATE','ROUTING CODE','T.B CODE'];
 const s=srcSheet([['Zero rated'],zero,['Local','P000000001A','Supplier','2026-10-10','CN-1','Return','',-100,'',''].slice(0,6).concat([-100,'0000123','2026-09-24','','']),['','P000000001A','Supplier','2026-10-11','INV-3','Goods',50,'','','','']]);
 const p=purchaseUploadProfile(s);assert.equal(p.header_row,2);const rows=purchaseUploadRows(s,p).rows;
 let n=normalizePurchaseUpload(rows[0].values,'0%','2026-10-01','2026-10-31',[],undefined,true);assert.deepEqual(n.issues,[]);assert.equal(n.row.amount,-100);assert.equal(n.row.original_invoice,'0000123');assert.equal(n.row.original_invoice_date,'2026-09-24');assert.equal(n.row.document_type,'Credit note');assert.deepEqual(n.pending,[]);
 n=normalizePurchaseUpload(rows[1].values,'0%','2026-10-01','2026-10-31',[],undefined,true);assert.match(n.issues.join(' '),/Local or Import/);
});
test('files that are neither the 14-column template nor the source layout are still refused when the standard upload is chosen',()=>{
 assert.equal(purchaseUploadProfile(srcSheet([['a','b'],['c','d']])),null);
 assert.throws(()=>purchaseUploadProfile(srcSheet([['a','b'],['c','d']]),true),/Column A/);
});
