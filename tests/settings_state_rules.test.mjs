// Settings state vocabulary, checks, feeds, action bar and Configure links (build 2837). Pure: no database, no browser.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const R=await import('../supabase/functions/staff-workspace-v12/settings-state-rules.mjs');
const F=await import('../staff-settings-frame.mjs');
const S=await import('../staff-statutory-files.mjs');
const T='2026-11-16';
const rec=(area,native_status,o={})=>({area,record_id:o.id||'r1',group_key:o.group||'g',code:o.code||'CODE',label:o.label||'Label',native_status,version:o.version??null,revision:o.revision??3,effective_from:o.from??null,effective_to:o.to??null,expires_on:o.exp??null,approved_by:o.by??null,approved_at:null,prepared_by:o.prep??'Preparer',extra:o.extra||{}});
const st=(...a)=>R.unifiedState(rec(...a),T);

test('every native status of every setting maps to one of the six shared states',()=>{
 assert.deepEqual(R.STATES,['Draft','In Review','Approved','Active','Suspended','Retired']);
 const cases=[['tax_rate','Draft',{},'Draft'],['tax_rate','Draft',{extra:{legal_review_status:'Pending'}},'In Review'],['tax_rate','Testing',{},'In Review'],['tax_rate','Rejected',{},'Retired'],
  ['tax_rate','Approved',{from:'2026-01-01',to:'2026-12-31'},'Active'],['tax_rate','Approved',{from:'2026-12-01',to:'2027-12-31'},'Approved'],['tax_rate','Approved',{from:'2025-01-01',to:'2026-11-15'},'Retired'],['tax_rate','Approved',{from:'2026-11-16',to:'2026-11-16'},'Active'],
  ['service_template','Draft',{},'Draft'],['service_template','Approved',{},'Active'],['service_template','Retired',{},'Retired'],
  ['export_profile','Draft',{},'Draft'],['export_profile','Published',{from:'2026-01-01'},'Active'],['export_profile','Published',{from:'2027-01-01'},'Approved'],['export_profile','Published',{from:'2026-01-01',extra:{ended:true}},'Retired'],['export_profile','Retired',{},'Retired'],
  ['upload_template','Published',{from:'2026-01-01',to:'2026-06-30'},'Retired'],['upload_template','Draft',{},'Draft'],
  ['routing_map','Draft',{},'Draft'],['routing_map','Active',{from:'2026-01-01'},'Active'],['routing_map','Inactive',{},'Retired'],
  ['eligibility','Recorded',{},'In Review'],['eligibility','Verified',{exp:'2027-01-01'},'Active'],['eligibility','Verified',{exp:'2026-11-15'},'Suspended'],['eligibility','Verified',{exp:'2026-11-16'},'Active'],['eligibility','Ended',{},'Retired'],
  ['policy','Pending',{},'In Review'],['policy','Signed_Off',{},'Active'],['policy','Expired',{},'Suspended']];
 for(const [a,s,o,want] of cases)assert.equal(st(a,s,o),want,`${a} ${s} ${JSON.stringify(o)}`);
 assert.equal(st('tax_rate','Mystery'),null,'an unknown native status is not guessed');
 assert.equal(R.present(rec('tax_rate','Mystery'),T).state_known,false);
 // every status each table's database check allows is covered above
 const covered={tax_rate:['Draft','Testing','Approved','Rejected'],service_template:['Draft','Approved','Retired'],export_profile:['Draft','Published','Retired'],upload_template:['Draft','Published','Retired'],routing_map:['Draft','Active','Inactive'],eligibility:['Recorded','Verified','Ended'],policy:['Pending','Signed_Off','Expired']};
 for(const [a,list] of Object.entries(covered))for(const s of list)assert.notEqual(st(a,s,{from:'2026-01-01',exp:'2027-01-01'}),null,a+' '+s);
 assert.ok(Object.keys(covered).every(a=>a in R.AREAS)&&Object.keys(R.AREAS).every(a=>a in covered));
});

