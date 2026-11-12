// Starter narration rules (build 2783): the list, what blocks a rule, and the wiring. The database behaviour is in ledger_integration.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {STARTER_RULES,starterProblem,starterList} from '../supabase/functions/staff-workspace-v12/bank-starter-rules.mjs';
import {ruleProblem} from '../supabase/functions/staff-workspace-v12/bank-rules.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const chart=new Set(['62510','62500','62570','62000','62030','51070']);

test('every starter passes the same keyword checks as a hand-typed rule',()=>{
 for(const s of STARTER_RULES){assert.equal(ruleProblem(s),null,s.key);assert.ok(s.why.length>20&&s.why.length<=280,s.key+' has a short reason');}
 assert.equal(new Set(STARTER_RULES.map(s=>s.key)).size,STARTER_RULES.length);
 assert.ok(STARTER_RULES.every(s=>s.direction==='Money out'),'all starters apply to money out only');
});

test('no blanket transfer rule and no tax rate in the list',()=>{
 assert.ok(!STARTER_RULES.some(s=>/^(trf|transfer|trans|tf)\b/i.test(s.keyword)));
 const src=rd('supabase/functions/staff-workspace-v12/bank-starter-rules.mjs');
 assert.doesNotMatch(src,/\d+(\.\d+)?\s*%/,'no percentage stored');assert.doesNotMatch(src,/ISRS 4000/);
});

test('the excise rule stays locked until the Tax Lead has confirmed',()=>{
 const ex=STARTER_RULES.find(s=>s.key==='excise-duty');assert.equal(ex.needs,'Tax Lead');assert.equal(ex.account_code,'51070');
 assert.match(starterProblem(ex,[],chart),/Tax Lead has not confirmed/);
 assert.ok(STARTER_RULES.filter(s=>s.needs).length===1);
});

test('what blocks a copy: an existing rule, or an account outside the client chart',()=>{
 const fee=STARTER_RULES.find(s=>s.key==='ledger-fee');
 assert.equal(starterProblem(fee,[],chart),null);
 assert.match(starterProblem(fee,[{keyword:'Ledger  Fee',match_mode:'Contains',direction:'Money out',status:'Proposed'}],chart),/waiting for approval/);
 assert.match(starterProblem(fee,[{keyword:'ledger fee',match_mode:'Contains',direction:'Money out',status:'Active'}],chart),/approved/);
 assert.equal(starterProblem(fee,[{keyword:'ledger fee',match_mode:'Contains',direction:'Money out',status:'Retired'}],chart),null,'a retired rule does not block');
 assert.equal(starterProblem(fee,[{keyword:'ledger fee',match_mode:'Starts with',direction:'Money out',status:'Active'}],chart),null,'a different match mode is a different rule');
 assert.match(starterProblem(fee,[],new Set(['62500'])),/62510 is not in this client's chart/);
 assert.equal(starterList([],chart).filter(s=>!s.problem).length,5);
});

test('wiring: action, access, button and build label',()=>{
 const fx='supabase/functions/staff-workspace-v12/';
 assert.match(rd(fx+'bank-lines.ts'),/ledger_bank_starter_copy/);assert.match(rd(fx+'ledger-actions.ts'),/'ledger_bank_starter_copy'/);
 assert.equal(rd('staff-rights-catalog.mjs'),rd(fx+'staff-rights-catalog.mjs'));assert.match(rd(fx+'staff-rights-catalog.mjs'),/'ledger_bank_starter_copy'/);
 const ui=rd('staff-ledger.mjs');assert.match(ui,/bank-starter/);assert.match(ui,/ledger_bank_starter_copy/);assert.match(ui,/Proposed<\/b> rule/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261111-bankfixit-v1/);
 assert.match(rd(fx+'release.json'),/2026-11-12\.2792/);assert.match(rd('staff-pilot.html'),/2026-11-12\.2792/);
});
