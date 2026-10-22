const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const C=require('../finance_import_core_v1.js');
const clients=[{id:'c-1',companyName:'Example Client',tradingName:'Example Store'},{id:'c-2',companyName:'Different Company',previousNames:['Old Name']}];
const payment=(reference='BANK/TEST/001',amount=1234.56)=>({Number:reference,Date:'2026-10-01 00:00:00','Customer/Vendor':'Example Client','Amount Signed':amount,'Amount Company Currency Signed':amount,Journal:'Bank',State:'Reconciled'});
const sheet=rows=>({kind:'Payment',fileName:'Synthetic.xlsx',sheetName:'Payments',rows:rows.map((values,i)=>({rowNumber:i+2,values}))});
const source={fileName:'Synthetic.xlsx',sheetName:'Sheet1',row:2};
test('duplicate exports import once and preserve exact KES cents, reference and client ID',()=>{
 const rows=Array.from({length:165},(_,i)=>payment(`BANK/TEST/${i}`,100+i));
 const r=C.prepare([sheet(rows),sheet(rows)],[],clients);
 assert.equal(r.rowsRead,330);assert.equal(r.records.length,165);assert.equal(r.duplicates.length,165);assert.equal(r.records[0].clientId,'c-1');
 assert.equal(r.records[0].firmId,'');assert.equal(r.records[0].currency,'KES');assert.equal(r.records[0].postingStatus,'Imported history only');assert.equal(r.records[0].allocationStatus,'Not allocated');
 assert.equal(C.prepare([sheet(rows)],r.records,clients).records.length,0);
});
test('matching ignores only case and whitespace, never guesses suffixes or ambiguous names',()=>{
 assert.equal(C.matchClient('  EXAMPLE   client ',clients).clientId,'c-1');assert.equal(C.matchClient('Example Store',clients).clientId,'c-1');
 assert.equal(C.matchClient('Old Name',clients).clientId,'c-2');assert.equal(C.matchClient('Example Client Limited',clients).clientId,'');
 assert.equal(C.matchClient('Example Client',[...clients,{id:'c-3',companyName:'example client'}]).linkMethod,'Ambiguous name');
 assert.equal(C.matchClient('Example Client',[{...clients[0],deletedAt:'2026-01-01'}]).clientId,'');
});
test('reference collisions with changed figures are conflicts; identified firms remain separate',()=>{
 const first=C.prepare([sheet([payment()])],[],clients,'firm-a').records;
 const changed=C.prepare([sheet([payment(undefined,987)])],first,clients,'firm-a');assert.equal(changed.conflicts.length,1);assert.equal(changed.records.length,0);
 assert.equal(C.prepare([sheet([payment()])],first,clients,'firm-b').records.length,1);
 assert.equal(C.prepare([sheet([payment()])],first,clients,'').duplicates.length,1);
});
test('negative journals are preserved for review, including original residual and tax difference',()=>{
 const r=C.parseSource({Number:'RINV/TEST/1',Partner:'Example Client','Invoice/Bill Date':'2026-10-01','Due Date':'2026-10-01','Untaxed Amount Signed Currency':-2586.21,'Total in Currency Signed':-3000,'Amount Due Signed':0,'Status In Payment':'Paid'},'Journal',source,'',clients);
 assert.equal(r.amountMinor,-300000);assert.equal(r.taxMinor,-41379);assert.equal(r.sourceAmountDueMinor,0);assert.equal(r.sourceStatus,'Paid');
 assert.equal(r.documentType,'Unconfirmed');assert.equal(r.postingStatus,'Imported history only');assert.ok(C.needs(r,clients).includes('Document type'));assert.equal(r.clientId,'c-1');
});
test('invalid amounts and dates are exposed, zero and negative amounts are retained',()=>{
 for(const value of ['',null,'NaN',Infinity,'12.345']){const r=C.prepare([sheet([payment(undefined,value)])],[],clients);assert.equal(r.errors.length,1);}
 assert.equal(C.money(-12.34),-1234);assert.equal(C.money(0),0);assert.equal(C.money('1,234.56'),123456);assert.throws(()=>C.date('2026-02-30'));
 const r=C.prepare([sheet([{...payment(),Date:'bad'}])],[],clients);assert.equal(r.errors[0].row,2);
});
test('source reconciled status is not an allocation and Bank journal does not infer a method',()=>{
 const r=C.parseSource(payment(),'Payment',source,'firm-a',clients);assert.equal(r.paymentMethod,'');assert.ok(C.needs(r,clients).includes('Invoice allocation'));assert.ok(C.needs(r,clients).includes('Payment method'));
});
test('review amendments preserve source data, record changes and do not overwrite a confirmed firm',()=>{
 const r={...C.parseSource(payment(),'Payment',source,'',clients),id:'r-1'};
 const values={clientId:'c-2',firmId:'firm-a',paymentMethod:'M-Pesa',documentType:'Payment'};
 const changed=C.amend(r,values,'Confirmed identity and firm',clients,[{id:'firm-a'}],'Manager','2026-10-22T12:00:00Z');
 assert.equal(changed.amountMinor,r.amountMinor);assert.deepEqual(changed.sourceFields,r.sourceFields);assert.equal(changed.sourceClientName,r.sourceClientName);assert.equal(changed.changes.length,1);assert.equal(changed.clientId,'c-2');assert.equal(changed.postingStatus,'Imported history only');
 assert.throws(()=>C.amend(changed,{...values,firmId:''},'Change',clients,[],'Manager','now'),/already set/);
 assert.throws(()=>C.amend(r,values,'',clients,[{id:'firm-a'}],'Manager','now'),/reason/);
 for(const role of ['Intern','Audit Assistant','Audit Supervisor'])assert.throws(()=>C.amend(r,values,'test',clients,[{id:'firm-a'}],role,'now'),/Only/);
});
test('local storage saves atomically, rejects stale writes and denies non-management categories',()=>{
 const store=new Map(),key='pcl-finance-import-history-v1';
 const context={window:{PCLFinanceImportCore:C},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}};
 vm.createContext(context);const source=fs.readFileSync(require.resolve('../finance_import_module_v1.js'),'utf8');
 vm.runInContext(source.slice(0,source.indexOf('  window.pclFinanceHistory='))+'window.test={save,data};})();',context);
 const state={schema:1,records:[{id:'test'}],batches:[]};context.window.test.save(state,'');assert.equal(context.window.test.data().records.length,1);
 assert.throws(()=>context.window.test.save({schema:1,records:[],batches:[]},''),/another tab/);assert.equal(context.window.test.data().records.length,1);
 store.set('pcl-unified-shell-preview-v1',JSON.stringify({category:'Intern'}));assert.throws(()=>context.window.test.save(state,store.get(key)),/Only/);
 store.delete('pcl-unified-shell-preview-v1');context.localStorage.setItem=()=>{throw new Error('Quota exceeded');};assert.throws(()=>context.window.test.save(state,store.get(key)),/Quota/);assert.equal(context.window.test.data().records.length,1);
});
