import test from 'node:test';
import assert from 'node:assert/strict';
import {WORDING_DEFAULTS,DISCLOSURES,variantKey,variantKeys,builtInVariant,applicableEntries,requiredDisclosures,builtInText,renderText,assembleWording,validateDeclaration,validateWordingBody,wordingCheck,canonicalWording,DEFAULT_CODES} from '../supabase/functions/staff-workspace-v12/annual-pack-wording.mjs';
import {FORMS} from '../supabase/functions/staff-workspace-v12/annual-pack-legal-form.mjs';

const reporting={framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',rounding:'Whole shillings',early_application_note:'Early application of the Third Edition (2025).'};
const refs=['REVENUE','PPE','INV','REC','CASH','PAY','STAFF','TAX'];
const lib=(over={})=>Object.fromEntries(WORDING_DEFAULTS.map((d,i)=>[d.code,Object.fromEntries(variantKeys(d.code).map(k=>[k,{wording_id:'w'+i+k,version:1,status:'Approved',body:builtInVariant(d.code,k),...(over[d.code]||{})}]))]));
const decl=(over={})=>{const o={};for(const d of DISCLOSURES)o[d.code]={disclosure_id:'d_'+d.code,version:1,status:'Approved',state:d.allow_nothing?'Nothing to report':'Text',body:d.allow_nothing?null:'Fictional text for '+d.title+'.',...(over[d.code]||{})};return o;};
const base={form:FORMS.COMPANY,noteRefs:refs,entity:'Fictional Co Limited',asOf:'2026-12-31',reporting};

test('the legal-form names used by the wording match the legal-form module',async()=>{
 const src=(await import('node:fs')).readFileSync(new URL('../supabase/functions/staff-workspace-v12/annual-pack-wording.mjs',import.meta.url),'utf8');
 for(const v of Object.values(FORMS))assert.ok(src.includes("'"+v+"'"),v);
});
test('every built-in entry is valid, uses only known placeholders and covers every legal form it applies to',()=>{
 for(const d of WORDING_DEFAULTS){
  for(const f of Object.values(FORMS)){const t=builtInText(d.code,f);if(!t){assert.ok(d.forms&&!d.forms.includes(f),d.code+' has no text for '+f);continue;}assert.equal(validateWordingBody(d.code,t),null,d.code+' '+f);}
  for(const k of variantKeys(d.code))assert.equal(validateWordingBody(d.code,builtInVariant(d.code,k)),null,d.code+' '+k);
 }
 assert.equal(new Set(DEFAULT_CODES).size,DEFAULT_CODES.length);
});
test('a legal form uses its own variant where one exists and the shared one otherwise',()=>{
 assert.equal(variantKey('REPORTING_ENTITY',FORMS.PARTNERSHIP),FORMS.PARTNERSHIP);
 assert.equal(variantKey('BASIS_OF_PREPARATION',FORMS.COMPANY),FORMS.COMPANY);
 assert.equal(variantKey('BASIS_OF_PREPARATION',FORMS.PARTNERSHIP),'All');
 assert.equal(variantKey('POLICY_TAX',FORMS.PROPRIETOR),null);
 assert.doesNotMatch(builtInText('BASIS_OF_PREPARATION',FORMS.PARTNERSHIP),/Companies Act/);
 assert.match(builtInText('BASIS_OF_PREPARATION',FORMS.COMPANY),/Companies Act, 2015/);
});
test('income tax wording does not apply to a partnership or a sole proprietor',()=>{
 for(const f of [FORMS.PARTNERSHIP,FORMS.PROPRIETOR]){assert.equal(builtInText('POLICY_TAX',f),null);assert.ok(!applicableEntries({form:f,noteRefs:refs}).some(e=>e.code==='POLICY_TAX'));}
 assert.ok(applicableEntries({form:FORMS.COMPANY,noteRefs:refs}).some(e=>e.code==='POLICY_TAX'));
});
test('a policy applies only when its note exists, and its facts are required only then',()=>{
 const none=applicableEntries({form:FORMS.COMPANY,noteRefs:[]}).map(e=>e.code);
 assert.deepEqual(none,['REPORTING_ENTITY','BASIS_OF_PREPARATION','FUNCTIONAL_CURRENCY','ESTIMATES_JUDGEMENTS']);
 assert.ok(!requiredDisclosures({noteRefs:[]}).some(d=>d.code.startsWith('POLICY_')));
 assert.deepEqual(requiredDisclosures({noteRefs:['PPE']}).filter(d=>d.code.startsWith('POLICY_')).map(d=>d.code),['POLICY_PPE']);
});
test('a fully approved library and declarations assemble complete wording with real values',()=>{
 const a=assembleWording({...base,library:lib(),declarations:decl()});
 assert.deepEqual(a.problems,[]);assert.equal(a.complete,true);
 const t=k=>a.sections.find(s=>s.key===k).text;
 assert.match(t('REPORTING_ENTITY'),/^Fictional Co Limited \(the Company\) is a company incorporated and domiciled in Kenya under the Companies Act, 2015\. Its principal activity is: Fictional text for Principal activity\.$/);
 assert.match(t('BASIS_OF_PREPARATION'),/IFRS for SMEs Accounting Standard \(Third Edition \(2025\)\).*Companies Act, 2015.*Early application of the Third Edition \(2025\)\.$/);
 assert.match(t('FUNCTIONAL_CURRENCY'),/rounded to the nearest Kenya shilling/);
 assert.match(t('POLICY_PPE'),/charged on the following basis: Fictional text for Depreciation: method and rates by class\. Residual/);
 assert.equal(a.sections.find(s=>s.key==='RELATED_PARTIES').text,'Nothing to report.');
 assert.ok(!a.sections.some(s=>s.key==='POLICY_PPE'&&s.kind==='disclosure'),'policy facts are shown through the policy, not twice');
 assert.equal(wordingCheck({count:a.sections.length,problems:a.problems}).status,'Pass');
});
test('wording that is only a draft or missing blocks and names the edition',()=>{
 const l=lib({POLICY_REVENUE:{status:'Draft'}});delete l.POLICY_CASH;
 const a=assembleWording({...base,library:l,declarations:decl()});
 assert.equal(a.complete,false);
 assert.ok(a.problems.includes('Standard wording "Revenue" is not approved for Third Edition (2025).'));
 assert.ok(a.problems.includes('Standard wording "Cash and cash equivalents" is not approved for Third Edition (2025).'));
 assert.equal(wordingCheck({count:1,problems:a.problems}).status,'Blocked');
});
test('a disclosure that is missing, waiting or returned blocks and is never read as nothing to report',()=>{
 const d=decl({GOING_CONCERN:{status:'Draft'},EVENTS_AFTER:{status:'Returned'}});delete d.COMMITMENTS;
 const a=assembleWording({...base,library:lib(),declarations:d});
 assert.ok(a.problems.includes('"Going concern" is declared and waits for a Manager or Partner to approve it.'));
 assert.ok(a.problems.includes('"Events after the reporting period" was returned and needs to be declared again.'));
 assert.ok(a.problems.some(p=>/"Capital and other commitments" has not been declared/.test(p)));
 assert.equal(a.sections.find(s=>s.key==='COMMITMENTS').text,null);
});
test('a policy whose fact is not approved cannot show text and names the fact',()=>{
 const d=decl({POLICY_PPE:{status:'Draft'}});
 const a=assembleWording({...base,library:lib(),declarations:d});
 assert.ok(a.problems.some(p=>/"Property, plant and equipment" needs "Depreciation: method and rates by class" to be declared and approved/.test(p)));
 assert.equal(a.sections.find(s=>s.key==='POLICY_PPE').text,null);
});
test('missing facts block: no entity name, unknown rounding, other framework',()=>{
 const a=assembleWording({...base,entity:'',reporting:{...reporting,rounding:'Millions'},library:lib(),declarations:decl()});
 assert.ok(a.problems.some(p=>/no name on record/.test(p)));assert.ok(a.problems.some(p=>/rounding/.test(p)));
 const b=assembleWording({...base,reporting:{...reporting,framework:'IFRS Accounting Standards',edition:'As issued at the reporting date'},library:lib(),declarations:decl()});
 assert.ok(b.problems.some(p=>/no standard wording for IFRS Accounting Standards/.test(p)));
});
test('the order the user chose is kept, and anything not listed follows in the standard order',()=>{
 const a=assembleWording({...base,library:lib(),declarations:decl(),order:['CONTINGENCIES','GOING_CONCERN','NOT_A_CODE']});
 const keys=a.sections.filter(s=>s.kind==='disclosure').map(s=>s.key);
 assert.deepEqual(keys.slice(0,2),['CONTINGENCIES','GOING_CONCERN']);
 assert.deepEqual(keys.slice(2),['PRINCIPAL_ACTIVITY','RELATED_PARTIES','EVENTS_AFTER','COMMITMENTS']);
 assert.ok(!a.order.includes('NOT_A_CODE'));
});
test('declarations: nothing to report only where allowed, and no empty or placeholder text',()=>{
 assert.match(validateDeclaration({code:'GOING_CONCERN',state:'Nothing to report'}),/needs a statement/);
 assert.equal(validateDeclaration({code:'RELATED_PARTIES',state:'Nothing to report'}),null);
 assert.match(validateDeclaration({code:'RELATED_PARTIES',state:'Nothing to report',body:'something'}),/carries no text/);
 assert.match(validateDeclaration({code:'RELATED_PARTIES',state:'Text',body:'short'}),/at least 10/);
 assert.match(validateDeclaration({code:'RELATED_PARTIES',state:'Text',body:'Loan from {{director}} of KES 1'}),/placeholder/);
 assert.match(validateDeclaration({code:'NOPE',state:'Text',body:'long enough text here'}),/not one the pack uses/);
 assert.match(validateDeclaration({code:'RELATED_PARTIES',state:'Maybe'}),/Choose/);
 assert.equal(validateDeclaration({code:'RELATED_PARTIES',state:'Text',body:'The director lent the business KES 100,000.'}),null);
});
test('library wording may use only known facts and known disclosure slots',()=>{
 assert.match(validateWordingBody('POLICY_PPE','Depreciation is charged at {rate} each year on all classes.'),/\{rate\} is not a fact/);
 assert.match(validateWordingBody('POLICY_PPE','Depreciation is {{SOMETHING}} on all classes of asset.'),/not a client-specific disclosure/);
 assert.match(validateWordingBody('NOPE','long enough text for the check'),/not one the library holds/);
 assert.match(validateWordingBody('POLICY_PPE','short'),/at least 20/);
 assert.equal(validateWordingBody('POLICY_PPE','Cost less depreciation: {{POLICY_PPE}} for {entity}.'),null);
});
test('renderText lists every placeholder without a value and does not blank it',()=>{
 const r=renderText('{entity} at {year_end} {{POLICY_PPE}}',{facts:{entity:'A'},slots:{}});
 assert.deepEqual(r.missing,['POLICY_PPE','year_end']);assert.match(r.text,/\{\{POLICY_PPE\}\}/);
});
test('the canonical form changes when wording or its source version changes',()=>{
 const a=assembleWording({...base,library:lib(),declarations:decl()}),b=assembleWording({...base,library:lib({POLICY_CASH:{version:2}}),declarations:decl()});
 assert.notDeepEqual(canonicalWording(a),canonicalWording(b));
});
