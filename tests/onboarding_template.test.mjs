import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const R=await import('../supabase/functions/staff-workspace-v12/onboarding-template-rules.ts');
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sheet=(heads,rows)=>({heads:heads.map(h=>h.toLowerCase()),rowCount:rows.length+1,cell:(r,c)=>String((rows[r-2]||[])[c]??'').trim()});
const AH=['Client','Client KRA PIN','Type','Purpose of relationship','Expected activity','Expected size','Any owner politically exposed?','Source of funds','Details confirmed','Exception','Risk rating','Condition','Notes'];
const OH=['Line','Full name','ID type','Owner KRA PIN','Nationality','Ownership %','Role / control basis','Holding type','Identity document sighted?','Sighted on','Sighted by','Politically exposed?','Notes'];
const CH=['Contact full name','Job title','Email','Phone','Role in decisions','Notes'];
const TH=['Income tax registered','VAT registered','PAYE registered','eTIMS onboarded','KYC documents on file','Engagement letter signed','Notes'];
const base=()=>({
 aml:sheet(AH,[['Fictional Traders Ltd','P000000001A','Private Limited Company','Bookkeeping','Monthly returns','Small','No','Trading','Yes','','High','Sneaky condition','']]),
 owners:sheet(OH,[['Owner 1','Test Owner One','National ID','A000000002B','Kenyan','60','Director and shareholder','Direct','Yes','15/10/2026','Test Preparer','No',''],['Owner 2','Test Owner Two','Passport','','Kenyan','40','Shareholder','Direct','No','','','No','']]),
 contacts:sheet(CH,[['Test Contact','Accountant','test@example.com','0712345678','Day-to-Day Contact','']]),
 tax:sheet(TH,[['Yes','Yes','No','Yes','Yes','Yes','']])});