test('checks say what to fix; retired records and test-file status are not failures',()=>{
 const a=R.present(rec('tax_rate','Approved',{id:'a',group:'k',code:'K',from:'2026-01-01',to:'2026-12-31',extra:{has_source:true,has_figures:true}}),T),b=R.present(rec('tax_rate','Approved',{id:'b',group:'k',code:'K',from:'2026-06-01',to:'2027-06-30',extra:{has_source:true,has_figures:true}}),T),c=R.present(rec('tax_rate','Approved',{id:'c',group:'k',code:'K',from:'2027-07-01',to:'2027-12-31',extra:{has_source:true,has_figures:true}}),T);
 assert.equal(R.checksFor(a,[a,b,c],T).find(x=>x.code==='OVERLAP').ok,false);assert.equal(R.checksFor(c,[a,b,c],T).find(x=>x.code==='OVERLAP')?.ok??true,true,'a later period does not overlap');
 assert.match(R.checksFor(a,[a,b],T).find(x=>x.code==='OVERLAP').message,/End one of them/);
 const d=R.present(rec('tax_rate','Draft',{extra:{legal_review_status:'Pending'}}),T),cs=R.checksFor(d,[d],T);
 assert.deepEqual(cs.filter(x=>!x.ok).map(x=>x.code).sort(),['FIGURES','LEGAL','SOURCE']);
 assert.match(cs.find(x=>x.code==='FIGURES').message,/Tax Lead/);
 const p=R.present(rec('export_profile','Published',{from:'2026-01-01',extra:{verified_on:'2026-02-01',verified_against:'Authority page'}}),T);
 const pc=R.checksFor(p,[p],T);assert.equal(pc.find(x=>x.code==='VERIFIED').ok,true);assert.equal(pc.find(x=>x.code==='TEST_FILE').ok,false);assert.match(pc.find(x=>x.code==='TEST_FILE').message,/not tracked/);
 const ov=R.buildOverview([rec('export_profile','Published',{from:'2026-01-01',extra:{verified_on:'2026-02-01',verified_against:'x authority'}})],[],T);assert.equal(ov.failing_total,0,'test-file status is information, not a failure');
 const old=R.buildOverview([rec('tax_rate','Approved',{from:'2024-01-01',to:'2025-01-01'})],[],T);assert.equal(old.failing_total,0,'a retired record is not checked');
 const lapsed=R.present(rec('eligibility','Verified',{exp:'2026-11-10'}),T);assert.match(R.checksFor(lapsed,[lapsed],T).find(x=>x.code==='LAPSED').message,/blocked until it is renewed/);
});

test('overview feeds: pending by area, expiring with a horizon, recent changes labelled',()=>{
 const recs=[rec('eligibility','Verified',{id:'e1',exp:'2026-12-01',label:'Valuation licence'}),rec('eligibility','Verified',{id:'e2',exp:'2027-06-01'}),rec('eligibility','Verified',{id:'e3',exp:'2026-11-01',label:'Lapsed one'}),rec('policy','Signed_Off',{id:'p1',exp:'2026-11-20',label:'Policy A'}),
  ...Array.from({length:12},(_,i)=>rec('tax_rate','Draft',{id:'t'+i,label:'Draft '+i}))];
 const ov=R.buildOverview(recs,[{occurred_at:'2026-11-15T10:00:00Z',area:'eligibility',record_id:'e1',action:'UPDATE',actor_name:'A Person',status_before:'Recorded',status_after:'Verified',changed_fields:['status']},{occurred_at:'2026-11-14T10:00:00Z',area:'policy',record_id:'gone',action:'INSERT',actor_name:null,status_before:null,status_after:'Pending',changed_fields:[]}],T);
 assert.deepEqual(ov.expiring.map(e=>e.record_id),['e3','p1','e1'],'soonest first; beyond 60 days left out');
 assert.equal(ov.expiring[0].lapsed,true);assert.equal(ov.expiring[0].days,-15);assert.equal(ov.expiring_total,3);
 assert.equal(ov.pending_total,12);assert.equal(ov.pending[0].count,12);assert.equal(ov.pending[0].items.length,8,'a long list is cut, the count is not');
 assert.equal(ov.recent[0].label,'Valuation licence');assert.equal(ov.recent[0].action,'Changed');assert.equal(ov.recent[1].action,'Created');assert.match(ov.recent[1].label,/not in the list/);
 assert.equal(ov.counts.tax_rate.Draft,12);assert.equal(ov.areas.length,7);
 assert.equal(R.daysBetween('2026-11-16','2026-11-16'),0);assert.equal(R.daysBetween('2026-11-16','2026-12-16'),30);
});

