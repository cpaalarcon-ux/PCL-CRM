// Step 4 (joined-practice review): the licence screen, the audit flag, the server actions, the rights and the release counts.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {stateText,stateTone,licenceCounts,headline,licencesSection,licenceFormFields,auditFlag,auditFlagHtml,LICENCE_NOTE} from '../staff-licences.mjs';
import {homeModel,createHomeUI} from '../staff-audit-home.mjs';
import {STAFF_RIGHTS,rightForAction} from '../supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const table=(heads,rows)=>`<table><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const button=(a,l,id='')=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const sd=v=>String(v||'').slice(0,10);
const L=(o)=>({licence_id:o.id||'l'+Math.random(),client_id:'c1',licence_type:'EPRA',licence_number:'EPRA/001',issuing_authority:'EPRA',description:'',expires_on:'2027-01-01',state:'Valid',days_left:200,revision:1,ended_on:null,...o});
const types=[{type_code:'EPRA',label:'EPRA licence or permit'},{type_code:'SACCO_LICENCE',label:'SACCO licence'},{type_code:'OTHER',label:'Other licence or permit'}];

test('state wording and tone',()=>{
 assert.equal(stateText('Expired',-5),'Expired 5 day(s) ago');assert.equal(stateText('Expiring',12),'Expires in 12 day(s)');assert.equal(stateText('Valid',200),'Valid');
 assert.match(stateText('Missing'),/Expected for this legal structure/);
 assert.equal(stateTone('Expired'),'bad');assert.equal(stateTone('Missing'),'bad');assert.equal(stateTone('Expiring'),'warn');assert.equal(stateTone('Valid'),'ok');
});
test('headline',()=>{
 assert.equal(headline([]).tone,'neutral');assert.match(headline([]).text,/No licence or permit is recorded/);
 assert.equal(headline([{state:'Valid'},{state:'Valid'}]).tone,'ok');
 const h=headline([{state:'Expired'},{state:'Expiring'},{state:'Missing'},{state:'Valid'}]);assert.equal(h.tone,'bad');assert.match(h.text,/1 expired, 1 expiring soon, 1 expected but not recorded/);
 assert.equal(headline([{state:'Expiring'}]).tone,'warn');
 assert.deepEqual(licenceCounts([{state:'Expired'},{state:'Valid'}]),{expired:1,expiring:0,missing:0,valid:1,total:2});
});
test('client screen: rows, states, ended history, escaping, buttons only for leaders',()=>{
 const licences=[L({id:'a',licence_type:'EPRA',licence_number:'EPRA/<1>',state:'Expired',days_left:-3}),L({id:'b',licence_type:'OTHER',description:'Fire <cert>',state:'Expiring',days_left:20}),L({id:'old',ended_on:'2025-02-01',end_reason:'Renewed by licence EPRA/2'}),L({id:'z',client_id:'c2',licence_number:'NOT-MINE'})];
 const summary=[{client_id:'c1',licence_type:'SACCO_LICENCE',state:'Missing'}];
 const args={client:{client_id:'c1'},licences,summary,types,table,button,shortDate:sd};
 const html=licencesSection({...args,leader:true});
 assert.match(html,/EPRA\/&lt;1&gt;/);assert.doesNotMatch(html,/EPRA\/<1>/);assert.match(html,/Fire &lt;cert&gt;/);assert.doesNotMatch(html,/NOT-MINE/);
 assert.match(html,/Expired 3 day\(s\) ago/);assert.match(html,/Expires in 20 day\(s\)/);
 assert.match(html,/SACCO licence: Expected for this legal structure, none recorded/);assert.match(html,/Needs attention: 1 expired, 1 expiring soon, 1 expected but not recorded/);
 assert.match(html,/Ended or renewed \(1\)/);assert.match(html,/Renewed by licence EPRA\/2/);
 assert.match(html,/data-suite="licence-new" data-id="c1"/);assert.match(html,/data-suite="licence-renew" data-id="a"/);assert.match(html,/data-suite="licence-end" data-id="b"/);
 assert.ok(html.includes(LICENCE_NOTE));assert.match(html,/blocks nothing/);
 const ro=licencesSection({...args,leader:false});assert.doesNotMatch(ro,/data-suite="licence-/);
 assert.match(licencesSection({client:{client_id:'c9'},licences:[],summary:[],types,leader:true,table,button,shortDate:sd}),/No licence or permit is recorded for this client/);
});
test('form fields',()=>{
 const f=(n)=>`<f ${n}>`,s=(n)=>`<s ${n}>`,a=(n)=>`<a ${n}>`;
 const html=licenceFormFields({field:f,select:s,area:a,types});
 for(const n of ['licence_type','licence_number','issuing_authority','description','issued_on','expires_on'])assert.match(html,new RegExp('<[fsa] '+n+'>'),n);
});
test('audit flag: states, attention count, never a licence number',()=>{
 const rows=[{label:'EPRA licence or permit',authority:'EPRA <Kenya>',state:'Expired',expires_on:'2026-10-01',days_left:-39,licence_number:'MUST-NOT-SHOW'},{label:'NTSA licence',authority:'NTSA',state:'Expiring',expires_on:'2026-12-01',days_left:22},{label:'SACCO licence',authority:'SASRA',state:'Missing',expires_on:null,days_left:null}];
 const f=auditFlag(rows);assert.equal(f.attention,3);assert.equal(f.tone,'bad');assert.equal(f.rows[0].tone,'bad');
 const html=auditFlagHtml(rows);assert.match(html,/id="auditLicences"/);assert.match(html,/EPRA &lt;Kenya&gt;/);assert.doesNotMatch(html,/MUST-NOT-SHOW/);
 assert.match(html,/creates no risk and blocks no sign-off/);assert.match(html,/Expired 39 day\(s\) ago/);assert.match(html,/Expected for this legal structure/);
 assert.match(auditFlagHtml([]),/none is expected for its legal structure/);
 assert.equal(auditFlag([{state:'Valid',label:'x',authority:'y'}]).attention,0);
});
test('audit home: the flag is on the overview and changes no sign-off',()=>{
 const base={file:{file_status:'Planning',reporting_framework:'IFRS'},readiness:{},planning_gate:null,workpapers:[],completion:[]};
 const without=homeModel(base,{category_code:'PARTNER'}),withLic=homeModel({...base,licences:[{label:'NTSA licence',authority:'NTSA',state:'Expired',days_left:-2,expires_on:'2026-11-01'}]},{category_code:'PARTNER'});
 assert.deepEqual(withLic.licences.map(x=>x.state),['Expired']);assert.deepEqual(without.licences,[]);
 assert.deepEqual(withLic.blockers,without.blockers,'an expired licence blocks no sign-off');
 assert.deepEqual(withLic.sections.map(s=>s.summary),without.sections.map(s=>s.summary),'and changes no progress count');
 const ui=createHomeUI({esc:v=>String(v)});const panel=ui.homePanel(withLic);assert.match(panel,/id="auditLicences"/);assert.match(panel,/NTSA licence/);
 assert.match(ui.homePanel(without),/id="auditLicences"/,'the card is always there so staff know it was checked');
});
test('server: actions mirror the database and do not touch KYC verification',()=>{
 const s=rd(fx+'engagement-actions.ts');
 for(const act of ['licence_add','licence_end'])assert.match(s,new RegExp("p\\.action==='"+act+"'"));
 assert.match(s,/'group_profile_save','licence_add','licence_end','engagement_checklist','reference_service_add','reference_service_confirm','engagement_read'/);
 assert.match(s,/A renewal must expire after the licence it renews/);assert.match(s,/Record why this licence is being ended/);assert.match(s,/Describe what this licence or permit is for/);
 assert.match(s,/for update/);assert.ok(s.indexOf('set ended_on=${today()},end_reason=${\'Renewed by licence')<s.indexOf('insert into erp_private.client_licences(client_id,licence_type'),'old entry is ended before the renewal is inserted');assert.match(s,/ended_on=\$\{today\(\)\}/,'Nairobi date');
 assert.doesNotMatch(s,/delete from erp_private\.client_licences/);
 const body=s.slice(s.indexOf("p.action==='licence_add'"),s.indexOf("p.action==='compliance_evidence_save'"));
 assert.doesNotMatch(body,/kycChanged/,'a yearly renewal must not undo a verified KYC file');
});
test('audit read gives only the flag',()=>{
 const a=rd(fx+'audit-actions.ts');assert.match(a,/audit_licence_flags\(\$\{project\.client_id\}::uuid\)/);assert.match(a,/completion_reviewed:checklist\[0\]\?\.reviewed\|\|0\},licences\};/);
 const m=rd('supabase/migrations/20261109261000_client_licences.sql');
 const fn=m.slice(m.indexOf('CREATE FUNCTION erp_private.audit_licence_flags'),m.indexOf('-- Counts for the go-live'));
 assert.doesNotMatch(fn,/licence_number|evidence_id/,'the flag never selects the licence number or the evidence');
});
test('rights: a Manager or Partner records licences',()=>{
 for(const act of ['licence_add','licence_end'])assert.equal(rightForAction(act),'client.owners',act);
 assert.deepEqual(STAFF_RIGHTS.find(r=>r.code==='client.owners').roles,['PARTNER','MANAGER']);
 assert.equal(rd('staff-rights-catalog.mjs'),rd(fx+'staff-rights-catalog.mjs'));
 assert.match(rd(fx+'staff-access-control.mjs'),/group_profile_save\|licence_add\|licence_end\|contact_save/);
});
test('read path and release counts',()=>{
 const r=rd(fx+'suite-actions.ts');for(const k of ['licence_types','licences','licence_summary'])assert.match(r,new RegExp("'"+k+"',\\(select"));
 const t=rd(fx+'tax-config-actions.ts');
 assert.match(t,/licence_summary_all\(\) where state='Expired'\) licences_expired/);assert.match(t,/state='Expiring'\) licences_expiring/);assert.match(t,/state='Missing'\) expected_licences_missing/);
});
test('screen wiring and build label',()=>{
 const s=rd('staff-suite.mjs');
 assert.match(s,/import \{licencesSection,licenceFormFields\} from '\.\/staff-licences\.mjs\?v=\d{8}-[a-z0-9-]+'/);
 for(const a of ['licence-new','licence-renew','licence-end'])assert.match(s,new RegExp("action==='"+a+"'"));
 assert.match(s,/'licence_add',\{client_id:id\}/);assert.match(s,/'licence_add',\{client_id:l\.client_id,renews_licence_id:l\.licence_id\}/);assert.match(s,/'licence_end',\{licence_id:l\.licence_id,revision:l\.revision\}/);
 assert.match(rd('staff-audit-home.mjs'),/import \{auditFlagHtml\} from '\.\/staff-licences\.mjs\?v=\d{8}-[a-z0-9-]+'/);
 const rel=JSON.parse(rd(fx+'release.json')).build;assert.match(rel,/^2026-11-09\.\d{4}$/);assert.match(rd('staff-pilot.html'),new RegExp('data-build="'+rel.replace(/\./g,'\\.')+'"'));
});
test('migration: no delete, no rewrite, forced row security, no invented requirement',()=>{
 const m=rd('supabase/migrations/20261109261000_client_licences.sql');
 assert.match(m,/CREATE TRIGGER no_delete BEFORE DELETE ON erp_private\.client_licences/);assert.match(m,/FORCE ROW LEVEL SECURITY/);
 assert.doesNotMatch(m,/DELETE FROM|UPDATE erp_private\.(clients|client_compliance|client_kyc_evidence)/i);
 assert.equal((m.match(/INSERT INTO erp_private\.licence_expectations/g)||[]).length,1);assert.equal((m.match(/\('Co-operative Society'/g)||[]).length,1,'one suggested expectation only');
 assert.doesNotMatch(m,/EUR|\b750\b|5,?000,?000/,'no tax threshold is stored');
});
