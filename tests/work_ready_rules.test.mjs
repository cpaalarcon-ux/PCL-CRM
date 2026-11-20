// Build 2847: Healthy means work-ready, not "every set-up section reviewed". These tests prove the gates, the progress figure, the Partner's choice,
// how the card shows them, and that this changes presentation only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workReady,setupProgress,clientReadiness,pinFormatOk,SECTION_TOTAL} from '../supabase/functions/staff-workspace-v12/work-ready-rules.mjs';
import {SECTIONS} from '../supabase/functions/staff-workspace-v12/setup-review-rules.mjs';
import {gateAction,gateReasons,progressBar,gatesHtml,statusPolicyCard} from '../staff-work-ready.mjs';
import {clientProgress,cardStatus,stateCounts,clientCard,CLIENT_STATES,chipRow} from '../staff-client-cards.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';

const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const good={client_id:'c1',kra_pin:'P051000009A',kyc_verified:true,kyc_current:true,edd_needed:false,edd_ok:false,engagements:1,engagements_with_lead:1,engagements_with_letter:1,chart:'Draft',opening:'Draft',approved_sections:[]};

test('Healthy needs exactly four things: KYC, a PIN in the right format, an engagement with a Manager or Partner, and a verified signed letter',()=>{
 const r=workReady(good);assert.equal(r.ready,true);assert.deepEqual(r.gates.map(g=>g.key),['kyc','pin','engagement','letter']);assert.deepEqual(r.open_gates,[]);
 const bad=(o,key,why)=>{const x=workReady({...good,...o});assert.equal(x.ready,false,key);assert.deepEqual(x.open_gates,[key],key);assert.match(x.gates.find(g=>g.key===key).detail,why,key);};
 bad({kyc_verified:false},'kyc',/not verified/);bad({kyc_current:false},'kyc',/review date has passed/);bad({edd_needed:true,edd_ok:false},'kyc',/Enhanced due diligence/);
 bad({kra_pin:''},'pin',/No KRA PIN/);bad({kra_pin:'P12'},'pin',/one letter, nine digits and one letter/);
 const none=workReady({...good,engagements:0,engagements_with_lead:0,engagements_with_letter:0});assert.deepEqual(none.open_gates,['engagement','letter'],'no engagement means no letter either');assert.match(none.gates[2].detail,/No engagement created/);
 assert.match(workReady({...good,engagements_with_lead:0}).gates.find(g=>g.key==='engagement').detail,/No Manager or Partner is assigned/);
 bad({engagements_with_letter:0},'letter',/No verified, current signed letter/);
 assert.equal(workReady({...good,edd_needed:true,edd_ok:true}).ready,true,'a Partner-approved EDD clears the KYC gate');
});

test('an unapproved Chart of Accounts and unfinished sections never hold Healthy back, unless a Partner has chosen otherwise',()=>{
 for(const chart of ['Draft','Pending Review','Correction Required'])assert.equal(workReady({...good,chart}).ready,true,chart);
 const on=workReady({...good,chart:'Draft'},{requireChart:true});assert.equal(on.ready,false);assert.deepEqual(on.open_gates,['chart']);assert.match(on.gates.at(-1).detail,/draft/);
 assert.equal(workReady({...good,chart:'Approved'},{requireChart:true}).ready,true);
 assert.equal(workReady(good,{requireChart:false}).gates.length,4,'off by default: the chart is not even listed');
});

test('the PIN rule is the one the client master already uses (lower case and spaces are tolerated, wrong shapes are not)',()=>{
 assert.equal(pinFormatOk('P051000009A'),true);assert.equal(pinFormatOk(' p051000009a '),true);
 for(const bad of ['','P05100009A','051000009AB','P0510000090','PP51000009A',null,undefined])assert.equal(pinFormatOk(bad),false,String(bad));
 assert.match(read('supabase/functions/staff-workspace-v12/client-master-rules.mjs'),/\[A-Z\]\[0-9\]\{9\}\[A-Z\]/);
});

