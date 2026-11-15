import test from 'node:test';import assert from 'node:assert/strict';
import {previousKind,canonical,digestOf,flatten,diffSnapshots,describe,nextSteps,KINDS} from '../supabase/functions/staff-workspace-v12/statement-version-rules.mjs';
const snap=(rev,cash)=>({statements:{profit_or_loss:{rows:[{label:'Revenue',kind:'line',current:rev},{label:'Head',kind:'heading'}]},financial_position:{rows:[{label:'Cash',kind:'line',current:cash}]}}});
test('the order of the three kinds',()=>{assert.deepEqual(KINDS,['Draft','Audit/Review Adjusted','Final Signed']);assert.equal(previousKind('Draft'),null);assert.equal(previousKind('Audit/Review Adjusted'),'Draft');assert.equal(previousKind('Final Signed'),'Audit/Review Adjusted');});
test('the digest ignores key order and changes with any figure',async()=>{
 assert.equal(canonical({b:1,a:[2,{d:1,c:2}]}),canonical({a:[2,{c:2,d:1}],b:1}));
 assert.equal(await digestOf(snap(1,2)),await digestOf(snap(1,2)));assert.notEqual(await digestOf(snap(1,2)),await digestOf(snap(1.01,2)));
});
test('what changed between two snapshots is listed line by line; headings are ignored',()=>{
 assert.equal(flatten(snap(1,2)).size,2);
 assert.deepEqual(diffSnapshots(snap(1000,600),snap(1250,600)),[{statement:'Profit or loss',label:'Revenue',before:1000,after:1250,change:'Changed',difference:250}]);
 const b=snap(1,2);b.statements.profit_or_loss.rows.push({label:'Other',kind:'line',current:5});
 assert.deepEqual(diffSnapshots(snap(1,2),b).map(x=>x.change),['Added']);assert.deepEqual(diffSnapshots(b,snap(1,2)).map(x=>x.change),['Removed']);
 assert.deepEqual(diffSnapshots(snap(1,2),snap(1,2)),[]);
});
test('superseded and out-of-date versions are marked, and the next step follows only from locked, current versions',()=>{
 const v=(id,kind,seq,o={})=>({version_id:id,kind,seq,status:'Locked',based_on_version_id:null,...o});
 const d1=v('d1','Draft',1),a1=v('a1','Audit/Review Adjusted',1,{based_on_version_id:'d1'}),d2=v('d2','Draft',2,{status:'Prepared'});
 const m=Object.fromEntries(describe([d1,a1,d2]).map(x=>[x.version_id,x]));
 assert.equal(m.d1.superseded,true);assert.equal(m.a1.stale,true);assert.match(m.a1.state,/Out of date/);assert.equal(m.d2.current,true);
 assert.deepEqual(nextSteps([d1,a1,d2]).map(s=>s.allowed),[true,false,false]);
 assert.deepEqual(nextSteps([d1]).map(s=>s.allowed),[true,true,false]);
 assert.deepEqual(nextSteps([d1,a1]).map(s=>s.allowed),[true,true,true]);
 assert.deepEqual(nextSteps([]).map(s=>s.allowed),[true,false,false]);
});
