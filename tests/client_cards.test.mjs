import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientProgress,nextStep,clientStatus,cardStatus,setupCompletion,alertBadges,setupRing,nextAction,stateCounts,clientCard,chipRow,CLIENT_STATES} from '../staff-client-cards.mjs';
import {PROFILE_TABS} from '../staff-client-profile.mjs';
import {rowMeta,compactKes} from '../staff-client-register.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';

const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const structureLabel=c=>[c.legal_structure,c.legal_subtype].filter(Boolean).join(' · ');
const client={client_id:'c1',company_name:'UAT Fictional Geisha',kra_pin:'P051556782R',legal_structure:'Limited Company',legal_subtype:'Private',primary_sector:'Wholesale & Retail',branch_location:'Kisii'};
const ready={activity_count:1,stock_method_count:1,category_count:1,approved_account_count:20};
const base=over=>clientProgress({client,missing:[],compliance:{verified_at:'2026-11-01'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready,stagedTB:false,...over});

test('next step follows the set-up guide order and never skips a gate',()=>{
 assert.equal(nextStep(base({missing:['Financial year-end']})).key,'profile');
 assert.equal(nextStep(base({compliance:null})).key,'kyc');
 assert.match(nextStep(base({compliance:null,contacts:[]})).detail,/KYC verification, a contact/);
 assert.equal(nextStep(base({taxProfiles:[{client_id:'c1',status:'Draft'}]})).key,'tax');
 assert.equal(nextStep(base({taxProfiles:[{client_id:'other',status:'Verified'}]})).key,'tax','another client’s verified profile does not count');
 assert.equal(nextStep(base({readiness:undefined})).key,'loading');
 assert.equal(nextStep(base({readiness:{...ready,stock_method_count:0}})).key,'activities');
 assert.equal(nextStep(base()).key,'tb-stage');
 assert.equal(nextStep(base({stagedTB:true})).key,'tb-post');
 const done=clientProgress({client:{...client,has_opening_balance:true},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
 assert.equal(nextStep(done).key,'ready');
 const none=clientProgress({client:{...client,opening_balance_status:'No opening balances'},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
 assert.equal(nextStep(none).key,'ready','confirmed “no opening balances” also resolves the opening step');
});

test('a missing KRA PIN is a KYC gap',()=>{
 const p=clientProgress({client:{...client,kra_pin:''},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[],readiness:ready});
 assert.deepEqual(p.kycMissing,['KRA PIN']);assert.equal(p.kycOk,false);
});

test('status badge: Active only when everything is done; opening TB steps read as pending',()=>{
 assert.equal(clientStatus(base(),nextStep(base())).label,'Opening TB pending');
 assert.equal(clientStatus(base({compliance:null}),nextStep(base({compliance:null}))).label,'Onboarding');
 const done=clientProgress({client:{...client,has_opening_balance:true},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
 assert.equal(clientStatus(done,nextStep(done)).label,'Active');
});

const done=()=>clientProgress({client:{...client,has_opening_balance:true},missing:[],compliance:{verified_at:'x'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:ready});
const card=(p,o={})=>clientCard({client,progress:p,esc,structureLabel,leader:true,searchText:'uat fictional geisha',detailsVisible:true,...o});

test('card (build 2690): status badge, one ring, one main button, a menu; the old pills and long text are gone',()=>{
 const html=card(base({readiness:{...ready,stock_method_count:0}}));
 assert.match(html,/data-client-status="c1"[^>]*><span aria-hidden="true">●<\/span> Setup required<\/span>/);
 assert.match(html,/class="badge warn"/);
 assert.doesNotMatch(html,/cc-pill|cc-next|cc-pills|Ready for work|Client set-up is complete\. Engagement/,'the three pills and the long ready text are gone');
 assert.equal((html.match(/class="primary cc-main"/g)||[]).length,1,'one main button');
 assert.match(html,/class="primary cc-main" data-setup-guide="c1">Finish activities and mappings<\/button>/);
 assert.match(html,/<details class="cc-more"><summary aria-label="More actions for UAT Fictional Geisha"/);
 for(const t of ['Open client file','View details','Client accounts','Continue set-up','Edit KYC and contacts','Tax profile','Entity and activities'])assert.match(html,new RegExp(`role="menuitem"[^>]*>${t}</button>`),t);
 assert.match(html,/data-client-accounts="c1">Client accounts/);assert.match(html,/data-setup-guide="c1">Continue set-up/);assert.match(html,/data-client="c1">View details/);
 assert.match(html,/data-search="uat fictional geisha"/);assert.match(html,/data-state="setup"/);
 assert.doesNotMatch(html,/general mappings active|Opening TB setup required|Profile fields complete/,'the old paragraph text is gone');
});

test('main button: KYC and tax steps open their screens; ready clients get a task count or the client file',()=>{
 assert.match(card(base({compliance:null})),/class="primary cc-main" data-suite="compliance" data-id="c1">Complete KYC</);
 assert.match(card(base({taxProfiles:[]})),/class="primary cc-main" data-suite="tax-profile" data-id="c1">Verify the tax profile</);
 assert.match(card(base({missing:['Financial year-end']})),/data-v3="client" data-id="c1">Complete the profile</);
 assert.match(card(base()),/data-setup-guide="c1">Stage the opening TB</);
 assert.deepEqual(nextAction(nextStep(done()),{open_tasks:3}),{label:'Review 3 tasks',step:'tasks'});
 assert.deepEqual(nextAction(nextStep(done()),{open_tasks:1}),{label:'Review 1 task',step:'tasks'});
 assert.deepEqual(nextAction(nextStep(done()),{open_tasks:0}),{label:'Open client file',step:'file'});
 assert.deepEqual(nextAction(nextStep(done()),null),{label:'Open client file',step:'file'});
 assert.match(card(done(),{meta:{open_tasks:3}}),/class="primary cc-main" data-client-open="c1" data-client-tab="projects">Review 3 tasks</);
 assert.match(card(done()),/class="primary cc-main" data-client-open="c1">Open client file</);
 assert.equal(nextAction(nextStep(base({readiness:undefined})),null).step,'loading','while mappings load the button opens the set-up guide');
});

test('set-up completion: four equal parts, and the tooltip names exactly what is missing',()=>{
 const full=setupCompletion(done());assert.deepEqual([full.pct,full.done,full.total,full.missing,full.checking],[100,4,4,[],false]);
 const noTb=setupCompletion(base());assert.equal(noTb.pct,75);assert.deepEqual(noTb.missing,['Opening trial balance: not yet staged']);
 assert.deepEqual(setupCompletion(base({stagedTB:true})).missing,['Opening trial balance: staged, still to be posted']);
 const kyc=setupCompletion(base({client:{...client,kra_pin:''},compliance:null,contacts:[]}));
 assert.equal(kyc.pct,50,'tax profile and activities are done; KYC and the opening TB are not');
 assert.deepEqual(kyc.missing.slice(0,1),['KYC and contacts: KRA PIN, KYC verification, a contact']);
 const profile=setupCompletion(base({missing:['Financial year-end','Sector','Branch','Address']}));
 assert.match(profile.missing[0],/^Client profile: Financial year-end, Sector, Branch and 1 more$/);
 const loading=setupCompletion(base({readiness:undefined}));assert.equal(loading.checking,true);
 assert.match(setupRing(noTb,'c1',esc),/Missing: Opening trial balance: not yet staged\./);
 assert.match(setupRing(noTb,'c1',esc),/role="tooltip"/);assert.match(setupRing(noTb,'c1',esc),/tabindex="0"/,'the ring can be reached with the keyboard');
 assert.match(setupRing(noTb,'c1',esc),/aria-label="Client set-up 75%\. Missing: /);assert.match(setupRing(noTb,'c1',esc),/stroke-dasharray="80\.11 106\.81"/);
 assert.match(setupRing(full,'c1',esc),/Client set-up is complete\./);assert.match(setupRing(loading,'c1',esc),/Checking activities and mappings/);
});

test('status: red before amber before green; overdue tasks and late files turn a set-up client red',()=>{
 assert.equal(cardStatus(done()).key,'healthy');assert.equal(cardStatus(done()).label,'Healthy');assert.equal(cardStatus(done()).tone,'good');
 assert.equal(cardStatus(base()).key,'setup');assert.equal(cardStatus(base()).label,'Setup required');
 assert.equal(cardStatus(base({readiness:undefined})).key,'checking');
 const red=cardStatus(done(),{flags:{kra_open:1,kra_days:2,incoming_waiting:0,incoming_overdue:0}});assert.deepEqual([red.key,red.label,red.tone],['action','Action needed','bad']);
 assert.equal(cardStatus(base(),{flags:{kra_open:1,kra_days:2}}).key,'action','Action needed outranks Setup required (the sample code had this the wrong way round)');
 assert.equal(cardStatus(done(),{flags:{incoming_waiting:2,incoming_overdue:1}}).key,'action','a file that waited too long is red');
 assert.equal(cardStatus(done(),{flags:{incoming_waiting:2,incoming_overdue:0}}).key,'healthy','files waiting but not late are an amber warning only, not a red status');
 assert.equal(cardStatus(done(),{meta:{overdue_tasks:2}}).key,'action');assert.match(cardStatus(done(),{meta:{overdue_tasks:2}}).reasons.join(),/2 overdue tasks/);
 assert.equal(cardStatus(done(),{meta:{overdue_tasks:0}}).key,'healthy');
 assert.equal(cardStatus(base({readiness:undefined}),{flags:{kra_open:1,kra_days:0}}).key,'action','a KRA warning does not wait for the set-up check');
});

test('warning badges: KRA red with days left, Incoming review amber, and never anything forensic',()=>{
 assert.equal(alertBadges(null,esc),'');assert.equal(alertBadges({kra_open:0,incoming_waiting:0},esc),'');
 const kra=alertBadges({kra_open:1,kra_days:3},esc);assert.match(kra,/class="cc-alert red" data-suite="kra-open"[^>]*><span aria-hidden="true">🚨<\/span> KRA notice: 3 days left</);
 assert.match(alertBadges({kra_open:2,kra_days:1},esc),/1 day left \(\+1 more\)/);assert.match(alertBadges({kra_open:1,kra_days:0},esc),/due today/);assert.match(alertBadges({kra_open:1,kra_days:-3},esc),/overdue by 3 days/);
 const inc=alertBadges({incoming_waiting:2,incoming_overdue:0},esc);assert.match(inc,/class="cc-alert amber" data-suite="incoming-open"[^>]*><span aria-hidden="true">⚠️<\/span> Incoming review: 2 files</);
 assert.match(alertBadges({incoming_waiting:1,incoming_overdue:1},esc),/Incoming review: 1 file, 1 overdue/);
 assert.equal(alertBadges({forensic_file:true},esc),'','even if a forensic flag were ever sent, the card has no place to show it');
 assert.doesNotMatch(alertBadges({kra_open:1,kra_days:3,incoming_waiting:1},esc),/orensic/,'no forensic text on a warning row');
 assert.doesNotMatch(card(done()),/orensic|cc-alerts/,'a card with no flags has no warning row');
 assert.match(card(done(),{flags:{kra_open:1,kra_days:3,incoming_waiting:2,incoming_overdue:0}}),/<div class="cc-alerts"[^>]*>.*KRA notice: 3 days left.*Incoming review: 2 files.*<\/div>/);
 assert.doesNotMatch(card(done(),{flags:{forensic_file:true,kra_open:1,kra_days:2}}),/orensic|🔒/,'a card never mentions a forensic file');
 assert.doesNotMatch(readFileSync(new URL('../staff-client-cards.mjs',import.meta.url),'utf8')+readFileSync(new URL('../staff-client-register.mjs',import.meta.url),'utf8')+readFileSync(new URL('../supabase/functions/staff-workspace-v12/client-register-actions.ts',import.meta.url),'utf8'),/orensic/,'no forensic code in the card, the register or the card actions');
 assert.doesNotMatch(readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8'),/cc-alert\.dark/);
});

test('metrics row: zeros and empty values are not drawn; WIP is compact and explained',()=>{
 assert.equal(rowMeta({active_projects:0,open_tasks:0,overdue_tasks:0,next_deadline:null},esc,()=>''),'','nothing to show draws no row at all');
 assert.equal(rowMeta(null,esc,()=>''),'');assert.equal(rowMeta(null,esc,()=>'',{wip_unbilled:0,hours_without_rate:0}),'');
 const m=rowMeta({active_projects:0,open_tasks:4,overdue_tasks:0,next_deadline:null},esc,()=>'');assert.match(m,/4 open tasks/);assert.doesNotMatch(m,/active project|overdue|No open deadline|\b0\b/);
 const w=rowMeta({active_projects:2,open_tasks:0,overdue_tasks:0,next_deadline:null},esc,()=>'',{wip_unbilled:150000,hours_without_rate:0});
 assert.match(w,/2 active projects/);assert.match(w,/<b>KES 150K<\/b> WIP/);assert.match(w,/title="KES 150,000 of approved time not yet billed"/);
 assert.match(rowMeta(null,esc,()=>'',{wip_unbilled:1200,hours_without_rate:3}),/KES 1\.2K<\/b> WIP\*/);assert.match(rowMeta(null,esc,()=>'',{wip_unbilled:1200,hours_without_rate:3}),/3 approved hours have no rate/);
 assert.deepEqual([compactKes(0),compactKes(999),compactKes(1000),compactKes(150000),compactKes(1250000),compactKes(12000000)],['KES 0','KES 999','KES 1K','KES 150K','KES 1.3M','KES 12M']);
});

test('non-leader card is light: no pills, no set-up status, role actions only',()=>{
 const html=clientCard({client,progress:base(),esc,structureLabel,leader:false,lightActions:'<button data-propose="client">Propose</button>',searchText:'x',detailsVisible:true});
 assert.doesNotMatch(html,/cc-pill|cc-main|cc-more|cc-alerts|cc-ring|data-setup-guide|Continue set-up|badge/);
 assert.match(html,/data-client-view="c1"/);assert.match(html,/data-propose="client"/);
 const hidden=clientCard({client,progress:base(),esc,structureLabel,leader:false,searchText:'x',detailsVisible:false});
 assert.match(hidden,/Assigned work needed to open the client file/);assert.doesNotMatch(hidden,/P051556782R/,'PIN stays hidden until work is assigned');
});

test('names are escaped',()=>{
 const html=clientCard({client:{...client,company_name:'<img src=x onerror=alert(1)>'},progress:base(),esc,structureLabel,leader:true,searchText:'',detailsVisible:true});
 assert.doesNotMatch(html,/<img src=x/);
});

test('chips count and mark the current filter',()=>{
 assert.deepEqual(CLIENT_STATES,[['all','All'],['action','Action needed'],['setup','Setup required'],['healthy','Healthy']]);
 const counts=stateCounts([{status:{key:'healthy'}},{status:{key:'setup'}},{status:{key:'checking'}},{status:{key:'action'}},{status:{key:'all'}}]);
 assert.deepEqual(counts,{all:5,action:1,setup:2,healthy:1});
 const row=chipRow(counts,'action',esc);
 assert.match(row,/class="cc-chip on" data-client-state="action"/);assert.match(row,/Healthy<em>1<\/em>/);
});

test('the page loads the card facts safely: one request per minute, WIP only for Managers and Partners with Billing, refreshed after KRA or Incoming changes',()=>{
 const pilot=readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),act=readFileSync(new URL('../supabase/functions/staff-workspace-v12/client-register-actions.ts',import.meta.url),'utf8');
 assert.match(pilot,/if\(isLeader\(\)\)void ensureCardFacts\(rows\.map\(c=>c\.client_id\)\)/);
 assert.match(pilot,/request\(\{action:'client_card_flags',client_ids:list\}\)/);assert.match(pilot,/\['PARTNER','MANAGER'\]\.includes\(data\.me\.category_code\)&&canArea\('billing_wip'\)/);
 assert.match(pilot,/Date\.now\(\)-cardFacts\.at<60000/);assert.match(pilot,/ids\.slice\(0,500\)/);
 assert.match(pilot,/\/\^\(\?:kra_\|incoming_\)\/\.test\(String\(p\?\.action\|\|''\)\)\|\|options\.uploadKind==='incoming'\)cardFacts\.at=0/);
 assert.match(pilot,/cardFlags=new Map\(\);cardWip=new Map\(\);cardFacts\.key='';cardFacts\.at=0;/,'signing out forgets the facts');
 assert.match(pilot,/stateHidden=st!=='all'&&r\.dataset\.state!=='all'&&r\.dataset\.state!==st/);
 assert.match(pilot,/document\.querySelectorAll\('\.cc-more\[open\]'\)\.forEach\(d=>\{if\(d!==more\|\|e\.target\.closest\('\.cc-menu button'\)\)d\.open=false;\}\)/,'the menu closes on an outside click or a choice');
 assert.match(pilot,/e\.key!=='Escape'\)return;const d=document\.querySelector\('\.cc-more\[open\]'\)/);
 assert.match(act,/client_card_flags/);assert.match(act,/\['PARTNER','MANAGER','SUPERVISOR'\]/);assert.match(act,/\['PARTNER','MANAGER'\]\.includes\(a\.category_code\)\)fail\(403,'Work in progress/);
 assert.match(act,/Ask for 500 clients or fewer/);
 assert.equal(areaForStaffAction('client_card_flags'),'clients');assert.equal(areaForStaffAction('client_card_wip'),'billing_wip','money follows the Billing area, so a restricted person gets no WIP');
});

test('card styles: ring with tooltip, menu, and on a phone one column with a full-width main button',()=>{
 const css=readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(css,/\.cc-ring:hover \.cc-tip,\.cc-ring:focus \.cc-tip,\.cc-ring:focus-within \.cc-tip\{display:block\}/);
 assert.match(css,/\.cc-alert\.red\{background:#b3261e;color:#fff/);assert.match(css,/\.cc-alert\.amber\{/);
 assert.match(css,/@media\(max-width:768px\)\{\s*\.client-grid\{grid-template-columns:1fr\}\s*\.cc-foot\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
 assert.match(css,/\.cc-foot \.cc-main\{width:100%;min-height:44px\}/);
});

test('the Clients screen uses the card grid and keeps search, structure and state filtering',()=>{
 const pilot=readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),css=readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(pilot,/from '\.\/staff-client-cards\.mjs\?v=/);
 assert.match(pilot,/<div class="client-grid">\$\{body\}<\/div>/);
 assert.doesNotMatch(pilot,/<th>Purchase mapping setup<\/th>/);
 assert.match(pilot,/stateHidden/);assert.match(pilot,/repaintClientCards/);
 assert.match(css,/\.client-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,380px\),1fr\)\)/);
});

test('Review N tasks opens the client file on its Projects & Tasks tab, and the client page shows the same status as the card',()=>{
 const pilot=readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),profile=readFileSync(new URL('../staff-client-profile.mjs',import.meta.url),'utf8');
 assert.match(card(done(),{meta:{open_tasks:3}}),/data-client-open="c1" data-client-tab="projects">Review 3 tasks</);
 assert.doesNotMatch(card(done(),{meta:{open_tasks:0}}),/data-client-tab/);
 assert.match(pilot,/pendingClientTab=b\.dataset\.clientTab\|\|''/);assert.match(pilot,/clientTab=pendingClientTab\|\|'overview'/);
 assert.match(pilot,/status=cardStatus\(progress,\{flags:cardFlags\.get\(c\.client_id\)/);assert.doesNotMatch(pilot,/status=clientStatus\(/);
 assert.match(pilot,/void ensureCardFacts\(\[c\.client_id\]\)/);
 assert.match(profile,/data-client-status="\$\{id\}"/);
 assert.ok(PROFILE_TABS.some(([k])=>k==='projects'));
});