test('progress counts the nine approved sections; the chart and opening trial balance are listed as needed before posting, not counted',()=>{
 assert.equal(SECTION_TOTAL,9);assert.equal(SECTIONS.length,9);
 const none=setupProgress(good);assert.deepEqual([none.sections_done,none.sections_total,none.pct],[0,9,0]);assert.equal(none.missing.length,9);assert.deepEqual(none.needed_before_posting,['Chart of Accounts','Opening Trial Balance']);
 const some=setupProgress({...good,approved_sections:['identity','tax','contacts','engagement','year_end','registration','ownership'],chart:'Approved'});
 assert.deepEqual([some.sections_done,some.pct],[7,78]);assert.deepEqual(some.missing.map(m=>m.code),['activities','permanent_file']);assert.deepEqual(some.needed_before_posting,['Opening Trial Balance']);
 const all=setupProgress({...good,approved_sections:SECTIONS.map(s=>s.code),chart:'Approved',opening:'Approved'});assert.equal(all.pct,100);assert.deepEqual(all.needed_before_posting,[]);assert.deepEqual(all.missing,[]);
 assert.equal(setupProgress({...good,approved_sections:['nonsense','identity']}).sections_done,1,'an unknown code is not counted');
 assert.equal(clientReadiness(good).client_id,'c1');
});

