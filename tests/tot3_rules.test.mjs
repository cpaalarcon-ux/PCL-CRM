import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const R=await import('../supabase/functions/staff-workspace-v12/tot3-rules.mjs');
const row=(inv,pin,name,desc,amount,date='2026-10-05',dataset='Purchases')=>({dataset,normalized:{invoice:inv,party_pin:pin,party:name,description:desc,amount,date}});
const client={kra_pin:'A000000001Z',legal_entity_type:'Sole proprietor'},c={starts_on:'2026-10-01',ends_on:'2026-10-31',amendment_no:0};
test('the TOT3 sheets follow the KRA section order and take turnover, rate and tax due from the locked case, not from this file',()=>{
 const t=R.tot3Sheets({rows:[row('I1','P000000002B','Supplier A','Stock',1000.5),row('I2','P000000003C','Supplier B','Packaging',200)],result:{gross_receipts:100000,rate:1.5,gross_tax:1500},c,client,partners:[]});
 assert.deepEqual(t.sheets.map(s=>s[0]),['A_Basic_Info','B_Details_of_Purchases','C_TOT_Payment_Credits','D_Tax_Due']);
 const D=t.sheets[3][2];assert.equal(D[0][2],1200.5);assert.equal(D[1][2],100000);assert.equal(D[2][2],1.5);assert.equal(D[3][2],1500);assert.equal(D[4][2],'Enter from iTax');
 assert.deepEqual(t.sheets[0][2].slice(0,5).map(x=>x[1]),['A000000001Z','ORIGINAL','01/10/2026','31/10/2026','No']);
 const other=R.tot3Sheets({rows:[],result:{gross_receipts:100000,rate:3,gross_tax:3000},c,client,partners:[]});assert.equal(other.sheets[3][2][2][2],3,'a different rule gives a different rate with no code change');
 assert.ok(t.issues.some(i=>/Enter them from iTax/.test(i)));assert.ok(!t.issues.some(i=>/does not equal/.test(i)));
});
test('missing supplier details, long fields, the taxpayer\'s own PIN and a wrong tax figure are listed, not filled in',()=>{
 const t=R.tot3Sheets({rows:[row('I1','','Supplier A','Stock',100),row('I2','A000000001Z','Me','x'.repeat(201),5)],result:{gross_receipts:1000,rate:1.5,gross_tax:99},c,client,partners:[]});
 assert.ok(t.issues.some(i=>/I1: PIN of Supplier is required/.test(i)));assert.ok(t.issues.some(i=>/longer than 200/.test(i)));assert.ok(t.issues.some(i=>/own PIN/.test(i)));assert.ok(t.issues.some(i=>/does not equal turnover times the rate/.test(i)));
 assert.equal(R.tot3Sheets({rows:[],result:{},c,client}).issues.some(i=>/no turnover, rate or tax due/.test(i)),true);
});
test('daily summaries and sales rows are not listed as purchases; an amended case says AMENDED; a partnership asks for Section E',()=>{
 const t=R.tot3Sheets({rows:[{...row('S','P1','x','d',50),is_period_summary:true},row('I3','P2','S','d',10,'2026-10-02','Sales')],result:{gross_receipts:0,rate:1.5,gross_tax:0},c:{...c,amendment_no:1},client:{...client,legal_entity_type:'Partnership'},partners:[]});
 assert.equal(t.counts.purchases,0);assert.equal(t.sheets[0][2][1][1],'AMENDED');assert.ok(t.issues.some(i=>/partnership/.test(i)));
 const p=R.tot3Sheets({rows:[],result:{gross_receipts:1000,rate:1.5,gross_tax:15},c,client:{...client,legal_entity_type:'Partnership'},partners:[{pin:'P1',name:'A',ratio:60},{pin:'P2',name:'B',ratio:40}]});
 assert.deepEqual(p.sheets.at(-1)[2].map(r=>r[3]),[9,6]);
});
test('the export is wired: server format, button for a locked TOT case and the download handler',()=>{
 assert.match(rd('supabase/functions/staff-workspace-v12/suite-export.ts'),/format==='tot3'/);assert.match(rd('supabase/functions/staff-workspace-v12/tot3-export.ts'),/only available for a Turnover Tax case/);
 const ui=rd('staff-suite.mjs');assert.match(ui,/c\.kind==='TOT'&&\['Locked','Filed'\]/);assert.match(ui,/action==='tax-tot3'/);
});