test('the action bar lists only real actions, never an edit of an approved record, and nothing for staff below Manager',()=>{
 const keys=(r,role)=>R.actionsFor(R.present(r,T),role).map(a=>a.key);
 assert.deepEqual(keys(rec('tax_rate','Approved',{from:'2026-01-01',to:'2026-12-31'}),'PARTNER'),['revise','view']);
 assert.deepEqual(keys(rec('tax_rate','Draft'),'MANAGER'),['edit','test','legal','approve','view']);
 assert.deepEqual(keys(rec('tax_rate','Testing'),'MANAGER'),['legal','approve','revise','view'],'a testing rule cannot be edited; it can be approved or revised');
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN','ADMIN'])assert.deepEqual(keys(rec('tax_rate','Draft'),role),[]);
 const tpl=R.actionsFor(R.present(rec('service_template','Draft',{revision:7}),T),'PARTNER');assert.deepEqual(tpl.map(a=>a.key),['approve','retire','open']);assert.equal(tpl[0].kind,'svc');assert.equal(tpl[0].rev,7);
 assert.match(R.actionsFor(R.present(rec('tax_rate','Draft'),T),'PARTNER').find(a=>a.key==='approve').note,/Never the person who prepared it/);
 for(const r of [rec('export_profile','Published',{from:'2026-01-01'}),rec('upload_template','Published',{from:'2026-01-01'}),rec('routing_map','Active',{from:'2026-01-01'}),rec('eligibility','Verified',{exp:'2027-01-01'})])assert.equal(R.actionsFor(R.present(r,T),'MANAGER').length,1);
 assert.equal(R.actionsFor(R.present(rec('policy','Pending'),T),'PARTNER').length,0,'policies are signed on their own screen; nothing is invented here');
 assert.ok(!/Approve/.test(JSON.stringify(R.actionsFor(R.present(rec('export_profile','Published',{from:'2026-01-01'}),T),'PARTNER'))),'the bar never offers an approval that the setting does not have');
});

test('configuration fields and versions',()=>{
 const all=[R.present(rec('export_profile','Published',{id:'v1',group:'NSSF',version:1,from:'2026-01-01',to:'2026-06-30',extra:{layout_code:'L',verified_on:'2026-01-02'}}),T),R.present(rec('export_profile','Published',{id:'v2',group:'NSSF',version:2,from:'2026-07-01',extra:{layout_code:'L'}}),T),R.present(rec('export_profile','Draft',{id:'x',group:'SHIF',version:1}),T)];
 const v=R.versionsOf(all[1],all);assert.deepEqual(v.map(x=>[x.record_id,x.current]),[['v2',true],['v1',false]]);
 assert.deepEqual(R.configurationFields(all[0]).map(f=>f[0]).slice(0,3),['Code','Native status','Effective from']);
 assert.ok(R.configurationFields(all[0]).some(f=>f[0]==='Layout'&&f[1]==='L'));
});

