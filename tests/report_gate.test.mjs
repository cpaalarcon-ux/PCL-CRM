import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {monthsBetween,sourceChecks,totalsTie,signOffCheck,reportGate,draftBanner}=await import('../supabase/functions/staff-workspace-v12/report-gate-rules.mjs');
const {gateHtml,finalAvailable}=await import('../staff-report-gate.mjs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const months=monthsBetween('2026-01-01','2026-03-31');
const okFacts={imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-01-01',ends_on:'2026-03-31'}],batches:[
 {dataset:'Purchases',period_start:'2026-01-01',period_end:'2026-03-31',rows:20,unmapped:0},{dataset:'Bank',period_start:'2026-01-01',period_end:'2026-03-31',rows:50,unmapped:0}]};
const base=()=>({sources:sourceChecks({months,facts:okFacts}),unmapped:{count:0},postedJournals:4,draftJournals:0,tbTotals:{debit:1000,credit:1000},reportedTotals:{sales:900,profit_before_tax:200,profit_after_tax:150},
 tie:totalsTie({tb:[{code:'40000',net:-900},{code:'51000',net:750},{code:'10000',net:150}],reportedProfit:150,yearClosed:false}),issues:[],signOff:signOffCheck({review:{status:'Approved',prepared_by:'a',reviewed_by:'b'},digestOk:true})});

test('months and sources: an expected source must be there every month, and an empty year passes nothing',()=>{
 assert.deepEqual(months,['2026-01','2026-02','2026-03']);
 const s=sourceChecks({months,facts:okFacts});assert.deepEqual(s.expected,['sales','purchases','bank']);assert.equal(s.rows.every(r=>r.ok),true);assert.equal(s.none,false);
 // March bank missing although it came in for January and February.
 const gap=sourceChecks({months,facts:{...okFacts,batches:[okFacts.batches[0],{dataset:'Bank',period_start:'2026-01-01',period_end:'2026-02-28',rows:50,unmapped:0}]}});
 assert.deepEqual(gap.rows.filter(r=>!r.ok).map(r=>r.key+r.month),['bank2026-03']);
 // Unmapped purchases, an unconfirmed sales summary and an unapproved payroll run are not "received".
 const mixed=sourceChecks({months:['2026-01'],facts:{imports:[{kind:'Sales',status:'Submitted',starts_on:'2026-01-01',ends_on:'2026-01-31'},{kind:'Payroll',status:'Confirmed',starts_on:'2025-12-01',ends_on:'2025-12-31'}],batches:[{dataset:'Purchases',period_start:'2026-01-01',period_end:'2026-01-31',rows:4,unmapped:2}]}});
 assert.deepEqual(mixed.rows.map(r=>r.key+':'+r.state).sort(),['payroll:Not received','purchases:Not mapped']);
 const none=sourceChecks({months,facts:{imports:[],batches:[]}});assert.equal(none.none,true);
});
test('totals tie to the trial balance, and a closed year nets to nil',()=>{
 assert.equal(totalsTie({tb:[{code:'40000',net:-900},{code:'51000',net:750}],reportedProfit:150}).ok,true);
 const off=totalsTie({tb:[{code:'40000',net:-900},{code:'51000',net:700}],reportedProfit:150});assert.equal(off.ok,false);assert.match(off.detail,/difference -50\.00|difference 50\.00|differ/i);
 assert.equal(totalsTie({tb:[{code:'40000',net:0},{code:'51000',net:0}],reportedProfit:150,yearClosed:true}).ok,true);
 assert.equal(totalsTie({tb:[{code:'40000',net:-900}],reportedProfit:150,yearClosed:true}).ok,false);
});
test('sign-off needs an approved review by someone other than the preparer, on unchanged figures',()=>{
 assert.equal(signOffCheck({review:null,digestOk:false}).ok,false);
 assert.match(signOffCheck({review:{status:'Submitted'},digestOk:true}).detail,/waiting for a reviewer/);
 assert.match(signOffCheck({review:{status:'Returned'},digestOk:true}).detail,/returned/);
 assert.match(signOffCheck({review:{status:'Approved',prepared_by:'a',reviewed_by:'a'},digestOk:true}).detail,/someone other than the preparer/);
 assert.match(signOffCheck({review:{status:'Approved',prepared_by:'a',reviewed_by:'b'},digestOk:false}).detail,/changed after sign-off/);
 assert.equal(signOffCheck({review:{status:'Approved',prepared_by:'a',reviewed_by:'b'},digestOk:true}).ok,true);
});
test('the gate: nothing passes by default; one failure keeps the report a Draft',()=>{
 const good=reportGate(base());assert.equal(good.ready,true);assert.equal(good.mark,'FINAL');assert.equal(good.checks.length,8);assert.equal(draftBanner(good),'');
 // The case the review described: empty sources and journals, empty totals, and a sign-off flag alone.
 const empty=reportGate({sources:{rows:[],none:true},unmapped:{count:0},postedJournals:0,draftJournals:0,tbTotals:{debit:0,credit:0},reportedTotals:{},tie:{ok:true},issues:[],signOff:{ok:true}});
 assert.equal(empty.ready,false);for(const c of ['SOURCES','JOURNALS','TB_BALANCED','REPORT_TOTALS'])assert.ok(empty.failing.includes(c),c);
 assert.equal(reportGate({}).ready,false);
 for(const [name,change,code] of [
  ['unmapped rows',{unmapped:{count:3}},'MAPPINGS'],['draft journals',{draftJournals:2},'JOURNALS'],['unbalanced',{tbTotals:{debit:1000,credit:990}},'TB_BALANCED'],
  ['totals not tied',{tie:{ok:false,detail:'x'}},'TOTALS_TIE'],['open exception',{issues:['A bank difference is unexplained.']},'EXCEPTIONS'],['no sign-off',{signOff:{ok:false,detail:'None'}},'SIGN_OFF'],
  ['missing totals',{reportedTotals:{sales:10}},'REPORT_TOTALS']]){
  const g=reportGate({...base(),...change});assert.equal(g.ready,false,name);assert.deepEqual(g.failing,[code],name);assert.equal(g.mark,'DRAFT');assert.match(draftBanner(g),/^DRAFT — NOT FOR RELEASE\. Open checks:/);
 }
});
test('the checklist screen lists each check and offers the final report only when all pass',()=>{
 const bad=reportGate({...base(),issues:['An <script> issue']}),html=gateHtml({gate:bad},esc);
 assert.match(html,/1 check\(s\) open/);assert.doesNotMatch(html,/<script>/);assert.equal(finalAvailable({gate:bad}),false);
 assert.match(gateHtml({gate:reportGate(base())},esc),/All checks passed/);assert.equal(finalAvailable({gate:reportGate(base())}),true);
 assert.match(gateHtml(null,esc),/could not be read/);
 const ui=read('staff-ledger.mjs'),v6=read('staff-workspace-v6.mjs'),srv=read('supabase/functions/staff-workspace-v12/ledger-actions.ts');
 assert.match(ui,/ledger_report_gate/);assert.match(ui,/final:f\.get\('mode'\)==='final'/);assert.match(v6,/staff-ledger\.mjs\?v=20261115-report-gate-v1/);
 // The server, not the screen, refuses the final report.
 assert.match(srv,/if\(final&&!g\.gate\.ready\)fail\(400,'The final report is blocked\./);
});
