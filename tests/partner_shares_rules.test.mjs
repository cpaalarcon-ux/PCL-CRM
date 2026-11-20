import test from 'node:test';import assert from 'node:assert/strict';
const R=await import('../supabase/functions/staff-workspace-v12/partner-shares-rules.mjs');
const L=await import('../supabase/functions/staff-workspace-v12/annual-pack-legal-form.mjs');

test('percentages become basis points exactly, and anything else is refused',()=>{
 assert.equal(R.percentToBp('60'),6000);assert.equal(R.percentToBp(' 33.33% '),3333);assert.equal(R.percentToBp('100'),10000);assert.equal(R.percentToBp('0.01'),1);
 for(const bad of ['','0','-5','100.01','33.333','abc','1e2','50 %%','101'])assert.equal(R.percentToBp(bad),null,bad);
 assert.equal(R.bpToPercent(6000),'60%');assert.equal(R.bpToPercent(3333),'33.33%');assert.equal(R.bpToPercent(10000),'100%');
});
test('the deed shares must name two or more different partners and add to exactly 100%',()=>{
 const ok=R.validateShares([{partner_name:' A  One ',share_percent:'33.33'},{partner_name:'B Two',share_percent:'33.33'},{partner_name:'C Three',share_percent:'33.34'}]);
 assert.equal(ok.ok,true);assert.deepEqual(ok.lines.map(x=>x.partner_name),['A One','B Two','C Three']);
 assert.match(R.validateShares([{partner_name:'A One',share_percent:'100'}]).problems[0],/at least 2 partners/);
 assert.match(R.validateShares([{partner_name:'A One',share_percent:'60'},{partner_name:'B Two',share_percent:'30'}]).problems[0],/add to 90%, not 100%/);
 assert.match(R.validateShares([{partner_name:'A One',share_percent:'50'},{partner_name:'a one',share_percent:'50'}]).problems[0],/appears twice/);
 assert.match(R.validateShares([{partner_name:'A One',share_percent:'50'},{partner_name:'B Two',share_percent:'50.005'}]).problems[0],/two decimals/);
 assert.match(R.validateShares([{partner_name:'A',share_percent:'50'},{partner_name:'B Two',share_percent:'50'}]).problems[0],/full name/);
 assert.match(R.validateShares(Array.from({length:21},(_,i)=>({partner_name:'Partner '+i,share_percent:'1'}))).problems[0],/At most 20/);
 assert.equal(R.validateShares('x').ok,false);
});
test('profit is shared in whole cents with nothing lost or invented, and the same inputs always give the same answer',()=>{
 const three=R.validateShares([{partner_name:'A One',share_percent:'33.33'},{partner_name:'B Two',share_percent:'33.33'},{partner_name:'C Three',share_percent:'33.34'}]).lines;
 const a=R.allocateProfit(100000.01,three);assert.equal(a.total,100000.01);
 assert.equal(Math.round(a.rows.reduce((n,r)=>n+r.amount,0)*100),10000001);assert.deepEqual(R.allocateProfit(100000.01,three),a);
 for(const profit of [0,1,0.01,0.02,-0.01,-100,-33333.37,1234567.89,999999999999.99]){
  const x=R.allocateProfit(profit,three);assert.equal(Math.round(x.rows.reduce((n,r)=>n+r.amount,0)*100),Math.round(profit*100),String(profit));
  for(const r of x.rows)assert.ok(Math.abs(r.amount*100-Math.round(r.amount*100))<1e-6);
 }
 const halves=R.validateShares([{partner_name:'A One',share_percent:'50'},{partner_name:'B Two',share_percent:'50'}]).lines;
 assert.deepEqual(R.allocateProfit(0.01,halves).rows.map(r=>r.amount),[0.01,0],'the odd cent goes to the earlier name, once');
 assert.deepEqual(R.allocateProfit(-300000,halves).rows.map(r=>r.amount),[-150000,-150000],'a loss is shared the same way');
 assert.deepEqual(R.allocateProfit(301,halves,0).rows.map(r=>r.amount),[151,150],'whole presentation units');
});
test('the pack check follows the state of the shares: none, waiting for a Partner, approved',()=>{
 assert.equal(L.partnerSharesCheck({form:L.FORMS.COMPANY,shares:{status:'none'}}),null);
 assert.match(L.partnerSharesCheck({form:L.FORMS.PARTNERSHIP,shares:{status:'none'}}).detail,/not recorded/);
 assert.match(L.partnerSharesCheck({form:L.FORMS.PARTNERSHIP,shares:{status:'draft'}}).detail,/wait for a Partner/);
 const p=L.partnerSharesCheck({form:L.FORMS.PARTNERSHIP,shares:{status:'approved',lines:[1,2]}});assert.equal(p.status,'Pass');assert.match(p.detail,/2 partners/);
 assert.equal(R.sharesState({approved:null,draft:null}).status,'none');assert.equal(R.sharesState({approved:null,draft:{v:1}}).status,'draft');assert.equal(R.sharesState({approved:{v:1},draft:{v:2}}).status,'approved');
});
