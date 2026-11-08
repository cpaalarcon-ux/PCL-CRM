// Build .107c: screens and server wiring for proposed KYC files.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {proposeButtons,proposalsCard,KYC_HELP} from '../staff-proposals.mjs';
import {isProposableAction} from '../staff-rights-catalog.mjs';
import {proposalSummary} from '../supabase/functions/staff-workspace-v12/proposal-actions.ts';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const sb=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
test('Assistants and Supervisors get a Propose KYC file button; leaders do not',()=>{
 for(const r of ['ASSISTANT','SUPERVISOR'])assert.match(proposeButtons('c1',r,sb),/data-propose="kyc" data-id="c1"/);
 for(const r of ['MANAGER','PARTNER','INTERN'])assert.equal(proposeButtons('c1',r,sb),'');
 assert.match(KYC_HELP,/only Managers and Partners can open it/);
});
test('the queue offers View file to Managers and Partners only',()=>{
 const p={proposal_id:'p1',action:'compliance_evidence_save',summary:'Add KYC file: KRA_PIN (pin.pdf)',status:'Checked',proposed_by:'s1',checked_by:'s2',revision:1,payload:{document_id:'d1'}};
 const html=me=>proposalsCard({proposals:[p],me},s=>String(s??''),()=>'x');
 assert.match(html({staff_id:'s3',category_code:'MANAGER'}),/data-kyc-file="d1"/);
 assert.match(html({staff_id:'s3',category_code:'PARTNER'}),/data-kyc-file="d1"/);
 assert.doesNotMatch(html({staff_id:'s1',category_code:'ASSISTANT'}),/data-kyc-file/);
 assert.doesNotMatch(html({staff_id:'s2',category_code:'SUPERVISOR'}),/data-kyc-file/);
});
test('the action is proposable, summarised, and the server routes it',()=>{
 assert.ok(isProposableAction('compliance_evidence_save'));assert.ok(!isProposableAction('compliance_verify'));assert.ok(!isProposableAction('compliance_save'));
 assert.equal(proposalSummary('compliance_evidence_save',{document_type:'KRA_PIN',file_name:'pin.pdf'}),'Add KYC file: KRA_PIN (pin.pdf)');
 assert.equal(rd('staff-rights-catalog.mjs'),rd(fx+'staff-rights-catalog.mjs'),'both catalog copies match');
 const idx=rd(fx+'index.ts');assert.match(idx,/'Import Sources','KYC Pending'\]/);assert.match(idx,/requireAssistantEntryAuthorised\(tx,a\)/);assert.match(idx,/kycProposalAction\(tx,a,p\)/);
 assert.match(rd(fx+'kyc-upload-actions.ts'),/kyc_proposal_options/);
 assert.match(rd(fx+'staff-access-control.mjs'),/kyc_proposal_/);
 assert.match(rd(fx+'engagement-actions.ts'),/kyc_promote_document/);
 const pilot=rd('staff-pilot.mjs');assert.match(pilot,/staff-proposals\.mjs\?v=20261109-kyc-v1/);
 assert.match(rd('staff-pilot-auth.js'),/staff-pilot\.mjs\?v=\d{8}-/);
});