const run=(m=base())=>R.checkOnboardingTabs(m,{now:'2026-11-25'});
test('a good fictional form passes and keeps no identity number',()=>{
 const r=run();assert.deepEqual(r.errors,[]);assert.equal(r.clients.length,1);
 const c=r.clients[0];assert.equal(c.owners.length,2);assert.equal(c.contact.phone_number,'+254712345678');assert.equal(c.contact.role_in_decision,'Day-to-Day Contact');
 assert.equal(c.owners[0].sighted,true);assert.equal(c.owners[1].sighted,false);
 assert.ok(r.notices.some(n=>/for the MLRO/.test(n.issue)),'MLRO-only columns ignored');
 assert.ok(!JSON.stringify(c).includes('Sneaky'));
});
test('an identity-number column is ignored with a notice',()=>{
 const m=base();m.owners=sheet([...OH,'ID number'],[['Owner 1','Test Owner One','National ID','','Kenyan','100','Director','Direct','No','','','No','','99887766']]);
 const r=run(m);assert.deepEqual(r.errors,[]);assert.ok(r.notices.some(n=>/identity-document number/.test(n.issue)));assert.ok(!JSON.stringify(r.clients).includes('99887766'));
});
test('every problem is reported with a row and a suggestion, and ownership over 100 fails',()=>{
 const m=base();
 m.aml=sheet(AH,[['X','BADPIN','','','','','Maybe','','','','','','']]);
 m.owners=sheet(OH,[['Owner 1','A','Voter card','','','70','Wizard','Sideways','Yes','','','',''],['Owner 2','B','','','','50','','','','','','','']]);
 m.contacts=sheet(CH,[['','','not-an-email','12','Boss','']]);
 const r=run(m);assert.ok(r.errors.length>=8);for(const e of r.errors){assert.ok(e.row>=1);assert.ok(e.column);assert.ok(e.issue)}
 const t=JSON.stringify(r.errors);assert.match(t,/not a valid KRA PIN/);assert.match(t,/more than 100/);assert.match(t,/Sighted by/);
});
test('the owners of a client must total 100%: a total short of 100 fails',()=>{
 const m=base();m.owners=sheet(OH,[['Owner 1','Test Owner One','National ID','','Kenyan','60','Director','Direct','No','','','No',''],['Owner 2','Test Owner Two','National ID','','Kenyan','30','Director','Direct','No','','','No','']]);
 const r=run(m);assert.equal(r.errors.length,1);assert.match(r.errors[0].issue,/shares add to 90%\. They must total 100%/);assert.equal(r.errors[0].column.includes('Ownership %'),true);
 const ok=base();ok.owners=sheet(OH,[['Owner 1','Test Owner One','National ID','','Kenyan','33.33','Director','Direct','No','','','No',''],['Owner 2','Test Owner Two','National ID','','Kenyan','33.33','Director','Direct','No','','','No',''],['Owner 3','Test Owner Three','National ID','','Kenyan','33.34','Director','Direct','No','','','No','']]);
 assert.deepEqual(run(ok).errors,[]);
});
test('a wrong template is refused up front',()=>{const m=base();m.owners=sheet(['Name'],[]);const r=run(m);assert.equal(r.errors.length,1);assert.match(r.errors[0].issue,/v3\.1/)});
test('duplicate PIN and a future sighting date fail',()=>{
 const m=base();m.aml=sheet(AH,[['A','P000000001A','','','','','No','','Yes','','','',''],['B','P000000001A','','','','','No','','Yes','','','','']]);
 m.owners=sheet(OH,[['O','X','','','','100','Director','Direct','Yes','01/12/2026','Me','','']]);
 const t=JSON.stringify(run(m).errors);assert.match(t,/appears twice/);assert.match(t,/in the future|not a valid date/);
});
test('batch checks: dates, derived review dates and completeness',()=>{
 const full={checks:Object.fromEntries(R.CHECKS.map(([k])=>[k,{on:'2026-11-20',by:'Test MLRO',method:'List A',result:'No match'}])),evidence_reference:'Folder X',uncovered_clients:'None',staff_register_checked_on:'2026-11-20',conditions_cleared:'Yes',decision_date:'2026-11-25'};
 const r=R.cleanBatchChecks(full,{now:'2026-11-25'});assert.ok(r.ok);assert.ok(r.complete);assert.equal(r.value.next_screening_due,'2027-03-25');assert.equal(r.value.full_review_due,'2028-11-25');
 assert.equal(R.addMonths('2026-10-31',4),'2027-02-28');
 const bad=R.cleanBatchChecks({...full,checks:{...full.checks,pep:{on:'2030-01-01'}}},{now:'2026-11-25'});assert.equal(bad.ok,false);
 const part=R.cleanBatchChecks({evidence_reference:'x'},{now:'2026-11-25'});assert.ok(part.ok);assert.equal(part.complete,false);
});
test('the confirmation PDF is generated from stored data with the schedule',async()=>{
 const {onboardingConfirmationPdf}=await import('../supabase/functions/staff-workspace-v12/onboarding-confirmation-pdf.mjs');
 const PDFLib=createRequire(import.meta.url)(path.resolve(import.meta.dirname,'..','supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));
 const full=R.cleanBatchChecks({checks:Object.fromEntries(R.CHECKS.map(([k])=>[k,{on:'2026-11-20',by:'Test MLRO',method:'List A',result:'No match'}])),evidence_reference:'Folder X',uncovered_clients:'None',staff_register_checked_on:'2026-11-20',conditions_cleared:'Yes',decision_date:'2026-11-25'},{now:'2026-11-25'}).value;
 const batch={batch_ref:'OB-20261125-TEST',...full};
 const t=R.confirmationText(batch,[{n:1,name:'Fictional Traders Ltd',pin:'P000000001A',activity:'Trading',rating:'Low',condition:'None'}]);
 assert.match(JSON.stringify(t),/Fictional Traders Ltd/);assert.match(JSON.stringify(t),/OB-20261125-TEST/);
 const bytes=await onboardingConfirmationPdf(t,{firm:'Test Firm',issued_at:'2026-11-25',digest:'abc123'},PDFLib);
 const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);assert.equal(Buffer.from(u.slice(0,4)).toString(),'%PDF');
});
test('rights, wiring, privacy and the maker-checker guards are in place',()=>{
 const rights=rd('staff-action-rights.mjs'),fn=rd('supabase/functions/staff-workspace-v12/staff-action-rights.mjs');
 assert.equal(rights.includes('onboarding_batch_accept'),true);assert.equal(fn.includes('onboarding_batch_accept'),true);
 const i=rd('supabase/functions/staff-workspace-v12/index.ts');assert.match(i,/onboarding_template/);
 assert.match(rd('staff-pilot.mjs'),/data-onboarding-batches/);
 const a=rd('supabase/functions/staff-workspace-v12/onboarding-template-actions.ts');
 assert.match(a,/is_mlro|mlro/i);assert.doesNotMatch(a,/identity_reference\s*[:=]\s*[a-z.]*owner[a-z.]*\.(id|identity)_?number/i);
 const m=rd('supabase/migrations/20261214400000_mlro_template.sql');
 assert.match(m,/onboarding_mlro_may_write/);assert.match(m,/no_delete/);assert.match(m,/identity_sighted_by/);
});
