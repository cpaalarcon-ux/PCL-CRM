// Propose-and-approve screen: who sees which button, and what the buttons send.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<main id="content"></main>',{url:'https://example.test/staff-pilot'});globalThis.document=dom.window.document;
const {proposalActions,proposalsCard,proposeButtons,canPropose,bindProposals}=await import('../staff-proposals.mjs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const person=(role,staff_id)=>({category_code:role,staff_id});
const prop=(o={})=>({proposal_id:'p1',status:'Proposed',proposed_role:'ASSISTANT',proposed_by:'s-assist',checked_by:null,summary:'Change client details: UAT Fictional Test Ltd',revision:1,...o});
test('Assistant proposals: the proposer can withdraw, a Supervisor can check or return, nobody approves before the check',()=>{
 assert.deepEqual(proposalActions(prop(),person('ASSISTANT','s-assist')),['withdraw']);
 assert.deepEqual(proposalActions(prop(),person('SUPERVISOR','s-sup')),['check','return']);
 assert.deepEqual(proposalActions(prop(),person('MANAGER','s-mgr')),['check','return'],'a Manager can check, but cannot approve an unchecked Assistant proposal');
 assert.deepEqual(proposalActions(prop(),person('ASSISTANT','s-other')),[]);
});
test('after the check only a Manager or Partner who did not check it can approve',()=>{
 const checked=prop({status:'Checked',checked_by:'s-sup'});
 assert.deepEqual(proposalActions(checked,person('MANAGER','s-mgr')),['approve','return']);
 assert.deepEqual(proposalActions(checked,person('PARTNER','s-partner')),['approve','return']);
 assert.deepEqual(proposalActions(checked,person('SUPERVISOR','s-sup')),['return'],'the checker is not an approver and has nothing else to do');
 assert.deepEqual(proposalActions(prop({status:'Checked',checked_by:'s-mgr'}),person('MANAGER','s-mgr')),['return'],'a Manager who checked it cannot also approve it');
 assert.deepEqual(proposalActions(checked,person('ASSISTANT','s-assist')),['withdraw']);
});
test('Supervisor proposals are checked too: another Supervisor, Manager or Partner checks, then a Manager or Partner who did not check it approves',()=>{
 const sp=prop({proposed_role:'SUPERVISOR',proposed_by:'s-sup'});
 assert.deepEqual(proposalActions(sp,person('MANAGER','s-mgr')),['check','return']);assert.deepEqual(proposalActions(sp,person('SUPERVISOR','s-sup')),['withdraw']);assert.deepEqual(proposalActions(sp,person('SUPERVISOR','s-sup2')),['check','return'],'a peer Supervisor can check');
 const checked=prop({proposed_role:'SUPERVISOR',proposed_by:'s-sup',status:'Checked',checked_by:'s-sup2'});
 assert.deepEqual(proposalActions(checked,person('MANAGER','s-mgr')),['approve','return']);assert.deepEqual(proposalActions(checked,person('SUPERVISOR','s-sup2')),['return'],'the checker cannot approve and a Supervisor never approves');
 assert.deepEqual(proposalActions(prop({status:'Approved'}),person('MANAGER','s-mgr')),[],'closed proposals have no buttons');
});
test('the queue lists waiting items first with who did what, and the Propose buttons are only for Assistants and Supervisors',()=>{
 const data={me:person('MANAGER','s-mgr'),proposals:[prop({status:'Checked',checked_by:'s-sup',checked_by_name:'S. Kamau',proposed_by_name:'A. Otieno',company_name:'UAT Fictional Test Ltd',reason:'Name on certificate'}),prop({proposal_id:'p2',status:'Returned',decided_by:'s-sup',decision_note:'Missing digit',proposed_by_name:'A. Otieno'})]};
 const html=proposalsCard(data,esc,()=>'');assert.match(html,/1 waiting/);assert.match(html,/Proposed by A\. Otieno · checked by S\. Kamau/);assert.match(html,/data-proposal="approve"/);assert.match(html,/Approve and apply/);assert.match(html,/Note: Missing digit/);
 assert.equal(proposalsCard({me:person('MANAGER','m'),proposals:[]},esc),'');
 assert.equal(proposeButtons('c1','MANAGER',()=>'X',esc),'');assert.equal(proposeButtons('c1','INTERN',()=>'X',esc),'');
 const b=proposeButtons('c1','ASSISTANT',(k,l,id)=>`<button data-suite="${k}" data-id="${id}">${l}</button>`,esc);assert.match(b,/data-propose="client"/);assert.match(b,/Propose contact/);assert.match(b,/Propose owner/);
 assert.ok(canPropose('ASSISTANT')&&canPropose('SUPERVISOR')&&!canPropose('MANAGER')&&!canPropose('INTERN'));
 assert.equal(proposalsCard({me:person('ASSISTANT','s-assist'),proposals:[prop({proposed_by_name:null})]},esc,id=>id==='s-assist'?'A. Otieno':'').includes('A. Otieno'),true,'names fall back to the staff list');
});
test('the buttons send the right server action with the proposal reference',async()=>{
 const sent=[],modalFns=[],notices=[];
 const data={me:person('MANAGER','s-mgr'),clients:[{client_id:'c1',company_name:'UAT Fictional Test Ltd',kra_pin:'A123456789Z',primary_sector:'Retail',revision:3}],client_firms:[{client_id:'c1',firm_id:'f1'}],proposals:[prop({status:'Checked',checked_by:'s-sup'})]};
 document.body.innerHTML=`<button data-proposal="approve" data-id="p1" data-rev="1">Approve</button><button data-proposal="withdraw" data-id="p1" data-rev="1">W</button><button data-propose="client" data-id="c1">P</button>`;
 const ctx={$:s=>document.querySelector(s),esc,field:(n,l,v='')=>`<label>${l}<input name="${n}" value="${esc(v)}"></label>`,form:b=>b,modal:(title,html,submit,after,opts)=>modalFns.push({title,html,submit,opts}),request:async p=>{sent.push(p);return {ok:true};},load:async()=>{},notice:m=>notices.push(m),data:()=>data};
 bindProposals(ctx);
 document.querySelector('[data-proposal="approve"]').click();assert.equal(modalFns.at(-1).title,'Approve and apply');await modalFns.at(-1).submit(new Map([['note','ok']]));assert.deepEqual(sent.at(-1),{action:'client_proposal_approve',proposal_id:'p1',revision:'1',note:'ok'});
 document.querySelector('[data-propose="client"]').click();assert.match(modalFns.at(-1).title,/Propose a change/);assert.match(modalFns.at(-1).html,/Why is this change needed/);
 await modalFns.at(-1).submit(new Map([['company_name','UAT Fictional Renamed Ltd'],['kra_pin','A123456789Z'],['primary_sector','Retail'],['proposal_reason','Certificate']]));
 const last=sent.at(-1);assert.equal(last.action,'client_save');assert.equal(last.client_id,'c1');assert.equal(last.company_name,'UAT Fictional Renamed Ltd');assert.deepEqual(last.firm_ids,['f1']);assert.equal(last.tax_setup,undefined,'a proposal never carries project set-up');
 document.querySelector('[data-proposal="withdraw"]').click();await new Promise(r=>setTimeout(r,5));assert.equal(sent.at(-1).action,'client_proposal_withdraw');assert.deepEqual(notices,['Proposal withdrawn.']);
});
test('server wiring: the Assistant/Supervisor path creates a proposal before any handler runs, and the area map and catalogue list agree',()=>{
 const idx=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/index.ts',import.meta.url),'utf8');
 assert.match(idx,/isProposableAction\(String\(p\.action\|\|''\)\)&&\['ASSISTANT','SUPERVISOR'\]\.includes\(a\.category_code\)\)return await createProposal\(tx,a,p\)/);
 assert.ok(idx.indexOf('await requireStaffRight(tx,a,String(p.action||\'\'))')<idx.indexOf('return await createProposal(tx,a,p)'),'a switched-off right still blocks a proposal');
 assert.match(idx,/w\.proposals=/);
 const area=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/staff-access-control.mjs',import.meta.url),'utf8');assert.match(area,/client_proposal_/);
 assert.equal(fs.readFileSync(new URL('../staff-rights-catalog.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs',import.meta.url),'utf8'));
});
