import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {annualGate,annualBanner}=await import('../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs');
const {reportGate,sourceChecks,totalsTie,signOffCheck,monthsBetween}=await import('../supabase/functions/staff-workspace-v12/report-gate-rules.mjs');
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const months=monthsBetween('2026-01-01','2026-12-31');
const facts={imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-01-01',ends_on:'2026-12-31'}],batches:[{dataset:'Purchases',period_start:'2026-01-01',period_end:'2026-12-31',rows:90,unmapped:0},{dataset:'Bank',period_start:'2026-01-01',period_end:'2026-12-31',rows:300,unmapped:0}]};
const gateIn=()=>({sources:sourceChecks({months,facts}),unmapped:{count:0},postedJournals:30,draftJournals:0,tbTotals:{debit:5000,credit:5000},reportedTotals:{sales:4000,profit_before_tax:900,profit_after_tax:900},
 tie:totalsTie({tb:[{code:'40000',net:-4000},{code:'51000',net:3100},{code:'10000',net:900}],reportedProfit:900,yearClosed:false}),issues:[],signOff:signOffCheck({review:{status:'Approved',prepared_by:'a',reviewed_by:'b'},digestOk:true}),warnings:[{code:'STOCK',label:'Stock and cost of sales',detail:'x'}]});
const pack=(over={})=>({checks:['REPORTING_BASIS','MAP_APPROVED','NO_LEGACY','NO_UNRESOLVED','COMPARATIVES'].map(code=>({code,label:code,status:over[code]||'Pass',detail:over[code]?'Open.':''}))});

test('annual gate: the report checks, the annual checks and the sign-off all have to pass; stock is only a warning',()=>{
 const g=annualGate({gate:reportGate(gateIn()),pack:pack(),statementProblems:[]});
 assert.equal(g.ready,true);assert.equal(g.status,'Final');assert.equal(g.mark,'FINAL');assert.equal(g.checks.length,8+5+1);assert.equal(g.checks.at(-1).code,'SIGN_OFF');assert.deepEqual(g.warnings.map(w=>w.code),['STOCK']);assert.equal(annualBanner(g),'');
 // Each annual check stops the final statements on its own.
 for(const code of ['REPORTING_BASIS','MAP_APPROVED','NO_LEGACY','NO_UNRESOLVED','COMPARATIVES']){
  const x=annualGate({gate:reportGate(gateIn()),pack:pack({[code]:'Blocked'}),statementProblems:[]});assert.equal(x.ready,false,code);assert.deepEqual(x.failing,['A_'+code]);assert.equal(x.status,'Draft - not ready');assert.match(annualBanner(x),/^DRAFT — NOT FOR RELEASE/);
 }
 // Statements that are incomplete, or could not be built, fail. They are never treated as passing.
 assert.deepEqual(annualGate({gate:reportGate(gateIn()),pack:pack(),statementProblems:['Account 99999 has no approved statement line.']}).failing,['A_STATEMENTS']);
 assert.deepEqual(annualGate({gate:reportGate(gateIn()),pack:pack(),statementProblems:null}).failing,['A_STATEMENTS']);
 // A missing pack check cannot pass by being absent.
 assert.equal(annualGate({gate:reportGate(gateIn()),pack:{checks:[]},statementProblems:[]}).ready,false);
 assert.equal(annualGate({}).ready,false);
});
test('annual gate: every month of the year is a required source month; a year with a month missing fails',()=>{
 const gap=gateIn();gap.sources=sourceChecks({months,facts:{...facts,batches:[facts.batches[0],{dataset:'Bank',period_start:'2026-01-01',period_end:'2026-10-31',rows:300,unmapped:0}]}});
 const g=annualGate({gate:reportGate(gap),pack:pack(),statementProblems:[]});assert.deepEqual(g.failing,['SOURCES']);assert.match(g.checks.find(c=>c.code==='SOURCES').detail,/Bank statements 2026-11: Not received/);
 // A documented nothing-to-report declaration covers a month where nothing arrived.
 const dec=gateIn();dec.sources=sourceChecks({months,facts:{...facts,batches:[facts.batches[0],{dataset:'Bank',period_start:'2026-01-01',period_end:'2026-10-31',rows:300,unmapped:0}],declarations:[{source_key:'bank',obligation_code:'VAT',period_month:'2026-11-01',declarant_name:'Fictional Director',declared_on:'2026-12-02',reason:'The account was dormant in November.'},{source_key:'bank',obligation_code:'VAT',period_month:'2026-12-01',declarant_name:'Fictional Director',declared_on:'2026-12-02',reason:'The account was dormant in December.'}]}});
 assert.equal(annualGate({gate:reportGate(dec),pack:pack(),statementProblems:[]}).ready,true);
});
test('annual gate: only the sign-off open means ready for review, not final',()=>{
 const g=annualGate({gate:reportGate({...gateIn(),signOff:{ok:false,detail:'No one has signed this report off.'}}),pack:pack(),statementProblems:[]});
 assert.equal(g.ready,false);assert.equal(g.ready_for_review,true);assert.equal(g.status,'Ready for review');assert.deepEqual(g.failing,['SIGN_OFF']);
});
test('the annual gate is enforced on the server and shown on the screen',()=>{
 const srv=read('supabase/functions/staff-workspace-v12/ledger-actions.ts'),ui=read('staff-ledger.mjs');
 assert.match(srv,/if\(final&&!ann\.gate\.ready\)fail\(400,'The final annual statements are blocked\./);assert.match(srv,/ledger_pack_export/);
 assert.match(ui,/ledger_pack_export/);assert.match(ui,/pack-download/);assert.match(ui,/final:f\.get\('mode'\)==='final'/);assert.match(ui,/\['Ready for review','Final'\]\.includes\(d\.status\)/);
});
