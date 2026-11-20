import test from 'node:test';import assert from 'node:assert/strict';
const {vat3File}=await import('../supabase/functions/staff-workspace-v12/vat3-export.ts');
const ExcelJS=(await import('exceljs')).default;
const rows=[
 {dataset:'Sales',decision:'Confirmed',vat_rate_key:'KE_VAT_STANDARD',normalized:{invoice:'S1',date:'2026-09-05',party:'Fictional Duka Ltd',party_pin:'P000000001A',amount:1500,vat:240}},
 {dataset:'Sales',decision:'Confirmed',vat_rate_key:'KE_VAT_ZERO',normalized:{invoice:'S2',date:'2026-09-06',party:'Fictional Exporter',amount:300,vat:0}},
 {dataset:'Purchases',decision:'Eligible',deductible_percentage:100,vat_rate_key:'KE_VAT_STANDARD',normalized:{invoice:'P1',date:'2026-09-07',party:'Fictional Supplier',amount:2500,vat:400}}];
const result={output:240,eligible_input:400,opening_credit:0,withholding_credit:0,reverse_charge:0,adjustments:0,net:-160,payable:0,carry_forward:160};
const c={case_id:'11111111-2222-3333-4444-555555555555',kind:'VAT',status:'Locked',starts_on:'2026-09-01',ends_on:'2026-09-30',reviewed_by:'m',inputs:{}},client={company_name:'Fictional Mlima Traders',kra_pin:'P000000000Z'},names=new Map([['m','Fictional Manager']]);
test('VAT3 schedules export only from a locked VAT case',async()=>{
 await assert.rejects(()=>vat3File({...c,status:'Draft'},client,names,rows,result,false),/locked the VAT case/);
 await assert.rejects(()=>vat3File({...c,kind:'Company'},client,names,rows,result,true),/only available for a VAT case/);
 await assert.rejects(()=>vat3File(c,client,names,rows,{...result,testing_only:true},true),/testing rate/);
});
test('the workbook has the schedules and agrees to the case result',async()=>{
 const f=await vat3File(c,client,names,rows,result,true);
 assert.match(f.name,/^VAT3_Schedules_2026-09-01_2026-09-30_11111111\.xlsx$/);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(f.bytes));
 const names2=book.worksheets.map(w=>w.name);
 for(const n of ['Start Here','B Sales at the standard rate','C Zero-rated sales','F Local purchases standard','M-O Summary'])assert.ok(names2.includes(n),n+' is present: '+names2.join(', '));
 const b=book.getWorksheet('B Sales at the standard rate');assert.equal(b.getRow(2).getCell(4).value,'S1');assert.equal(Number(b.getRow(3).getCell(7).value),240,'total row');
 assert.match(book.getWorksheet('Start Here').getSheetValues().flat().join('|'),/Schedules agree to the tax case/);
 const bad=await vat3File(c,client,names,rows,{...result,output:100},true),b2=new ExcelJS.Workbook();await b2.xlsx.load(Buffer.from(bad.bytes));
 assert.match(b2.getWorksheet('Start Here').getSheetValues().flat().join('|'),/REVIEW REQUIRED/);
});