const prog=(o={})=>clientProgress({client:{client_id:'c1',kra_pin:'P051000009A',has_opening_balance:false},missing:[],compliance:{verified_at:'2026-01-01'},contacts:[{}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:{activity_count:0,usable_account_count:0,stock_required_count:0},stagedTB:false,...o});

test('the card: Healthy when work-ready even though set-up is unfinished; Action needed only for open gates or the old red flags',()=>{
 const p=prog();
 assert.equal(cardStatus(p).key,'setup','without the server answer the old rule still applies');
 const ready=clientReadiness(good);
 assert.deepEqual([cardStatus(p,{wr:ready}).key,cardStatus(p,{wr:ready}).label],['healthy','Healthy']);
 const open=clientReadiness({...good,kyc_verified:false,engagements:0,engagements_with_lead:0,engagements_with_letter:0});
 const s=cardStatus(p,{wr:open});assert.equal(s.key,'action');assert.equal(s.label,'Action needed');assert.equal(s.tone,'bad');assert.ok(s.reasons.some(r=>/KYC verified: KYC is not verified yet/.test(r)));assert.ok(s.reasons.some(r=>/No engagement created yet/.test(r)));
 assert.equal(cardStatus(p,{wr:ready,flags:{kra_open:1}}).key,'action','a KRA notice still turns a work-ready client red');
 assert.equal(cardStatus(p,{wr:ready,meta:{overdue_tasks:2}}).key,'action');assert.equal(cardStatus(p,{wr:ready,flags:{filing_late:1}}).key,'action');
 assert.equal(cardStatus(p,{wr:null}).key,'checking','still loading: neither green nor red');assert.equal(cardStatus(p,{wr:null,flags:{kra_open:1}}).key,'action','but a known red flag is not hidden');
});

test('the chips count progress separately from status, so a Healthy client with sections to finish is both',()=>{
 assert.deepEqual(CLIENT_STATES.find(x=>x[0]==='setup'),['setup','Set-up incomplete']);
 const c=stateCounts([{status:{key:'healthy'},incomplete:true},{status:{key:'healthy'},incomplete:false},{status:{key:'action'},incomplete:true},{status:{key:'action'},incomplete:false}]);
 assert.deepEqual(c,{all:4,action:2,setup:2,healthy:2});
 assert.deepEqual(stateCounts([{status:{key:'setup'}},{status:{key:'checking'}},{status:{key:'healthy'}}]),{all:3,action:0,setup:2,healthy:1},'without the server answer the old counting holds');
 assert.match(chipRow(c,'setup',esc),/Set-up incomplete<em>2<\/em>/);
});

test('the progress bar: amber, only while something is outstanding, names what is missing, never says the client is blocked',()=>{
 const wr=clientReadiness({...good,approved_sections:['identity','tax','contacts','engagement']});
 const html=progressBar(wr,'c1',esc);
 assert.match(html,/Set-up progress<\/b><small>44% · 4 of 9 sections approved/);assert.match(html,/role="progressbar"[^>]*aria-valuenow="44"/);assert.match(html,/style="width:44%"/);
 assert.match(html,/Missing: BRS registration details; /);assert.match(html,/Needed before posting: Chart of Accounts and Opening Trial Balance\./);assert.match(html,/The client can still be worked on\./);
 const notReady=progressBar(clientReadiness({...good,kyc_verified:false}),'c1',esc);assert.doesNotMatch(notReady,/can still be worked on/);
 const done=clientReadiness({...good,approved_sections:SECTIONS.map(s=>s.code),chart:'Approved',opening:'Approved'});assert.equal(progressBar(done,'c1',esc),'','nothing to show at 100% with nothing needed before posting');
 const chartOnly=progressBar(clientReadiness({...good,approved_sections:SECTIONS.map(s=>s.code)}),'c1',esc);assert.match(chartOnly,/cc-prog-before/);assert.match(chartOnly,/Needed before posting: Chart of Accounts and Opening Trial Balance/);
 assert.equal(progressBar(null,'c1',esc),'');
});

test('the main button follows the first open gate; a work-ready card keeps the next set-up step',()=>{
 const g=o=>gateAction(clientReadiness({...good,...o}),'c1');
 assert.deepEqual([g({kyc_verified:false}).label,g({kyc_verified:false}).attr],['Complete KYC','data-suite="compliance" data-id="c1"']);
 assert.equal(g({kra_pin:'x'}).label,'Fix the KRA PIN');assert.match(g({engagements:0,engagements_with_lead:0,engagements_with_letter:0}).attr,/data-client-tab="projects"/);
 assert.equal(g({engagements_with_letter:0}).label,'Add the signed letter');assert.equal(gateAction(clientReadiness(good),'c1'),null);assert.equal(gateAction(undefined,'c1'),null);
 assert.deepEqual(gateReasons(clientReadiness(good)),[]);
 const card=(wr)=>clientCard({client:{client_id:'c1',company_name:'Fictional <b>Ltd',kra_pin:'P051000009A'},progress:prog(),esc,structureLabel:()=>'',leader:true,searchText:'x',detailsVisible:true,wr});
 const red=card(clientReadiness({...good,kyc_verified:false}));assert.match(red,/>Complete KYC<\/button>/);assert.match(red,/ Action needed<\/span>/);assert.match(red,/data-incomplete="1"/);assert.match(red,/cc-prog/);assert.doesNotMatch(red,/cc-ring"/);
 const green=card(clientReadiness(good));assert.match(green,/ Healthy<\/span>/);assert.match(green,/data-state="healthy"/);assert.match(green,/data-incomplete="1"/);
 const old=card(undefined);assert.match(old,/cc-ring/);assert.doesNotMatch(old,/data-incomplete/);assert.doesNotMatch(old,/cc-prog/);
 assert.doesNotMatch(green,/<b>Ltd/);
});

test('the client file lists the gates with the same facts the card uses, and escapes text',()=>{
 const wr=clientReadiness({...good,kyc_verified:false,approved_sections:['identity']});
 const h=gatesHtml(wr,{esc});assert.match(h,/Action needed before this client is Healthy/);assert.match(h,/cc-pill warn[^>]*data-gate="kyc"/);assert.match(h,/cc-pill ok[^>]*data-gate="pin"/);
 assert.match(h,/Set-up progress: 11% \(1 of 9 sections approved\)/);assert.match(h,/do not hold the status back/);
 assert.match(gatesHtml(clientReadiness(good),{esc,requireChart:true}),/A Partner has chosen to require an approved Chart of Accounts/);assert.match(gatesHtml(clientReadiness(good),{esc}),/Healthy: this client can be worked on/);
 assert.equal(gatesHtml(null,{esc}),'');
 const evil=gatesHtml({ready:false,gates:[{key:'x"',label:'<img src=x>',ok:false,detail:'"><b>'}],progress:{}},{esc});assert.doesNotMatch(evil,/<img src=x>/);assert.match(evil,/&lt;img src=x&gt;/);
});

test('Settings: the Partner switch shows the choice in force, its reason and history, and only a Partner gets the button',()=>{
 const st=(o={})=>({require_chart:false,can_set:true,current:null,history:[],...o});
 assert.match(statusPolicyCard(null,{esc}),/Loading/);
 const off=statusPolicyCard(st(),{esc});assert.match(off,/OFF \(default\)/);assert.match(off,/data-status-policy="on"/);assert.match(off,/No Partner choice recorded yet/);
 const cur={set_by_name:'EP <001>',set_at:'2026-11-16T09:00:00Z',reason:'Smaller clients <wait>',require_chart:true};
 const on=statusPolicyCard(st({require_chart:true,current:cur,history:[cur,{...cur,require_chart:false,reason:'Earlier choice'}]}),{esc});
 assert.match(on,/ON<\/span>/);assert.match(on,/data-status-policy="off"/);assert.match(on,/Earlier choices/);assert.match(on,/Earlier choice/);assert.doesNotMatch(on,/<wait>|<001>/);
 const staff=statusPolicyCard(st({can_set:false}),{esc});assert.doesNotMatch(staff,/data-status-policy/);assert.match(staff,/Only a Partner can change this/);
});

test('wiring: actions routed to Clients, loaded for leaders only, one cache token, build label, presentation and read-only server reads',()=>{
 for(const a of ['client_work_ready','client_status_policy_read','client_status_policy_set'])assert.equal(areaForStaffAction(a),'clients',a);
 const pilot=read('staff-pilot.mjs');
 assert.match(pilot,/request\(\{action:'client_work_ready',client_ids:list\}\)/);assert.match(pilot,/const workReadyOf=id=>workReadyFailed\?undefined:workReadyLoaded\?workReady\.get\(id\):null;/);
 assert.match(pilot,/statusPolicyCard\(statusPolicy,\{esc,fmt:shortDate\}\)/);assert.match(pilot,/if\(view==='firms'\)void paintStatusPolicy\(\)/);
 assert.match(pilot,/action:'client_status_policy_set',require_chart:turnOn,reason:f\.get\('reason'\)/);
 for(const f of ['staff-client-cards.mjs','staff-client-profile.mjs','staff-setup-guide.mjs'])assert.match(read(f),/staff-setup-spine\.mjs\?v=20261118-ready-v1/,f);
 for(const f of ['staff-client-cards.mjs','staff-client-profile.mjs'])assert.match(read(f),/staff-work-ready\.mjs\?v=20261118-ready-v1/,f);
 assert.match(pilot,/staff-work-ready\.mjs\?v=20261118-ready-v1/);
 assert.match(read('staff-client-profile.mjs'),/wr\?gatesHtml\(wr,\{esc,requireChart\}\)/);
 assert.doesNotMatch(read('staff-work-ready.mjs'),/request\(|fetch\(|action:/);
 const rules=read('supabase/functions/staff-workspace-v12/work-ready-rules.mjs');assert.doesNotMatch(rules,/insert |update |delete |\btx`/i);
 const act=read('supabase/functions/staff-workspace-v12/client-setup-review-actions.ts'),i=act.indexOf("p.action==='client_work_ready'||"),j=act.indexOf('const cid=uuid(p.client_id)');
 const block=act.slice(i,j);assert.equal((block.match(/insert into/g)||[]).length,1,'the only write is the Partner choice');assert.doesNotMatch(block,/update erp_private|delete from/);
 assert.match(block,/a\.category_code!=='PARTNER'\)fail\(403,'Only a Partner can change/);assert.match(block,/Ask for 500 clients or fewer/);assert.match(block,/at least 10 characters/);
});

test('migration: an insert-only, Partner-only, audited record with a reason',()=>{
 const m=read('supabase/migrations/20261118130000_client_status_policy.sql');
 assert.match(m,/GRANT SELECT,INSERT ON erp_private\.client_status_policy TO erp_api/);assert.doesNotMatch(m,/GRANT[^;]*(UPDATE|DELETE)/);assert.match(m,/FORCE ROW LEVEL SECURITY/);
 assert.match(m,/category_code='PARTNER' AND set_by=\(erp_private\.actor\(\)\)\.staff_id/);assert.match(m,/BETWEEN 10 AND 500/);assert.match(m,/immutable BEFORE UPDATE OR DELETE/);assert.match(m,/log_change\('policy_id'\)/);
});
