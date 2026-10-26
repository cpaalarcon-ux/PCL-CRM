import test from 'node:test';import assert from 'node:assert/strict';
import {detectImportProfile,profilePurchase,salesTotals,payrollRows} from '../supabase/functions/staff-workspace-v6/import-profiles.mjs';
const sheet=(name,rows)=>({name,rowCount:rows.length,columnCount:Math.max(...rows.map(r=>r.length)),getRow:i=>({getCell:c=>({value:rows[i-1]?.[c-1]??null})})});
test('KRA profiles retain first row, invoice rather than CU serial, signed credits and tax category',()=>{
 const s=sheet('SEC_F_WITH_VAT_PIN1.CSV',[['Local','A000000000A','Supplier','02/10/2026','INV-001','Goods','',1000,'','',''],['Local','A000000000A','Supplier','03/10/2026','CN-001','Credit','',-100,'','INV-001','02/10/2026']]);
 const p=detectImportProfile(s);assert.equal(p.header_row,0);assert.equal(p.dataset,'Purchases');assert.equal(p.vat_category,'16%');const r=profilePurchase(s.getRow(2)?Array.from({length:11},(_,i)=>s.getRow(2).getCell(i+1).value):[],p,'2026-10-01','2026-10-31');assert.equal(r.row.invoice,'CN-001');assert.equal(r.row.original_invoice,'INV-001');assert.equal(r.row.original_invoice_date,'2026-10-02');assert.equal(r.row.amount,-100);assert.equal(r.row.vat,-16);assert.match(r.row.vat_basis,/Calculated/);
 const changed=sheet(s.name,[['Local','A000000000A','Supplier','02/10/2026','INV-001','Goods','',1000]]);assert.equal(detectImportProfile(changed).recognised,false);
 const e=sheet('SEC_E_WITH_VAT_PIN1.CSV',[['A000000000A','','CU-000','01/10/2026','INV1','Goods',100]]);assert.equal(detectImportProfile(e).dataset,'Sales');assert.equal(detectImportProfile(e).vat_category,'Exempt');
});
test('Sales aggregate credit notes once, deduplicate, preserve zero/exempt and reject mixed coverage sources',()=>{
 const b=sheet('SEC_B_WITH_VAT_PIN1.CSV',[['A000000000A','','CU-000','01/10/2026','INV1','Goods',1000,'','',''],['A000000000A','','CU-000','02/10/2026','CN1','Credit',-100,'','INV1','01/10/2026'],['A000000000A','','CU-000','01/10/2026','INV1','Goods',1000,'','','']]);
 const e=sheet('SEC_E_WITH_VAT_PIN1.CSV',[['A000000000A','','CU-000','01/10/2026','INV2','Goods',200]]);
 const inputs=[b,e].map(sheet=>({sheet,profile:detectImportProfile(sheet)})),out=salesTotals(inputs,'2026-10-01','2026-10-31');assert.deepEqual(out.issues,[]);assert.equal(out.groups[0].net,900);assert.equal(out.groups[0].vat,144);assert.equal(out.groups[0].credit_net,100);assert.equal(out.groups[3].net,200);assert.equal(out.groups[2].net,0);assert.equal(out.duplicate_count,1);
 const t=sheet('totals.csv',[['Sales category','Net sales','Output VAT'],['16%',900,144]]);assert.equal(detectImportProfile(t).summary,true);assert.match(salesTotals([...inputs,{sheet:t,profile:detectImportProfile(t)}],'2026-10-01','2026-10-31').issues[0],/cannot be added/);
});
test('Payroll recognises populated headers, retains missing PIN and missing values as exceptions',()=>{
 const p=sheet('Payroll.xlsx',[['Client'],[],['Employee name','KRA PIN','Gross pay','Taxable pay','PAYE deduction','Net amount'],['Staff A','A000000000A',100000,'',20000,80000],['Staff B','',30000,27000,'',27000],['TOTAL','',130000,27000,20000,107000]]),profile=detectImportProfile(p),out=payrollRows(p,profile);assert.equal(profile.header_row,3);assert.equal(out.rows.length,2);assert.equal(out.rows[0].taxable,null);assert.match(out.issues.join(' '),/PIN/);assert.equal(out.rows[1].paye,null);
});
test('only original invoice number and date are needed to link signed purchase credits in every VAT category',()=>{
 const headers=['Invoice date','Invoice number','Supplier PIN','Supplier name','Net amount','VAT amount','VAT category','Original invoice number','Original invoice date'];
 for(const [rate,vat] of [['16%',-16],['8%',-8],['0%',0],['Exempt',0]]){
  const values=['03/10/2026','CN-001','A000000000A','Supplier',-100,vat,rate,'0000123','24/09/2026'],s=sheet('Purchases.csv',[headers,values]),p=detectImportProfile(s),n=profilePurchase(values,p,'2026-10-01','2026-10-31');
  assert.deepEqual(n.issues,[]);assert.equal(n.row.original_invoice,'0000123');assert.equal(n.row.original_invoice_date,'2026-09-24');assert.equal(n.row.document_type,'Credit note');assert.equal(n.row.vat_category,rate);assert.equal(n.row.amount,-100);assert.equal(n.row.vat,vat);
 }
});
test('normal purchases leave original invoice fields blank',()=>{
 const values=['03/10/2026','INV-001',100,16,'',''],s=sheet('Purchases.csv',[['Invoice date','Invoice number','Net amount','VAT amount','Original invoice number','Original invoice date'],values]),n=profilePurchase(values,detectImportProfile(s),'2026-10-01','2026-10-31');
 assert.deepEqual(n.issues,[]);assert.equal(n.row.original_invoice,'');assert.equal(n.row.original_invoice_date,null);assert.equal(n.row.document_type,'Invoice');
});
test('invalid or later original invoice dates are exceptions while earlier periods are allowed',()=>{
 for(const date of ['31/09/2026','04/10/2026']){
  const values=['03/10/2026','CN-001',-100,-16,'INV-001',date],s=sheet('Purchases.csv',[['Invoice date','Invoice number','Net amount','VAT amount','Original invoice number','Original invoice date'],values]),n=profilePurchase(values,detectImportProfile(s),'2026-10-01','2026-10-31');assert.match(n.issues.join(' '),/Original invoice date/);
 }
});
