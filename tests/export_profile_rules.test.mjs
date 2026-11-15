import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {RETURNS,profileFields,profileInForce,applyRounding,roundUpCents} from '../supabase/functions/staff-workspace-v12/export-profile-rules.mjs';
import {buildFile} from '../supabase/functions/staff-workspace-v12/statutory-file-rules.mjs';
import {profileRows} from '../staff-export-profiles.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const base={return_code:'NSSF',template_version:'NSSF Year 4',effective_from:'2026-10-01',rounding_rule:'ROUND_UP_WHOLE',rounded_columns:['GROSS PAY']};
test('profile fields: each return allows only what it can honour',()=>{
 assert.equal(profileFields(base).values.authority,'NSSF');
 assert.match(profileFields({...base,rounded_columns:['PAYROLL NUMBER']}).problem,/cannot be rounded/);
 assert.match(profileFields({...base,rounded_columns:[]}).problem,/Choose the columns/);
 assert.match(profileFields({...base,rounding_rule:'EXACT_2DP'}).problem,/Exact amounts do not round/);
 assert.match(profileFields({return_code:'SHIF',template_version:'v',effective_from:'2026-01-01'}).problem,/at least one accepted ID type/);
 assert.deepEqual(profileFields({return_code:'SHIF',template_version:'v',effective_from:'2026-01-01',accepted_id_types:['National ID','Passport','Alien ID']}).values.accepted_id_types,['National ID','Passport','Alien ID']);
 assert.match(profileFields({return_code:'SHIF',template_version:'v',effective_from:'2026-01-01',accepted_id_types:['Licence']}).problem,/National ID, Passport and Alien ID/);
 assert.match(profileFields({...base,employer_housing_levy:'SEPARATE_SHEET'}).problem,/PAYE return only/);
 assert.equal(profileFields({return_code:'PAYE_P10',template_version:'v',effective_from:'2026-01-01',employer_housing_levy:'SEPARATE_SHEET'}).values.employer_housing_levy,'SEPARATE_SHEET');
 assert.match(profileFields({...base,effective_to:'2026-09-01'}).problem,/last day cannot be before/);
 assert.match(profileFields({...base,return_code:'X'}).problem,/Choose the return/);
});
test('a month uses the profile in force on its last day; a later version never changes an earlier month',()=>{
 const v1={return_code:'NSSF',version:1,status:'Published',effective_from:'2026-01-01',effective_to:'2026-09-30'},v2={return_code:'NSSF',version:2,status:'Published',effective_from:'2026-10-01',effective_to:null},d={return_code:'NSSF',version:3,status:'Draft',effective_from:'2026-01-01'};
 assert.equal(profileInForce([v1,v2,d],'NSSF','2026-09-30').version,1);assert.equal(profileInForce([v1,v2,d],'NSSF','2026-10-31').version,2);
 assert.equal(profileInForce([v1,v2],'NSSF','2025-12-31'),null);assert.equal(profileInForce([d],'NSSF','2026-05-31'),null,'a draft never applies');assert.equal(profileInForce([v1,v2],'SHIF','2026-05-31'),null);
});
test('rounding up happens in the export only and the difference is stored; exact amounts are untouched',()=>{
 assert.equal(roundUpCents(10000),10000);assert.equal(roundUpCents(10001),10100);assert.equal(roundUpCents(8000040),8000100);
 const r=applyRounding(['A','GROSS PAY'],[['x',100000.2],['y',50000]],{rounding_rule:'ROUND_UP_WHOLE',rounded_columns:['GROSS PAY']});
 assert.deepEqual(r.rows,[['x',100001],['y',50000]]);assert.deepEqual(r.rounding['GROSS PAY'],{exact:150000.2,rounded:150001,difference:0.8});
 const rows=[['x',1.1]];assert.deepEqual(applyRounding(['A','B'],rows,{rounding_rule:'EXACT_2DP',rounded_columns:[]}).rows,rows);assert.equal(rows[0][1],1.1,'the input rows are not mutated');
});
test('SHIF identifiers are checked against the profile and named, never changed',()=>{
 const employees=[{name:'E1',pin:'A000000001Z',employee_id:'20000001',source_row:2,resident:true,employment_type:'Permanent'}],calculated=[{source_row:2,gross:1000,paye:0,employee_nssf:0,employer_nssf:0,shif:27.5,employee_ahl:15,employer_ahl:15,nita:50,taxable:900,personal_relief:2400,insurance_relief:0,taxable_benefits:0}];
 const people=[{kra_pin:'A000000001Z',national_id:'20000001',phone:'0712345678',surname:'S',other_names:'O',id_type:'Alien ID',sha_number:'H1',payroll_number:'P1'}];
 const ok=buildFile('SHIF',{employees,calculated,people,profile:{profile_id:'x',version:1,accepted_id_types:['National ID','Passport','Alien ID']}});assert.deepEqual(ok.issues,[]);assert.equal(ok.rows[0][3],'Alien ID');
 const bad=buildFile('SHIF',{employees,calculated,people,profile:{profile_id:'x',version:1,accepted_id_types:['National ID']}});assert.match(bad.issues[0],/Alien ID is not accepted/);
 assert.match(buildFile('SHIF',{employees,calculated,people}).issues.join(' '),/No published export profile/);
});
test('P10 Sheet M carries employee, employer and total; Section E item 7 stays employee only',()=>{
 const employees=[{name:'E1',pin:'A000000001Z',employee_id:'1',source_row:2,resident:true,employment_type:'Permanent'}],calculated=[{source_row:2,gross:100000,paye:20000,employee_nssf:2160,employer_nssf:2160,shif:2750,employee_ahl:1500,employer_ahl:1500,nita:50,taxable:90000,personal_relief:2400,insurance_relief:0,taxable_benefits:0}];
 const people=[{kra_pin:'A000000001Z'}],on=buildFile('PAYE_P10',{employees,calculated,people,profile:{profile_id:'x',version:1,employer_housing_levy:'SEPARATE_SHEET'}}),off=buildFile('PAYE_P10',{employees,calculated,people,profile:{profile_id:'x',version:1,employer_housing_levy:'NOT_DECLARED'}});
 assert.equal(on.section_e.housing_levy_employee,150000);assert.deepEqual(on.extra_tables[0].rows,[['A000000001Z','E1',1500,1500,3000]]);assert.equal(off.extra_tables.length,0);assert.ok(off.notes.some(x=>/does not show the employer share/.test(x)));
});
test('settings screen: list shows state and only the right buttons; module is wired with a cache token',()=>{
 const list=[{profile_id:'p1',return_code:'NSSF',return_label:'NSSF monthly return',authority:'NSSF',version:1,template_version:'Y3',rounding_rule:'ROUND_UP_WHOLE',rounding_label:'Round up',rounded_columns:['GROSS PAY'],accepted_id_types:[],status:'Draft',provenance:'Starter',effective_from:'2026-01-01',effective_to:null,created_by:null,revision:'1',used_by:0},
  {profile_id:'p2',return_code:'SHIF',return_label:'SHIF',authority:'SHA',version:1,template_version:'v',rounding_rule:'EXACT_2DP',rounding_label:'Exact',rounded_columns:[],accepted_id_types:['Passport'],status:'Published',effective_from:'2026-01-01',effective_to:null,verified_on:'2026-11-15',verified_against:'SHA upload',created_by:'m',revision:'2',used_by:2}];
 const html=profileRows(list,{me:'m',leader:true,today:'2026-11-15'});
 assert.match(html,/Starter draft, not yet confirmed/);assert.match(html,/data-ep="publish"[^>]*data-id="p1"/);assert.doesNotMatch(html,/data-ep="revise"[^>]*data-id="p1"/,'a starter draft has no author to revise it');assert.match(html,/In force/);assert.match(html,/data-ep="end"[^>]*data-id="p2"/);assert.doesNotMatch(html,/data-ep="retire"[^>]*data-id="p2"/,'a used profile is ended, not retired');
 assert.doesNotMatch(profileRows(list,{me:'x',leader:false,today:'2026-11-15'}),/data-ep=/);
 const suite=rd('staff-suite.mjs');assert.match(suite,/staff-export-profiles\.mjs\?v=20261116-profiles-v1/);assert.match(suite,/exportProfiles\.card\(\)/);assert.match(suite,/exportProfiles\.handle/);
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/exportProfileAction/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/export_profile_/);
 assert.deepEqual(Object.keys(RETURNS),['NSSF','SHIF','PAYE_P10']);
});
