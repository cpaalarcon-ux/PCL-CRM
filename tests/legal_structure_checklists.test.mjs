import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {kycGaps,kycRequiredCodes} from '../supabase/functions/staff-workspace-v12/engagement-actions.ts';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
test('Legal structure Builds 2 and 3: every pair has a KYC checklist and a suggested taxpayer classification',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 const pairs=await tx`select structure,subtype from erp_private.legal_structure_types order by 1,2`;assert.equal(pairs.length,33);
 const req=async(st,sub)=>await tx`select rule_code,requirement,note from erp_private.legal_structure_requirements where structure=${st} and subtype=${sub} order by sort_order`;
 const required=async(st,sub)=>(await req(st,sub)).filter(r=>r.requirement==='Required').map(r=>r.rule_code);
 // Every pair has a checklist, every checklist asks for a KRA PIN, and every pair has a suggested classification.
 for(const p of pairs){
  const rows=await req(p.structure,p.subtype);assert.ok(rows.length>=3,`${p.subtype} has a checklist`);
  assert.ok((await required(p.structure,p.subtype)).includes('KRA_PIN'),`${p.subtype} requires a KRA PIN`);
  const d=(await tx`select taxpayer_class,profile_entity_type,rule_status from erp_private.legal_structure_tax_defaults where structure=${p.structure} and subtype=${p.subtype}`)[0];
  assert.ok(d&&d.taxpayer_class,`${p.subtype} has a taxpayer classification`);assert.equal(d.rule_status,'Suggested');
 }
 // Nothing is lighter than the older entity-type lists.
 const legacy=async ent=>(await tx`select rule_code from erp_private.kyc_evidence_rules where ${ent}=any(required_for_entities) and rule_code in('REGISTRATION_IDENTITY','KRA_PIN','DIRECTORS_CR12','REGISTER_MEMBERS','BENEFICIAL_OWNERSHIP')`).map(r=>r.rule_code);
 for(const sub of ['Private Limited Company','Public Limited Company','Company Limited by Guarantee'])for(const c of await legacy('Company'))assert.ok((await required('Limited Company',sub)).includes(c),`${sub} keeps ${c}`);
 for(const sub of ['General Partnership','Limited Liability Partnership (LLP)','Limited Partnership'])for(const c of await legacy('Partnership'))assert.ok((await required('Partnership',sub)).includes(c),`${sub} keeps ${c}`);
 for(const c of await legacy('Sole proprietor'))assert.ok((await required('Individual','Sole Proprietor')).includes(c),`Sole Proprietor keeps ${c}`);
 // Subcategory specifics.
 assert.equal((await req('Non-Profit Organisation','NGO')).find(r=>r.rule_code==='REGISTRATION_IDENTITY').note,'NGO Coordination Board certificate');
 assert.ok((await required('Non-Profit Organisation','PBO')).includes('PBO_EXEMPTION'));assert.ok(!(await required('Non-Profit Organisation','NGO')).includes('PBO_EXEMPTION'));
 assert.ok((await required('Partnership','Limited Liability Partnership (LLP)')).includes('BENEFICIAL_OWNERSHIP'));assert.ok(!(await required('Partnership','General Partnership')).includes('BENEFICIAL_OWNERSHIP'));
 assert.ok((await required('Other','Estate')).includes('PROBATE_LETTERS'));assert.ok((await required('Public Entity','Government Ministry')).includes('ESTABLISHING_INSTRUMENT'));
 assert.ok(!(await required('Public Entity','Government Ministry')).includes('REGISTRATION_IDENTITY'),'a ministry has no registration certificate');
 const docs=(await req('Limited Company','Private Limited Company')).filter(r=>r.requirement==='Permanent file').map(r=>r.rule_code);assert.deepEqual(docs.sort(),['BANK_MANDATE','MINUTES','PRIOR_FINANCIALS']);
 // The new evidence kinds are Testing rules waiting for the Compliance Lead; the old five are untouched.
 const newRules=await tx`select rule_code,rule_status,required_for_entities from erp_private.kyc_evidence_rules where rule_code in('NATIONAL_ID','PARTNERSHIP_DEED','GOVERNING_DOCUMENT','PBO_EXEMPTION','SACCO_LICENCE','BANK_MANDATE')`;
 assert.equal(newRules.length,6);for(const r of newRules){assert.equal(r.rule_status,'Testing');assert.deepEqual(r.required_for_entities,[],'the older entity-type path never asks for it');}
 assert.deepEqual((await tx`select rule_code from erp_private.kyc_evidence_rules where 'Company'=any(required_for_entities) order by 1`).map(r=>r.rule_code),['BENEFICIAL_OWNERSHIP','DIRECTORS_CR12','KRA_PIN','REGISTER_MEMBERS','REGISTRATION_IDENTITY']);
 // Taxpayer classification: Company only for companies; Partnership for partnerships; Individual for individuals; obligations are valid profile kinds.
 const defs=await tx`select structure,subtype,profile_entity_type,suggested_obligations,note from erp_private.legal_structure_tax_defaults`;
 for(const d of defs){
  const want={'Limited Company':'Company','Partnership':'Partnership'}[d.structure]||(d.structure==='Individual'?'Individual':'Other');assert.equal(d.profile_entity_type,want,d.subtype);
  assert.equal(d.suggested_obligations.includes('Company'),want==='Company',d.subtype);assert.equal(d.suggested_obligations.includes('Partnership'),want==='Partnership',d.subtype);assert.equal(d.suggested_obligations.includes('Individual'),want==='Individual',d.subtype);
 }
 assert.deepEqual(defs.find(d=>d.subtype==='Estate').suggested_obligations,[]);
 // Income tax is charged on profit: non-profits and public bodies pay payroll taxes only; co-operatives, trusts and similar bodies carry the income-tax position.
 const incomeTax=['Company','Partnership','Individual','Instalment tax','Advance tax','Other entity income tax','Exempt body return'];
 for(const d of defs.filter(d=>['Non-Profit Organisation','Public Entity'].includes(d.structure))){assert.ok(!d.suggested_obligations.some(x=>incomeTax.includes(x)),d.subtype+' has no income-tax obligation');assert.ok(d.suggested_obligations.includes('PAYE'),d.subtype);assert.match(d.note,/payroll taxes/i,d.subtype);}
 for(const d of defs.filter(d=>d.structure==='Co-operative Society'||['Trust','Association','Chama or Investment Group','Other registered entity'].includes(d.subtype)))assert.ok(d.suggested_obligations.includes('Other entity income tax'),d.subtype);
 assert.ok(!defs.some(d=>d.suggested_obligations.includes('Exempt body return')));
 assert.ok(defs.find(d=>d.subtype==='Government Ministry').suggested_obligations.includes('Withholding VAT agent'));
 // The two sign-offs exist for the Compliance Lead and the Tax Lead.
 assert.deepEqual((await tx`select check_code,owner_position from erp_private.release_checks where check_code in('LSCHECKLISTS','LSTAXCLASS') order by 1`).map(r=>[r.check_code,r.owner_position]),[['LSCHECKLISTS','Compliance Lead'],['LSTAXCLASS','Tax Lead']]);
 // Reference rows cannot be deleted.
 await assert.rejects(()=>db.exec(`delete from erp_private.legal_structure_requirements`));await assert.rejects(()=>db.exec(`delete from erp_private.legal_structure_tax_defaults`));
 // kycGaps uses the pair's Required list when there is one, otherwise the older entity-type list.
 const rules=(await tx`select rule_code,label,accepted_forms,renewal_days,required_for_entities from erp_private.kyc_evidence_rules`);
 const ev=codes=>codes.map(c=>({covered_items:[c],evidence_form:'upload',evidence_date:'2026-10-01'}));
 const ngoReq=await required('Non-Profit Organisation','NGO');
 const missing=kycGaps('Other',rules,ev(['KRA_PIN','REGISTRATION_IDENTITY']),'2026-11-06',ngoReq);
 for(const c of ['GOVERNING_DOCUMENT','OFFICE_BEARERS','BOARD_RESOLUTION'])assert.ok(missing.includes(rules.find(r=>r.rule_code===c).label),c);
 assert.ok(!missing.includes('KRA PIN')&&!missing.includes('PBO status or KRA income-tax exemption letter'),'covered and optional items do not block');
 assert.deepEqual(kycGaps('Other',rules,ev(['KRA_PIN','REGISTRATION_IDENTITY','GOVERNING_DOCUMENT','OFFICE_BEARERS','BOARD_RESOLUTION']),'2026-11-06',ngoReq),[]);
 assert.deepEqual(kycGaps('Sole proprietor',rules,ev(['KRA_PIN']),'2026-11-06'),['Registration / identity'],'no pair: older list');
 const fake=async()=>[];assert.equal(await kycRequiredCodes(fake,null,null),null);assert.equal(await kycRequiredCodes(fake,'Partnership','General Partnership'),null,'no rows: older list');
 const real=async(parts,...v)=>await tx(parts,...v);assert.ok((await kycRequiredCodes(real,'Individual','Individual Taxpayer')).includes('NATIONAL_ID'));
 // The screens carry the checklist and the suggestion.
 const suite=fs.readFileSync(root+'/staff-suite.mjs','utf8'),tax=fs.readFileSync(root+'/staff-tax-config.mjs','utf8'),acts=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/suite-actions.ts','utf8');
 assert.match(suite,/legal_structure_requirements/);assert.match(suite,/Permanent file/);assert.match(tax,/legal_structure_tax_defaults/);assert.match(tax,/Suggested taxpayer classification/);
 assert.match(acts,/legal_structure_requirements/);assert.match(acts,/legal_structure_tax_defaults/);
});
