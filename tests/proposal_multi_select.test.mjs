import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {proposalSelectAction}=await import('../supabase/functions/staff-workspace-v12/proposal-select-actions.ts');
const {proposalsCard,pickState,proposalActions}=await import('../staff-proposals.mjs');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fake(rows){const audits=[];const tx=async(parts,...v)=>{const sql=parts.join('?');if(sql.includes('from erp_private.change_proposals'))return rows.filter(r=>v[0].includes(r.proposal_id));if(sql.includes('audit_events')){audits.push(v);return [];}return [];};tx.json=x=>x;tx.savepoint=async fn=>fn(tx);return {tx,audits};}
const P=(n,o={})=>({proposal_id:id(n),status:'Proposed',summary:'Change '+n,proposed_by:'prop',checked_by:null,...o});
const me=(role,staff='me')=>({staff_id:staff,auth_user_id:'auth',category_code:role});

test('ticked proposals are checked one by one; own and wrongly staged ones are held back with a reason',async()=>{
 const {tx,audits}=fake([P(1),P(2,{proposed_by:'me'}),P(3,{status:'Checked'}),P(4)]);const ran=[];
 const out=await proposalSelectAction(tx,me('SUPERVISOR'),{action:'client_proposal_check_selected',proposal_ids:[id(1),id(2),id(3),id(4),id(9)],note:'Checked against the register'},async q=>{ran.push(q);if(q.proposal_id===id(4))throw Object.assign(new Error('Needs evidence'),{status:400});return {ok:true};});
 assert.deepEqual(ran.map(r=>r.proposal_id),[id(1),id(4)]);assert.ok(ran.every(r=>r.action==='client_proposal_check'&&r.note==='Checked against the register'));
 assert.deepEqual(out.done.map(d=>d.proposal_id),[id(1)]);
 const why=Object.fromEntries(out.held.map(h=>[h.proposal_id,h.reason]));
 assert.match(why[id(2)],/You proposed this/);assert.match(why[id(3)],/not waiting for a check/);assert.match(why[id(4)],/Needs evidence/);assert.match(why[id(9)],/not available/);
 assert.equal(audits.length,1);
});
test('approval needs a checked proposal that you neither proposed nor checked',async()=>{
 const {tx}=fake([P(1,{status:'Checked',checked_by:'other'}),P(2,{status:'Checked',checked_by:'me'}),P(3)]);const ran=[];
 const out=await proposalSelectAction(tx,me('MANAGER'),{action:'client_proposal_approve_selected',proposal_ids:[id(1),id(2),id(3)],note:'Approved after review'},async q=>{ran.push(q.proposal_id);return {ok:true};});
 assert.deepEqual(ran,[id(1)]);assert.match(out.held.find(h=>h.proposal_id===id(2)).reason,/You checked this/);assert.match(out.held.find(h=>h.proposal_id===id(3)).reason,/not been checked/);
});
test('role, note and size limits',async()=>{
 const {tx}=fake([P(1)]);const run=async()=>({ok:true});
 await assert.rejects(()=>proposalSelectAction(tx,me('ASSISTANT'),{action:'client_proposal_check_selected',proposal_ids:[id(1)],note:'long enough note'},run),/access/);
 await assert.rejects(()=>proposalSelectAction(tx,me('SUPERVISOR'),{action:'client_proposal_approve_selected',proposal_ids:[id(1)],note:'long enough note'},run),/Manager or Partner/);
 await assert.rejects(()=>proposalSelectAction(tx,me('MANAGER'),{action:'client_proposal_check_selected',proposal_ids:[id(1)],note:'short'},run),/10 characters/);
 await assert.rejects(()=>proposalSelectAction(tx,me('MANAGER'),{action:'client_proposal_check_selected',proposal_ids:[],note:'long enough note'},run),/Tick the proposals/);
 await assert.rejects(()=>proposalSelectAction(tx,me('MANAGER'),{action:'client_proposal_check_selected',proposal_ids:Array.from({length:101},(_,i)=>id(i+1)),note:'long enough note'},run),/at most 100/);
 assert.equal(await proposalSelectAction(tx,me('MANAGER'),{action:'something_else'},run),undefined);
});
test('screen: tick boxes only on proposals the person can act on, with a ticked-count bar',()=>{
 const list=[{proposal_id:'a',status:'Proposed',proposed_by:'x',summary:'One',payload:{},revision:1},{proposal_id:'b',status:'Proposed',proposed_by:'sup',summary:'Mine',payload:{},revision:1},{proposal_id:'c',status:'Checked',proposed_by:'x',checked_by:'y',summary:'Three',payload:{},revision:1}];
 const m={staff_id:'sup',category_code:'MANAGER'};
 const html=proposalsCard({proposals:list,me:m},s=>String(s??''),()=>'x');
 assert.match(html,/data-pick="a" data-pick-for="check"/);assert.match(html,/data-pick="c" data-pick-for="approve"/);assert.doesNotMatch(html,/data-pick="b"/);
 assert.match(html,/id="pickBar" hidden/);assert.match(html,/data-pick-all/);
 const boxes=[{checked:true,dataset:{pick:'a',pickFor:'check'}},{checked:true,dataset:{pick:'c',pickFor:'approve'}},{checked:false,dataset:{pick:'z',pickFor:'check'}}];
 assert.deepEqual(pickState(boxes),{count:2,check:['a'],approve:['c']});
 assert.deepEqual(proposalActions(list[1],m).filter(a=>a==='check'||a==='approve'),[]);
});
test('the new actions are routed and belong to the clients area',()=>{
 const ix=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/index.ts',import.meta.url),'utf8');
 assert.match(ix,/proposalSelectAction\(tx,a,p,run\)/);
 const ac=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/staff-access-control.mjs',import.meta.url),'utf8');assert.match(ac,/client_proposal_\|/);
});
