import test from 'node:test';import assert from 'node:assert/strict';
const R=await import('../supabase/functions/staff-workspace-v12/kra-csv-rules.mjs');
const rowB=(pin,name,date,inv,net,vat,orig='')=>[pin,name,'CU1',date,inv,'Goods',net,vat,orig,''];
test('section is read from the KRA file name and each section has its own rate',()=>{
 assert.equal(R.sectionFromName('PIN_SEC_B_WITH_VAT_PIN1.CSV'),'B');assert.equal(R.sectionFromName('x/SEC_D1_WITHOUT_VAT.CSV'),'D1');assert.equal(R.sectionFromName('sales.csv'),null);
 assert.equal(R.RATE_OF.D1,'0%');assert.equal(R.RATE_OF.I,'Exempt');
});
test('invoice numbers and PINs keep leading zeros; credit notes, missing VAT and wrong-month lines are flagged, not changed',()=>{
 const rows=[rowB('P051234567Z','Cust A','03/10/2026','000123','1000.00','160.00'),rowB('P051234567Z','Cust A','05/10/2026','CN0007','-100.00','-16.00','000123'),rowB('P0000000001','Cust B','04/11/2026','0045','500.00','')];
 const r=R.parseKraCsv({rows,section:'B',month:'2026-10'});
 assert.deepEqual(r.blocking,[]);assert.equal(r.lines[0].invoice_no,'000123');assert.equal(r.lines[1].document_type,'Credit note');assert.equal(r.lines[1].original_invoice,'000123');
 assert.equal(r.lines[2].invoice_no,'0045');assert.equal(r.lines[2].vat,80);assert.equal(r.lines[2].vat_derived,true);
 assert.ok(r.warnings.some(w=>/outside 2026-10/.test(w)));assert.ok(r.warnings.some(w=>/VAT was blank/.test(w)));
 assert.equal(r.totals.net,1400);
});
test('wrong column count, unreadable rows and empty files are refused before anything is kept',()=>{
 assert.match(R.parseKraCsv({rows:[['a','b']],section:'B',month:'2026-10'}).blocking[0],/10 columns/);
 assert.match(R.parseKraCsv({rows:[rowB('P1','x','not a date','I1','10','1.6')],section:'B',month:'2026-10'}).blocking[0],/Row 1/);
 assert.ok(R.parseKraCsv({rows:[],section:'B',month:'2026-10'}).blocking.length);
 assert.ok(R.parseKraCsv({rows:[],section:'Z',month:'2026-10'}).blocking.length);
});
test('duplicates are warned about, with the same or different amounts',()=>{
 const d=rowB('P1','x','03/10/2026','I1','10','1.6'),e=rowB('P1','x','03/10/2026','I1','20','3.2');
 assert.ok(R.parseKraCsv({rows:[d,d],section:'B',month:'2026-10'}).warnings.some(w=>/same amounts/.test(w)));
 assert.ok(R.parseKraCsv({rows:[d,e],section:'B',month:'2026-10'}).warnings.some(w=>/different amounts/.test(w)));
});
const L=(inv,pin,net,vat,date='2026-10-03')=>({invoice_no:inv,party_pin:pin,net,vat,invoice_date:date});
test('version comparison shows added, removed and changed lines by invoice number and PIN',()=>{
 const c=R.compareVersions([L('1','P1',100,16),L('2','P1',200,32),L('3','P2',50,8)],[L('1','P1',100,16),L('2','P1',210,33.6),L('4','P3',10,1.6)]);
 assert.equal(c.unchanged,1);assert.equal(c.added.length,1);assert.equal(c.removed.length,1);assert.deepEqual(c.changed[0].fields,['net','vat']);
});
const up=(section,version,lines)=>({section,version,lines:lines.map(l=>({vat_category:R.RATE_OF[section],...l}))});
test('sales: category totals are compared with the approved register; an absent section is not zero; a rounding allowance applies to VAT only',()=>{
 const uploaded={B:up('B',1,[L('1','P1',1000,160),L('2','P1',2000,320)]),C:up('C',1,[L('3','P1',100,8)])};
 const groups=[{vat_category:'16%',net:3000,vat:480.5},{vat_category:'8%',net:100,vat:8},{vat_category:'0%',net:0,vat:0},{vat_category:'Exempt',net:0,vat:0}];
 const r=R.reconcileSales({uploaded,groups,month:'2026-10'});
 assert.equal(r.status,'Incomplete');
 assert.equal(r.categories.find(c=>c.category==='16%').status,'Agrees');
 assert.equal(r.categories.find(c=>c.category==='0%').status,'CSV not uploaded');assert.deepEqual(r.missing_sections,['D1','E']);
 const g2=groups.map(g=>g.vat_category==='16%'?{...g,net:3010}:g),r2=R.reconcileSales({uploaded,groups:g2,month:'2026-10'});
 assert.equal(r2.status,'Differs');assert.equal(r2.differences[0].scope_key,'category:16%');assert.equal(r2.differences[0].difference_net,-10);
 const all={...uploaded,D1:up('D1',1,[]),E:up('E',1,[])};
 assert.equal(R.reconcileSales({uploaded:all,groups,month:'2026-10'}).status,'Agrees');
 assert.equal(R.reconcileSales({uploaded:{},groups,month:'2026-10'}).status,'No CSV uploaded');
 const none=R.reconcileSales({uploaded:{B:up('B',1,[L('1','P1',1000,160)])},groups:[],month:'2026-10'});
 assert.equal(none.categories[0].status,'No register');
});
const reg=(id,inv,pin,amount,vat,cat)=>({row_id:id,invoice:inv,party_pin:pin,party:'S',date:'2026-10-05',amount,vat,vat_category:cat});
test('purchases: matched by invoice and PIN; missing or conflicting classifications go to review and are never inferred',()=>{
 const uploaded={F:up('F',1,[L('0001','PA',1000,160),L('0002','PB',500,80),L('0003','PC',300,48),L('0004','PD',100,16)]),H:up('H',1,[L('0009','PE',700,0)])};
 const rows=[reg('r1','0001','PA',1000,160,'16%'),reg('r2','0002','PB',510,80,'16%'),reg('r3','0003','PC',300,48,'Unconfirmed'),reg('r5','0009','PE',700,0,'16%'),reg('r6','0077','PZ',40,6.4,'16%'),reg('r7','0088','PY',90,0,'Unconfirmed')];
 const m=R.matchPurchases({uploaded,rows,month:'2026-10'}),kinds=m.differences.map(d=>d.kind+':'+(d.invoice));
 assert.equal(m.matched,4);
 assert.ok(kinds.includes('Net amount differs:0002'));assert.ok(kinds.includes('Classification missing on the supplier invoice:0003'));assert.ok(kinds.includes('Classification conflict:0009'));
 assert.ok(kinds.includes('In KRA CSV, no supplier invoice:0004'));assert.ok(kinds.includes('Supplier invoice not in KRA CSV:0077'));assert.ok(kinds.includes('Supplier invoice not in KRA CSV:0088'));
 assert.ok(!kinds.some(k=>/:0001$/.test(k)));
 assert.equal(m.differences.find(d=>d.invoice==='0009').register_category,'16%');
 const none=R.matchPurchases({uploaded:{},rows,month:'2026-10'});assert.equal(none.status,'No CSV uploaded');assert.equal(none.differences.length,0);
 const noPin=R.matchPurchases({uploaded:{F:up('F',1,[L('0001',null,1000,160)])},rows:[reg('r1','0001','PA',1000,160,'16%')],month:'2026-10'});
 assert.equal(noPin.differences[0].kind,'Matched on invoice number only');
});
test('a reviewer decision stands only while its evidence is unchanged, and only Explained or Accepted clears it',()=>{
 const d=[{scope_key:'category:16%',kind:'x',evidence_key:'e1'},{scope_key:'line:1|P',kind:'y',evidence_key:'e2'},{scope_key:'line:2|P',kind:'y',evidence_key:'e3'}];
 const a=R.applyReviews(d,[{scope_key:'category:16%',evidence_hash:'e1',disposition:'Explained',reason:'Timing',reviewed_at:'2026-11-01'},{scope_key:'line:1|P',evidence_hash:'e2',disposition:'Query raised',reason:'Asked client',reviewed_at:'2026-11-01'},{scope_key:'line:2|P',evidence_hash:'old',disposition:'Accepted difference',reason:'Old evidence',reviewed_at:'2026-11-01'}]);
 assert.equal(a.cleared,1);assert.equal(a.open,2);assert.equal(a.differences[1].review.disposition,'Query raised');assert.equal(a.differences[2].review,null);
});
