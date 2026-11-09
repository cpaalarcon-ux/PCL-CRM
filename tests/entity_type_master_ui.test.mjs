// Step 2 (joined-practice review): the KYC screen, the server and the release checks follow the legal structure as the master entity type.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';

test('server: the KYC entity type comes from the master when the client has a legal structure',()=>{
 const s=rd(fx+'engagement-actions.ts');
 assert.match(s,/const master=\(await tx`select t\.kyc_entity_type from erp_private\.clients c join erp_private\.legal_structure_types t/);
 assert.match(s,/entity_type:master\?master\.kyc_entity_type:choice\(p\.entity_type,\['Company','Partnership','Sole proprietor','Other'\]\)/,'a client with no structure still chooses');
 assert.match(rd(fx+'workspace-read.ts'),/select structure,subtype,engine_family,kyc_entity_type,/,'the screen is given the master type');
});
test('release checks count clients that disagree with the master and tax types that differ from the suggestion',()=>{
 const s=rd(fx+'tax-config-actions.ts');
 assert.match(s,/entity_type_conflicts\(\) where problem not like 'tax profile%'\) entity_type_conflicts_with_legal_structure/);
 assert.match(s,/entity_type_conflicts\(\) where problem like 'tax profile%'\) tax_profile_type_differs_from_suggestion/);
});
test('KYC screen: entity type is read-only when it follows the structure, a dropdown otherwise',()=>{
 const s=rd('staff-suite.mjs');
 assert.match(s,/const master=\(d\(\)\.legal_structure_types\|\|\[\]\)\.find\(t=>t\.structure===c\.legal_structure&&t\.subtype===c\.legal_subtype&&t\.kyc_entity_type\)/);
 assert.match(s,/\$\{master\?`<input type="hidden" name="entity_type" value="\$\{esc\(master\.kyc_entity_type\)\}">/);
 assert.match(s,/follows the client’s Legal structure/);
 assert.match(s,/:select\('entity_type','Entity type',\['Company','Partnership','Sole proprietor','Other'\],k\.entity_type\|\|'Company'\)\}/,'legacy clients keep the dropdown');
});
test('tax profile screen: a taxpayer type that differs from the suggestion is shown, not blocked',()=>{
 const s=rd('staff-tax-config.mjs');
 assert.match(s,/differs from the type suggested by the Legal structure/);
 assert.match(s,/counted in the go-live checks until the Tax Lead confirms it/);
 assert.doesNotMatch(s,/fail\(400,[^)]*suggested by the Legal structure/);
});
test('migration: the master columns are derived and enforced, never hand-set or rewritten',()=>{
 const m=rd('supabase/migrations/20261109259000_entity_type_master.sql');
 assert.match(m,/kyc_entity_type text GENERATED ALWAYS AS/);
 assert.match(m,/CREATE TRIGGER zz_family_follows_structure/);assert.match(m,/CREATE TRIGGER zz_kyc_type_follows_structure/);assert.match(m,/CREATE TRIGGER zz_kyc_type_sync/);
 assert.doesNotMatch(m,/UPDATE erp_private\.client_tax_profiles/,'tax profiles are never rewritten');
});
test('build label and cache busters moved together',()=>{
 const rel=JSON.parse(rd(fx+'release.json')).build;assert.match(rel,/^2026-11-09\.\d{4}$/);
 assert.match(rd('staff-pilot.html'),new RegExp('data-build="'+rel.replace(/\./g,'\\.')+'"'));
 assert.match(rd('staff-suite.mjs'),/staff-tax-config\.mjs\?v=20261109-entity-v1/);
});