test('screens: record page has the breadcrumb, status bar, four tabs and the action bar; everything is escaped',()=>{
 const r=R.present(rec('tax_rate','Draft',{label:'<img src=x onerror=alert(1)>',extra:{has_source:false,has_figures:false,tax_type:'VAT'}}),T);
 const d={record:r,area_label:'Tax rules',group:'Accounting & Tax Rules',tab:'accounting',checks:R.checksFor(r,[r],T),actions:R.actionsFor(r,'PARTNER'),fields:R.configurationFields(r),versions:R.versionsOf(r,[r]),history:[{occurred_at:'2026-11-15T10:00:00.000Z',actor:'<b>x</b>',action:'Created',status_before:null,status_after:'Draft',fields:[]}],tax:{parameters:{},source_url:'',source_note:'<script>',legal_citation:'',legal_review_note:''}};
 const html=F.recordView(d,'overview');
 assert.match(html,/Settings → Accounting &amp; Tax Rules → Tax rules/);assert.match(html,/id="recordStatus"/);
 for(const [c,l] of F.RECORD_TABS)assert.match(html,new RegExp(`data-id="${c}"[^>]*>${l.replace('&','&amp;')}<`));
 assert.deepEqual(F.RECORD_TABS.map(x=>x[1]),['Overview','Configuration','Versions & Approvals','Change History']);
 assert.match(html,/id="recordActions"/);assert.match(html,/data-suite="rate-approve"[^>]*class="primary"|class="primary"/);assert.match(html,/Save draft, Validate and Submit for review are the buttons inside each editor/);
 assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img src=x/);
 assert.doesNotMatch(F.recordView(d,'history'),/<b>x<\/b>/);assert.doesNotMatch(F.recordView(d,'configuration'),/<script>/);
 assert.match(F.recordView(d,'versions'),/id="recordVersions"/);assert.match(F.recordView(d,'history'),/id="recordHistory"/);
 assert.match(F.recordView(d,'configuration'),/No figures are entered/);assert.match(F.recordView(d,'nonsense'),/id="recordChecks"/,'an unknown tab shows the overview');
 const bare=F.recordView({...d,actions:[]},'overview');assert.match(bare,/Managers and Partners can open its editor/);
 const svc=F.recordView({...d,actions:R.actionsFor(R.present(rec('service_template','Draft',{revision:4}),T),'PARTNER')},'overview');assert.match(svc,/data-svc="approve" data-id="r1" data-rev="4"/);
 assert.equal(F.parseKey('tax_rate:abc:def').id,'abc:def');assert.deepEqual(F.parseKey('nocolon'),{area:'',id:''});
});

