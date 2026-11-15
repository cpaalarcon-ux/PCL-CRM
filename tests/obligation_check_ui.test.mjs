import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {obligationPanelHtml}=await import('../staff-obligation-check.mjs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('the obligation panel shows the four states and offers an exception only where one is allowed',()=>{
 const rows=[{code:'VAT',state:'Confirmed',reason:'',allowed:true},{code:'PAYE',state:'Not registered',reason:'PAYE is not on the profile.',allowed:false},
  {code:'TOT',state:'Exempt',reason:'Not applicable.',allowed:false,exception_status:'Requested',exception:{exception_id:'x1',requested_by:'me1',reason:'Nil returns are still filed'}},
  {code:'MRI',state:'Needs verification',reason:'No evidence.',allowed:true,exception_status:'Approved',exception:{exception_id:'x2',requested_by:'me1',reason:'Evidence arrives Friday'}}];
 const asRequester=obligationPanelHtml({rows,me:'me1',can_decide:true,blocked:'Tax work cannot be scheduled for: PAYE'},esc);
 for(const s of ['Confirmed','Not registered','Exempt','Needs verification'])assert.ok(asRequester.includes(s),s);
 assert.match(asRequester,/data-ob-request="PAYE"/);assert.doesNotMatch(asRequester,/data-ob-request="VAT"/);
 // The person who asked cannot decide their own request; a different Manager sees Approve and Reject.
 assert.doesNotMatch(asRequester,/data-ob-decide/);assert.match(asRequester,/a different Manager or Partner decides/);
 const asOther=obligationPanelHtml({rows,me:'other',can_decide:true},esc);assert.match(asOther,/data-ob-decide="Approve" data-ob-id="x1"/);assert.match(asOther,/data-ob-decide="Reject"/);
 assert.doesNotMatch(obligationPanelHtml({rows,me:'other',can_decide:false},esc),/data-ob-decide/);
 assert.match(obligationPanelHtml({rows:[]},esc),/Choose a recurring tax service/);
 assert.match(obligationPanelHtml({rows:[rows[0]],me:'a'},esc),/Every selected obligation can be scheduled/);
 // Reasons are escaped.
 assert.doesNotMatch(obligationPanelHtml({rows:[{...rows[1],reason:'<img src=x onerror=1>'}],me:'a'},esc),/<img/);
});
test('the project form mounts the panel and the server dispatches its actions',()=>{
 const v6=read('staff-workspace-v6.mjs'),pilot=read('staff-pilot.mjs'),idx=read('supabase/functions/staff-workspace-v12/index.ts'),acc=read('supabase/functions/staff-workspace-v12/staff-access-control.mjs');
 assert.match(v6,/import \{mountObligationCheck\} from '\.\/staff-obligation-check\.mjs\?v=20261115-obligation-check-v1'/);
 assert.match(v6,/id="obligationCheck"/);assert.match(v6,/mountObligationCheck\(\$\('#obligationCheck'\)/);
 assert.match(pilot,/staff-workspace-v6\.mjs\?v=20261116-reopen-v1/);
 assert.match(idx,/obligationCheckAction\(tx,a,p\)/);assert.match(acc,/\|obligation_\|/);
});
