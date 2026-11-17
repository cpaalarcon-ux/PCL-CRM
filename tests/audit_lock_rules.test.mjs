import test from 'node:test';import assert from 'node:assert/strict';
const R=await import('../supabase/functions/staff-workspace-v12/audit-lock-rules.mjs');
const G=await import('../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs');
const base={arrangement:null,file:null,lock:null,figuresNow:'f',notesNow:'n'};
const lock={mode:'In-house audit',figures_digest:'f',notes_digest:'n'};
test('the audit state follows the arrangement, then the audit file, then the lock',()=>{
 assert.equal(R.auditState(base).status,'not_declared');
 assert.equal(R.auditState({...base,arrangement:{mode:'Not audited'}}).status,'not_audited');
 assert.equal(R.auditState({...base,arrangement:{mode:'In-house audit'}}).status,'not_started');
 assert.equal(R.auditState({...base,file:{file_status:'Draft'}}).status,'in_progress','an audit file for the year means the year is audited in-house');
 assert.equal(R.auditState({...base,file:{file_status:'In Review'}}).label,'In-house audit in progress');
 for(const st of ['Approved','Completion'])assert.equal(R.auditState({...base,arrangement:{mode:'In-house audit'},file:{file_status:st}}).status,'ready');
 assert.equal(R.auditState({...base,arrangement:{mode:'External audit'}}).label,'External auditor pending');
 assert.equal(R.auditState({...base,arrangement:{mode:'External audit'},file:{file_status:'Approved'}}).status,'external_pending','an in-house file does not complete an external audit');
});
test('a lock holds only while the figures and the notes are the ones it was made against',()=>{
 const ok=R.auditState({...base,lock});assert.equal(ok.status,'locked');assert.equal(ok.locked,true);assert.equal(R.auditWording(ok),'Audited');
 for(const x of [{figuresNow:'f2'},{notesNow:'n2'}]){const st=R.auditState({...base,lock,...x});assert.equal(st.status,'stale');assert.equal(st.locked,false);assert.equal(R.auditWording(st),'Draft');assert.equal(R.auditCheck(st).status,'Blocked');}
 assert.equal(R.auditState({...base,lock:{...lock,mode:'External audit'}}).label,'Audited: external auditor');
});
test('the pack check: Info when no audit is required, Pass only when locked, otherwise Blocked with the reason',()=>{
 const c=o=>R.auditCheck(R.auditState({...base,...o}));
 assert.equal(c({}).status,'Info');assert.equal(c({arrangement:{mode:'Not audited'}}).status,'Info');
 assert.equal(c({lock}).status,'Pass');
 assert.match(c({arrangement:{mode:'In-house audit'}}).detail,/has not started/);assert.match(c({file:{file_status:'Draft'}}).detail,/in progress/);
 assert.match(c({file:{file_status:'Approved'}}).detail,/did not prepare/);assert.match(c({arrangement:{mode:'External audit'}}).detail,/signed audit report/);
 for(const o of [{arrangement:{mode:'In-house audit'}},{file:{file_status:'Draft'}},{arrangement:{mode:'External audit'}}])assert.equal(c(o).status,'Blocked');
});
test('the figures digest input is the coded lines of the two primary statements only',()=>{
 const f=R.figuresInput({profit_or_loss:{rows:[{kind:'heading',label:'x'},{code:'PL.REVENUE',current:5,note:1}]},financial_position:{rows:[{code:'SFP.CASH',current:7}]}});
 assert.deepEqual(f,{profit_or_loss:[['PL.REVENUE',5]],financial_position:[['SFP.CASH',7]]});
});
test('the gate treats the audit lock as a final step; an Info check is ignored',()=>{
 const gate={checks:[{code:'SIGN_OFF',label:'Sign-off',ok:true}],warnings:[]};
 const pack=st=>({checks:['REPORTING_BASIS','MAP_APPROVED','NO_LEGACY','NO_UNRESOLVED','COMPARATIVES'].map(code=>({code,label:code,status:'Pass'})).concat([{code:'AUDIT_LOCKED',label:'Audit complete and pack locked',status:st.status,detail:st.detail||''}])});
 const g=st=>G.annualGate({gate,pack:pack(st),statementProblems:[]});
 assert.equal(g({status:'Info'}).ready,true);assert.equal(g({status:'Info'}).checks.some(c=>c.code==='A_AUDIT_LOCKED'),false);
 assert.equal(g({status:'Pass'}).ready,true);assert.equal(g({status:'Pass'}).mark,'FINAL');
 const b=g({status:'Blocked',detail:'The in-house audit is in progress.'});assert.equal(b.ready,false);assert.equal(b.ready_for_review,true);assert.equal(b.mark,'DRAFT');assert.deepEqual(b.failing,['A_AUDIT_LOCKED']);
});
