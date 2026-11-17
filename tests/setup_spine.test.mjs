// Build 2846: one list for client set-up. These tests prove three things: the steps run in the order the card has always used for its next step;
// "complete" means exactly what it meant before (plus the profile, which was already required for activities); and the card, the client file and the
// guide all read the same module, so they cannot count differently.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PHASES,CLIENT_STEPS,PROJECT_STEPS,identityChecks,buildSteps,clientSpine,projectSpine,spineHtml} from '../staff-setup-spine.mjs';
import {clientProgress,nextStep,setupCompletion,cardStatus} from '../staff-client-cards.mjs';

const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const client={client_id:'c1',kra_pin:'P000000001A',has_opening_balance:true};
const ok={verified_at:'2026-01-01'};
const tp=[{client_id:'c1',status:'Verified'}];
const ready={activity_count:2,usable_account_count:5,stock_required_count:0};
const make=(o={})=>clientProgress({client,missing:[],compliance:ok,contacts:[{}],taxProfiles:tp,readiness:ready,stagedTB:false,...o});

test('the steps and phases are defined once, in the order a preparer works through them',()=>{
 assert.deepEqual(CLIENT_STEPS.map(x=>x.key),['profile','kyc','tax','activities','opening']);
 assert.deepEqual(PROJECT_STEPS.map(x=>x.key),['source','reports','release']);
 assert.deepEqual(PHASES.map(x=>x.key),['know','books','work']);
 assert.deepEqual(PHASES.filter(x=>x.scope==='client').map(x=>x.key),['know','books']);
 assert.equal(PHASES.find(x=>x.key==='work').scope,'project','engagement checks stay per project, so that phase is not in the client count');
});

test('identityChecks is the one definition of the KYC and tax-profile facts',()=>{
 assert.deepEqual(identityChecks({client,compliance:ok,contacts:[{}],taxProfiles:tp}),{kycOk:true,kycMissing:[],taxOk:true});
 const bad=identityChecks({client:{client_id:'c1',kra_pin:' '},compliance:null,contacts:[],taxProfiles:[{client_id:'c1',status:'Draft'},{client_id:'other',status:'Verified'}]});
 assert.deepEqual(bad,{kycOk:false,kycMissing:['KRA PIN','KYC verification','a contact'],taxOk:false});
});

test('buildSteps marks the first step that is not done as the next one, and a step still loading is never offered as next to act on',()=>{
 const s=buildSteps(CLIENT_STEPS,{profile:true,kyc:true,tax:false,activities:null,opening:false});
 assert.deepEqual(s.steps.map(x=>x.state),['done','done','next','checking','todo']);
 assert.equal(s.next.key,'tax');assert.equal(s.done,2);assert.equal(s.total,5);assert.equal(s.pct,40);assert.equal(s.checking,true);assert.equal(s.allDone,false);
 const all=buildSteps(CLIENT_STEPS,{profile:true,kyc:true,tax:true,activities:true,opening:true});
 assert.equal(all.allDone,true);assert.equal(all.next,null);assert.equal(all.pct,100);
 assert.equal(buildSteps(CLIENT_STEPS,{}).done,0,'a step with no answer is not done');
});

test('the spine order is the card order: its next step is always the one nextStep() names',()=>{
 const cases=[
  [{missing:['Sector']},'profile'],[{client:{...client,kra_pin:''}},'kyc'],[{compliance:null},'kyc'],[{contacts:[]},'kyc'],[{taxProfiles:[]},'tax'],
  [{readiness:undefined},'activities'],[{readiness:{activity_count:0,usable_account_count:5,stock_required_count:0}},'activities'],
  [{client:{client_id:'c1',kra_pin:'P1',has_opening_balance:false}},'opening'],[{client:{client_id:'c1',kra_pin:'P1',has_opening_balance:false},stagedTB:true},'opening'],[{},null]
 ];
 const map={profile:['profile'],kyc:['kyc'],tax:['tax'],activities:['activities','loading'],opening:['tb-post','tb-stage']};
 for(const [o,want] of cases){
  const p=make(o),sp=clientSpine(p),step=nextStep(p);
  if(want===null){assert.equal(sp.next,null);assert.equal(step.key,'ready');continue;}
  assert.equal(sp.next.key,want,JSON.stringify(o));
  assert.ok(map[sp.next.key].includes(step.key),`${JSON.stringify(o)} -> ${step.key}`);
 }
});

test('complete means what it meant before: every old part done, and the profile (which activities already required)',()=>{
 const profiles=[[],['Sector']],kra=['P1',''],comps=[ok,null],contacts=[[{}],[]],taxes=[tp,[]],reads=[ready,undefined,{activity_count:0,usable_account_count:0}],opening=[true,false];
 let checked=0;
 for(const missing of profiles)for(const pin of kra)for(const comp of comps)for(const con of contacts)for(const t of taxes)for(const r of reads)for(const op of opening){
  const p=make({missing,client:{client_id:'c1',kra_pin:pin,has_opening_balance:op},compliance:comp,contacts:con,taxProfiles:t,readiness:r});
  const oldComplete=p.kycOk&&p.taxOk&&p.activitiesOk===true&&p.openingDone;
  const c=setupCompletion(p);
  assert.equal(c.pct===100,oldComplete,'the same clients are complete as before');
  assert.equal(cardStatus(p).key==='healthy',oldComplete,'and the same clients are Healthy');
  assert.equal(c.total,5);checked++;
 }
 assert.equal(checked,2*2*2*2*2*3*2);
});