test('screens: overview feeds',()=>{
 const ov=R.buildOverview([rec('eligibility','Verified',{id:'e3',exp:'2026-11-01',label:'<i>Lapsed</i>'}),rec('tax_rate','Draft',{id:'t1',label:'A rule'})],[],T);
 const html=F.feedsView(ov);
 for(const id of ['settingsStates','feedPending','feedExpiring','feedFailing','feedRecent'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/ended 15 days ago/);assert.match(html,/data-suite="settings-record" data-id="eligibility:e3"/);assert.doesNotMatch(html,/<i>Lapsed/);
 for(const s of F.STATE_ORDER)assert.match(html,new RegExp(`<th class="num">${s}</th>`));
 assert.match(html,/An approved record is never edited/);assert.match(F.feedsView(R.buildOverview([],[],T)),/Nothing is waiting for a decision/);
});

test('Configure this setting: statutory blockers name the setting, and the return trip is wired',()=>{
 assert.deepEqual(S.configureKinds(['No published export profile is in force for this return and month.','x']),['export_profile']);
 assert.deepEqual(S.configureKinds(['No approved payroll mapping for NSSF_EMP. Approve it.']),['routing_map']);
 assert.deepEqual(S.configureKinds(['A line has no calculation']),[]);
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
 const panel=S.resultPanel({issues:['No published export profile is in force for this return and month.']},esc);
 assert.match(panel,/data-suite="configure-go" data-id="export_profile::the statutory file"/);assert.match(panel,/Configure this setting \(export profile\)/);
 assert.doesNotMatch(S.resultPanel({issues:['A line has no calculation']},esc),/configure-go/);
 const p=F.parseConfigure('export_profile::the statutory file');assert.equal(p.from,'the statutory file');assert.equal(p.target.tab,'templates');assert.equal(F.parseConfigure('nonsense::x').target,null);
 const bar=F.returnBar({label:'the statutory file',where:'Settings → Upload & Export Templates'});assert.match(bar,/id="configureReturn"/);assert.match(bar,/data-suite="configure-return"/);assert.match(bar,/Return to the statutory file/);assert.equal(F.returnBar(null),'');
 assert.match(rd(fx+'statutory-file-rules.mjs'),/Settings, Upload & Export Templates/);
 const suite=rd('staff-suite.mjs'),pilot=rd('staff-pilot.mjs');
 assert.match(suite,/createSettingsFrameUI\(\{\.\.\.ctx,setSettingsTab/);assert.match(suite,/if\(frame\.open\(\)\)return frame\.bar\(\)\+frame\.page\(\)/);assert.match(suite,/await frame\.handle\(action,id\)/);assert.match(suite,/overviewFeedsCard:frame\.card\(\)/);
 assert.match(pilot,/navigate:next=>navigateWorkspace\(next\)/);assert.match(pilot,/goHash:h=>/);assert.match(pilot,/currentHash:\(\)=>location\.hash/);
 assert.match(rd('staff-settings-frame.mjs'),/ctx\.goHash\(h\|\|'#view=home'\)/);assert.match(rd('staff-settings-frame.mjs'),/document\.getElementById\('editor'\)\?\.close/);
});

test('server wiring: read-only actions for Managers and Partners; no write in the database functions',()=>{
 assert.match(rd(fx+'index.ts'),/settingsOverviewAction\(tx,a,p\)/);assert.match(rd(fx+'staff-access-control.mjs'),/settings_overview_\|settings_record_/);
 const m=rd('supabase/migrations/20261117100000_settings_register.sql');
 assert.match(m,/STABLE SECURITY DEFINER SET search_path TO ''/);assert.doesNotMatch(m.replace(/--[^\n]*/g,''),/\b(INSERT INTO|DELETE FROM)\b/);assert.doesNotMatch(m.replace(/--[^\n]*/g,''),/UPDATE erp_private/);
 assert.match(m,/REVOKE EXECUTE ON FUNCTION erp_private\.settings_register\(\) FROM PUBLIC,anon,authenticated,service_role/);assert.match(m,/GRANT EXECUTE ON FUNCTION erp_private\.settings_changes\(text,text,integer\) TO erp_api/);
 const act=rd(fx+'settings-overview-actions.ts');assert.match(act,/READERS=\['PARTNER','MANAGER'\]/);assert.doesNotMatch(act,/\b(insert into|update erp_private|delete from)\b/i);
});

test('readiness stays scoped: export profiles hold only the statutory payroll files, and the report gate does not read them',()=>{
 const files=fs.readdirSync(path.join(root,fx)).filter(f=>/\.(ts|mjs)$/.test(f));
 const users=files.filter(f=>/statutory_export_profiles|listProfiles|profileInForce/.test(rd(fx+f))).sort();
 const allowed=new Set(['client-choices-actions.ts','client-choices-rules.mjs','export-profile-actions.ts','export-profile-rules.mjs','statutory-file-actions.ts','statutory-file-rules.mjs']);
 for(const f of users)assert.ok(allowed.has(f),f+' reads export profiles; only the profile screens and the statutory file builder may');
 assert.ok(!/profile/i.test(rd(fx+'report-gate-rules.mjs').replace(/service[_ ]profile|profile_id|tax_profile|client profile/gi,'')),'the report-readiness gate does not look at export profiles');
 assert.match(rd(fx+'statutory-file-rules.mjs'),/if\(!profile\)issues\.push\('No published export profile is in force for this return and month\./,'a missing profile is an issue on the file, not on the client');
});
