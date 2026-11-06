import test from 'node:test';import assert from 'node:assert/strict';
const {buildPayables,payablesChecks,supplierIndex}=await import('../supabase/functions/staff-workspace-v12/payables-rules.mjs');
const S=[{supplier_id:'s1',name:'Fictional Hardware Ltd',kra_pin:'P000000001A',aliases:['FH Ltd'],status:'Active'},{supplier_id:'s2',name:'Nameless Supplies',kra_pin:'',aliases:[],status:'Active'}];
const L=(date,credit,debit,party,pin,kind='Source')=>({date,credit,debit,party,pin,kind});

test('suppliers match by PIN first, then by name only when that cannot contradict a PIN',()=>{
 const i=supplierIndex(S);
 assert.equal(i.find({pin:'p000000001a',name:'whatever'}).supplier_id,'s1');
 assert.equal(i.find({pin:'',name:'fh ltd'}).supplier_id,'s1','alias');
 assert.equal(i.find({pin:'P999999999Z',name:'Fictional Hardware Ltd'}),null,'a different PIN is a different supplier');
 assert.equal(i.find({pin:'P999999999Z',name:'Nameless Supplies'}).supplier_id,'s2','a supplier with no PIN recorded can be matched by name');
 assert.equal(i.find({pin:'',name:'Unknown Co'}),null);
});

test('ageing clears the oldest invoices first and agrees to the control account',()=>{
 const lines=[L('2026-01-10',1000,0,'Fictional Hardware Ltd','P000000001A'),L('2026-03-05',500,0,'FH Ltd',''),L('2026-03-20',0,1200,'Fictional Hardware Ltd','P000000001A'),
  L('2026-03-25',300,0,'Mystery Traders','P111111111B'),L('2026-03-26',0,50,'', '', 'Adjustment'),L('2026-01-01',2000,0,'','','Opening')];
 const r=buildPayables({lines,suppliers:S,asOf:'2026-04-30'});
 const fh=r.suppliers.find(s=>s.supplier_id==='s1');
 assert.equal(fh.balance,300,'1000+500-1200');
 assert.equal(fh.buckets.find(b=>b.label==='Over 90 days').amount,0,'January invoice fully paid');
 assert.equal(fh.buckets.find(b=>b.label==='31–60 days').amount,300,'remaining part of the March invoice is aged from 5 March');
 assert.equal(r.unregistered.length,1);assert.equal(r.unregistered[0].party,'Mystery Traders');
 assert.equal(r.unassigned.count,2);assert.equal(r.unassigned.amount,250);assert.equal(r.unassigned.manual,1);
 assert.equal(r.opening.amount,2000);
 assert.equal(r.totals.gl_control,2550);assert.equal(r.totals.ageing,2550);assert.equal(r.totals.difference,0);
});

test('overpaid suppliers show a debit balance, not a negative bucket',()=>{
 const r=buildPayables({lines:[L('2026-02-01',100,0,'Nameless Supplies',''),L('2026-02-10',0,250,'Nameless Supplies','')],suppliers:S,asOf:'2026-02-28'});
 const s=r.suppliers[0];assert.equal(s.balance,-150);assert.equal(s.debit_balance,150);assert.equal(s.owed,0);
});

test('close checks block unassigned payables only once a register is in use',()=>{
 const rep=buildPayables({lines:[L('2026-03-25',300,0,'Mystery Traders','P111111111B')],suppliers:S,asOf:'2026-04-30'});
 const none=payablesChecks(rep,{registerInUse:false});assert.equal(none.length,1);assert.equal(none[0].status,'Not started');assert.ok(!none.some(c=>c.blocking));
 const used=payablesChecks(rep,{registerInUse:true});
 assert.equal(used.find(c=>c.code==='PAYABLES_ASSIGNED').status,'Blocked');assert.match(used.find(c=>c.code==='PAYABLES_ASSIGNED').detail,/Mystery Traders/);
 assert.equal(used.find(c=>c.code==='PAYABLES_CONTROL').status,'Pass');
 const clean=payablesChecks(buildPayables({lines:[L('2026-03-25',300,0,'Nameless Supplies','')],suppliers:S,asOf:'2026-04-30'}),{registerInUse:true});
 assert.ok(!clean.some(c=>c.blocking));
});