test('the card tooltip lines are unchanged, in the same order',()=>{
 const p=make({missing:['A','B','C','D'],client:{client_id:'c1',kra_pin:'',has_opening_balance:false},compliance:null,contacts:[],taxProfiles:[],stagedTB:true});
 assert.deepEqual(setupCompletion(p).missing,['Client profile: A, B, C and 1 more','KYC and contacts: KRA PIN, KYC verification, a contact','A verified tax profile','Opening trial balance: staged, still to be posted']);
 assert.deepEqual(clientSpine(p).missing,setupCompletion(p).missing);
});

test('the project steps have their own count and do not change the client count',()=>{
 const pr=projectSpine({source:true,reports:false,release:false});
 assert.equal(pr.total,3);assert.equal(pr.done,1);assert.equal(pr.next.key,'reports');
 assert.equal(clientSpine(make()).total,5);
});

test('the client file shows the same steps and count, grouped by phase, and escapes text',()=>{
 const html=spineHtml(clientSpine(make({taxProfiles:[]})));
 assert.match(html,/Know the client/);assert.match(html,/Build the books/);assert.doesNotMatch(html,/Start the work/,'project steps are not part of the client file count');
 assert.match(html,/Set-up steps<\/b> · 4 of 5 done/);
 assert.match(html,/data-spine-step="tax"/);assert.match(html,/cc-pill warn[^>]*title="No verified tax profile yet"[^>]*data-spine-step="tax"/);
 assert.match(html,/cc-pill ok[^>]*data-spine-step="profile"/);
 assert.match(spineHtml(clientSpine(make({readiness:undefined}))),/Checking…/);
 const evil=spineHtml({checking:false,done:0,total:1,steps:[{key:'x',phase:'know',title:'<img src=x>',state:'todo',detail:'"><b>'}]},{});
 assert.doesNotMatch(evil,/<img src=x>/);assert.match(evil,/&lt;img src=x&gt;/);assert.match(evil,/title="&quot;&gt;&lt;b&gt;"/);
});

test('the card, the client file and the guide all read the one spine module under one cache token',()=>{
 const token='staff-setup-spine\\.mjs\\?v=20261118-ready-v1';
 for(const f of ['staff-client-cards.mjs','staff-client-profile.mjs','staff-setup-guide.mjs'])assert.match(read(f),new RegExp(token),f);
 const pilot=read('staff-pilot.mjs');
 for(const m of ['staff-setup-guide'])assert.match(pilot,new RegExp(m+'\\.mjs\\?v=20261118-ready-v1'),m);assert.match(pilot,/staff-client-cards\.mjs\?v=20261119-tabs-v1/);assert.match(pilot,/staff-client-profile\.mjs\?v=20261121-comply-v1/);
});

test('the guide uses the spine names, counts the client and the project separately, and groups its cards under the same phases',()=>{
 const g=read('staff-setup-guide.mjs');
 assert.match(g,/T=Object\.fromEntries\(\[\.\.\.CLIENT_STEPS,\.\.\.PROJECT_STEPS\]/);
 for(const k of ['profile','kyc','tax','activities','opening','source','reports','release'])assert.match(g,new RegExp("key:'"+k+"',title:T\\."+k),k);
 assert.match(g,/Set-up steps · \$\{clientProgress\.done\} of \$\{clientProgress\.total\}/);assert.match(g,/This project · \$\{projectProgress\.done\} of \$\{projectProgress\.total\}/);
 for(const h of ['Know the client','Build the books','Start the work'])assert.match(g,new RegExp('setup-phase[^>]*>'+h));
 for(const label of ['1 · Client profile & financial year','2 · KYC & contacts','3 · Tax profile','4a · Chart of accounts','4b · General account mappings','5 · Opening trial balance','6 · Purchases, sales, payroll & assets','7 · VAT, Income Tax & Source and Application','8 · Project release & handover'])assert.ok(g.includes("step('"+label),label);
 assert.match(g,/a==='kyc'\)ctx\.openSuite\('compliance',id\)/);assert.match(g,/a==='tax-profile'\)ctx\.openSuite\('tax-profile',id\)/);
 assert.match(read('staff-pilot.mjs'),/openSuite:\(name,id\)=>/);
});

test('this build changes presentation only: no new server action, approval or posting',()=>{
 const f=read('staff-setup-spine.mjs');
 assert.doesNotMatch(f,/request\(|fetch\(|action:/);
 assert.doesNotMatch(read('staff-setup-guide.mjs'),/action:'(?:ledger_journal_save|ledger_journal_review|ledger_journal_submit|tax_create|project_activate|compliance_save|tax_profile_save)'/);
});
