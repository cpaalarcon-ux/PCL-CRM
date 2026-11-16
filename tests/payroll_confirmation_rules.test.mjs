import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const R=await import('../supabase/functions/staff-workspace-v12/payroll-confirmation-rules.mjs');
const {confirmationView,createPayrollConfirmationUI}=await import('../staff-payroll-confirmation.mjs');
const emp=(name,n,gross)=>({name,employee_id:'E'+n,pin:'A00000000'+n+'Z',gross,taxable_benefits:0});
const calc=(gross,paye)=>({gross,paye,employee_nssf:2160,shif:1000,employee_ahl:900,other_deductions:0,employer_nssf:2160,employer_ahl:900,nita:50,net_pay:gross-paye-2160-1000-900});
const payload=(a,b)=>({employees:[emp('Wanjiru','1',a),emp('Kamau','3',b)],calculated:[calc(a,20000),calc(b,8000)]});

test('snapshot is built only from the saved run, and the fingerprint input ignores everything but people and money',()=>{
 const s=R.confirmationSnapshot({payload:payload(100000,60000),prior:{employees:[emp('Wanjiru','1',90000)]},month:'2026-09',clientName:'Fictional Ltd'});
 assert.equal(s.lines.length,2);assert.equal(s.totals.employees,2);assert.equal(s.totals.gross,160000);
 assert.deepEqual(s.changes.new_staff.map(x=>x.name),['Kamau']);assert.deepEqual(s.changes.salary_changes.map(x=>x.name),['Wanjiru']);
 const s2=R.confirmationSnapshot({payload:payload(100000,60000),prior:null,month:'2026-09',clientName:'Different name',inactive:[{name:'X',from:'2026-09-01',reason:'Leave'}]});
 assert.equal(R.digestInput(s),R.digestInput(s2),'client name, prior month and inactive notes do not change what is confirmed');
 const s3=R.confirmationSnapshot({payload:payload(100000,61000),prior:null,month:'2026-09'});assert.notEqual(R.digestInput(s),R.digestInput(s3),'a pay change does');
 assert.equal(R.canonical({b:1,a:[2,{d:1,c:2}]}),R.canonical({a:[2,{c:2,d:1}],b:1}),'key order does not matter');
});
test('confirmation state: nothing blocks until a report is issued; then only a matching confirmed version passes',()=>{
 const v=(version,status,digest)=>({version,status,digest});
 assert.deepEqual([R.confirmationState([],'x').state,R.confirmationState([],'x').blocks],['Not requested',false]);
 assert.deepEqual([R.confirmationState([v(1,'Issued','a')],'a').state,R.confirmationState([v(1,'Issued','a')],'a').blocks],['Awaiting client',true]);
 assert.equal(R.confirmationState([v(1,'Issued','a')],'b').state,'Out of date');
 assert.equal(R.confirmationState([v(1,'Changes requested','a')],'a').state,'Changes requested');
 assert.equal(R.confirmationState([v(1,'Changes requested','a')],'b').state,'Out of date');
 assert.deepEqual([R.confirmationState([v(1,'Confirmed','a')],'a').state,R.confirmationState([v(1,'Confirmed','a')],'a').blocks],['Confirmed',false]);
 const stale=R.confirmationState([v(1,'Superseded','a'),v(2,'Confirmed','b')],'c');assert.equal(stale.state,'Out of date');assert.equal(stale.blocks,true);assert.match(stale.message,/version 2/);
 assert.equal(R.confirmationState([v(1,'Superseded','a'),v(2,'Confirmed','b')],'b').state,'Confirmed','only the latest version counts');
});
test('the client answer needs who, when and evidence or a note; a change request needs the change written down',()=>{
 const ok={decision:'Confirmed',responder:'Grace Achieng',on:'2026-10-02',note:'Email 2 Oct from finance',evidence:null,today:'2026-10-05'};
 assert.deepEqual(R.answerIssues(ok),[]);
 assert.deepEqual(R.answerIssues({...ok,note:'',evidence:'doc'}),[],'an attached document is enough');
 assert.match(R.answerIssues({...ok,note:'ok'}).join(' '),/Attach the client reply/);
 assert.match(R.answerIssues({...ok,responder:'Jo'}).join(' '),/who at the client/);
 assert.match(R.answerIssues({...ok,on:'2026-10-06'}).join(' '),/future/);
 assert.match(R.answerIssues({...ok,on:'2 Oct'}).join(' '),/date/);
 assert.match(R.answerIssues({...ok,decision:'Changes requested',note:'fix'}).join(' '),/changes the client asked for/);
 assert.match(R.answerIssues({...ok,decision:'Nope'}).join(' '),/Choose whether/);
});
test('the screen shows the state, every version with its answer and evidence, and escapes client-supplied text',()=>{
 const html=confirmationView({gate:{state:'Out of date',message:'The run changed after version 2.'},current_totals:{net:90000,employees:2},can_record:true,
  versions:[{confirmation_id:'c2',version:2,status:'Issued',issued_at:'2026-10-03T08:00:00Z',issued_by_name:'Asha',totals:{net:90000}},{confirmation_id:'c1',version:1,status:'Superseded',issued_at:'2026-10-01T08:00:00Z',issued_by_name:'Asha',responder_name:'<b>Grace</b>',responded_on:'2026-10-02',response_note:'Change <i>Kamau</i>',evidence_file_name:'reply.pdf',totals:{net:88000}}]},undefined,(a,l,id)=>`<button data-${a}="${id}">${l}</button>`);
 assert.match(html,/Out of date/);assert.match(html,/data-payroll-confirm-record="c2"/);assert.doesNotMatch(html,/data-payroll-confirm-record="c1"/);
 assert.match(html,/&lt;b&gt;Grace&lt;\/b&gt;/);assert.doesNotMatch(html,/<b>Grace/);assert.match(html,/evidence: reply\.pdf/);
 assert.match(html,/the payroll cannot go for review/i);
});
test('screen wiring: the run offers client confirmation, the review summary shows it, the server blocks submission, and tokens changed',()=>{
 const ui=rd('staff-period-imports.mjs'),srv=rd('supabase/functions/staff-workspace-v12/period-import-actions.ts');
 assert.match(ui,/staff-payroll-confirmation\.mjs\?v=20261116-confirm-v1/);assert.match(ui,/button\('payroll-confirm','Client confirmation'/);assert.match(ui,/payrollConfirm\.isAction\(action\)/);
 assert.match(rd('staff-payroll-review.mjs'),/Client confirmation:/);assert.match(rd('staff-workspace-v6.mjs'),/staff-period-imports\.mjs\?v=20261116-choices-v1/);
 assert.match(srv,/payrollConfirmationGate\(tx,project,r\)/);assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/payrollConfirmationAction\(tx,a,p\)/);
 assert.equal(typeof createPayrollConfirmationUI,'function');
});
