import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {cleanServiceRule,serviceScope,APPLICABILITY,cleanProfile,cleanSelections,missingInfo,attentionReasons,profileStatus,cleanDecision,PEP_NONE} from '../supabase/functions/staff-workspace-v12/aml-rules.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const L=(category,value,attention=false,status='Confirmed')=>({category,value,attention,status});
const lookups=[L('COUNTRY','Kenya'),L('COUNTRY','Uganda'),L('PEP_TYPE',PEP_NONE),L('PEP_TYPE','Domestic PEP',true),L('SOURCE_OF_FUNDS','Business income'),L('SERVICE_ACTIVITY','Audit'),L('SERVICE_ACTIVITY','Managing client money or assets',true),L('COUNTRY','Old',false,'Ended')];
const attentionOf=(c,v)=>!!lookups.find(l=>l.category===c&&l.value===v)?.attention;

test('staff may only save facts, and every choice must be on the MLRO\'s list',()=>{
 const ok=cleanProfile({purpose_of_relationship:' Tax  compliance ',pep_type:'Domestic PEP',screening_status:'No match',screening_list_date:'2026-11-01'},{pepTypes:['Domestic PEP',PEP_NONE]});
 assert.equal(ok.ok,true);assert.equal(ok.value.purpose_of_relationship,'Tax compliance');
 assert.equal(cleanProfile({pep_type:'Invented'},{pepTypes:[PEP_NONE]}).ok,false);
 assert.equal(cleanProfile({screening_list_date:'31/02/2026'}).ok,false);assert.equal(cleanProfile({screening_status:'Maybe'}).ok,false);
 assert.equal('risk_rating' in cleanProfile({risk_rating:'Low'}).value,false,'rating is the MLRO\'s, never saved by staff');
 const s=cleanSelections([{category:'COUNTRY',context:'Counterparties',value:'uganda'},{category:'COUNTRY',context:'Counterparties',value:'Uganda'},{category:'COUNTRY',value:'Kenya'},{category:'COUNTRY',context:'Counterparties',value:'Old'},{category:'SERVICE_ACTIVITY',value:'Managing client money or assets',note:'Holds deposits'}],lookups);
 assert.equal(s.rows.length,2,'a duplicate is merged');assert.equal(s.rows[0].lookup_value,'Uganda');assert.equal(s.errors.length,2);assert.ok(s.rows[1].attention);
 assert.match(s.errors.map(e=>e.error).join(' '),/current countries list|say which part/i);
});
test('what is missing, what the MLRO looks at first, and the status names',()=>{
 const base={purpose_of_relationship:'a',expected_activity:'b',pep_type:PEP_NONE,screening_status:'No match',screening_list_source:'List',screening_list_date:'2026-11-01'};
 const sel=[{category:'COUNTRY',context:'Incorporation or residence',lookup_value:'Kenya'},{category:'SOURCE_OF_FUNDS',lookup_value:'Business income'},{category:'SERVICE_ACTIVITY',lookup_value:'Audit'}];
 assert.deepEqual(missingInfo({profile:base,selections:sel,attentionOf}),[]);
 assert.deepEqual(missingInfo({profile:{},selections:[],attentionOf}).map(m=>m.key).slice(0,3),['purpose_of_relationship','expected_activity','pep_type']);
 assert.ok(missingInfo({profile:{...base,pep_type:'Domestic PEP'},selections:sel,attentionOf}).some(m=>m.key==='pep_role'));
 assert.ok(missingInfo({profile:{...base,screening_status:'Potential match'},selections:sel,attentionOf}).some(m=>m.key==='screening_note'));
 assert.deepEqual(attentionReasons({profile:{pep_type:'Domestic PEP',screening_status:'Potential match'},selections:[{category:'SERVICE_ACTIVITY',context:'',lookup_value:'X',attention:true}],attentionOf}),['PEP: Domestic PEP','Screening: potential match','X']);
 const now='2026-11-17';
 assert.equal(profileStatus({profile:null,now}).label,'Information needed');
 assert.equal(profileStatus({profile:{stage:'Staff review'},missing:[1],now}).code,'INFO_NEEDED');
 assert.equal(profileStatus({profile:{stage:'Staff review'},missing:[],now}).code,'STAFF_REVIEW');
 assert.equal(profileStatus({profile:{stage:'MLRO review'},now}).code,'MLRO_REVIEW');
 assert.equal(profileStatus({profile:{stage:'Staff review',edd_required:true},missing:[1],now}).code,'EDD_REQUIRED');
 const d={stage:'Decided',decision:'Accept',next_review:'2027-01-01'};
 assert.equal(profileStatus({profile:d,now}).label,'Approved');assert.equal(profileStatus({profile:{...d,decision:'Accept with conditions'},now}).label,'Approved with conditions');
 assert.equal(profileStatus({profile:{...d,next_review:'2026-11-01'},now}).code,'REVIEW_DUE');
 assert.equal(profileStatus({profile:d,eddNeeded:true,eddApproved:false,now}).code,'EDD_REQUIRED');assert.equal(profileStatus({profile:d,eddNeeded:true,eddApproved:true,now}).code,'APPROVED');
 assert.equal(profileStatus({profile:{...d,decision:'Decline'},now}).code,'DECLINED');assert.equal(profileStatus({profile:{...d,decision:'Restrict'},now}).code,'RESTRICTED');
});
test('the MLRO\'s decision needs a rating, reasons, conditions where relevant, a future review date, and EDD for a PEP or High risk',()=>{
 const now='2026-11-17',good={decision:'Accept',risk_rating:'Low',risk_reasons:'Routine local client with clear records',next_review:'2027-11-17'};
 assert.equal(cleanDecision(good,{now}).ok,true);
 assert.deepEqual(cleanDecision({},{now}).errors.map(e=>e.key).sort(),['decision','next_review'.slice(0,0)||'risk_rating','risk_reasons'].sort());
 assert.ok(cleanDecision({...good,next_review:'2026-11-10'},{now}).errors.some(e=>e.key==='next_review'));
 assert.ok(cleanDecision({...good,decision:'Accept with conditions'},{now}).errors.some(e=>e.key==='decision_conditions'));
 assert.ok(cleanDecision({...good,decision:'Decline',next_review:''},{now}).errors.some(e=>e.key==='decision_reason'));
 assert.ok(cleanDecision({...good,risk_rating:'High'},{now,needsEdd:true}).errors.some(e=>e.key==='edd_note'));
 assert.equal(cleanDecision({...good,risk_rating:'High',edd_note:'Checked the public register and source of wealth evidence'},{now,needsEdd:true}).ok,true);
 assert.equal(cleanDecision({decision:'Decline',risk_rating:'High',risk_reasons:'Confirmed sanctions match',decision_reason:'Sanctions'},{now}).ok,true,'a decline needs no review date');
});
test('the screens are wired and the rules contain no hard-coded lists or weights',()=>{
 const rules=rd('supabase/functions/staff-workspace-v12/aml-rules.mjs');
 assert.ok(!/FATF|sanction list|weight|threshold\s*=/i.test(rules.replace(/\/\/.*$/gm,'')),'no screening list, weight or threshold in code');
 const imp=rd('staff-improvements.mjs');
 assert.match(imp,/staff-aml\.mjs\?v=20261121-fill-v1/);assert.match(imp,/if\(a==='aml'\)await aml\.open\(id\)/);assert.match(imp,/if\(a==='aml-queue'\)await aml\.openOverview\(\)/);
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/amlAction\(tx,a,p\)/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/\|aml_\|/);
 assert.match(rd('supabase/functions/staff-workspace-v12/engagement-actions.ts'),/POCAMLA: MLRO decision/);
 assert.match(rd('supabase/functions/staff-workspace-v12/engagement-actions.ts'),/is_mlro\(\) as ok.{0,40}fail\(403,'Only the Engagement Partner or the appointed MLRO may approve enhanced due diligence/s);
 assert.match(rd('staff-pilot.css'),/#editor:has\(\.am\)/);
});

test('build 2856: a service rule needs a choice, a reason and a source; activities must be on the MLRO list; Not relevant lists none',()=>{
 const acts=['Managing client money or assets','Audit'];
 const ok=cleanServiceRule({applicability:'Refer to the MLRO',reason:'Handles client money',source:'MLRO memo 1',activities:['audit']},{activityValues:acts});
 assert.equal(ok.ok,true);assert.deepEqual(ok.value.activities,['Audit'],'the MLRO\'s own spelling is kept');
 assert.deepEqual(APPLICABILITY,['Not relevant','Ask AML questions','Refer to the MLRO']);
 const bad=cleanServiceRule({applicability:'Sometimes',reason:'no',source:'',activities:['Made up'],effective_from:'2026-13-45'},{activityValues:acts});
 assert.equal(bad.ok,false);assert.deepEqual(bad.errors.map(e=>e.key).sort(),['activities','applicability','effective_from','reason','source']);
 assert.equal(cleanServiceRule({applicability:'Not relevant',reason:'Pure internal training',source:'MLRO memo',activities:['Audit']},{activityValues:acts}).ok,false);
 assert.equal(cleanServiceRule({applicability:'Not relevant',reason:'Pure internal training',source:'MLRO memo'},{activityValues:acts}).ok,true);
 // duplicate activities collapse
 assert.deepEqual(cleanServiceRule({applicability:'Ask AML questions',reason:'Because',source:'Memo',activities:['Audit','audit']},{activityValues:acts}).value.activities,['Audit']);
});
test('build 2856: no rule is "not decided" and is never read as exempt; a flagged service says whether the profile is approved',()=>{
 const u=serviceScope(null);assert.equal(u.code,'UNDECIDED');assert.equal(u.needs_flag,false);assert.match(u.line,/not treated as exempt/);
 assert.equal(serviceScope({applicability:'Not relevant'}).needs_flag,false);
 const a=serviceScope({applicability:'Ask AML questions'},{profileCode:'INFO_NEEDED'});assert.equal(a.code,'ASK');assert.equal(a.needs_flag,true);assert.equal(a.cleared,false);assert.match(a.line,/MLRO queue/);
 const r=serviceScope({applicability:'Refer to the MLRO'},{profileCode:'APPROVED'});assert.equal(r.code,'REFER');assert.equal(r.cleared,true);assert.match(r.line,/already approved/);
 assert.equal(serviceScope({applicability:'Refer to the MLRO'},{profileCode:'APPROVED_COND'}).cleared,true);
 assert.equal(serviceScope({applicability:'Refer to the MLRO'},{profileCode:'REVIEW_DUE'}).cleared,false);
});
