// Forensic restricted file: the screens, the server module, the wiring and the rules it must not break.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {listView,caseView,settingsView,issueBlocker,canWrite,isLead,holdActive,standardText,sizeText,settingStatus,createForensicUI,FORENSIC_NOTE,STANDARD_NOTE,LEVEL_WORDS,CUSTODY_EVENTS} from '../staff-forensic.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {moduleLinks,MODULE_LINKS} from '../staff-nav.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const button=(a,l,id='',x='')=>`<button data-suite="${a}" data-id="${id}" ${x}>${l}</button>`;
const me=c=>({category_code:c,staff_id:'me'});
const E=(o={})=>({evidence_id:'e1',evidence_no:1,description:'Bank <extract>',source_note:'From the client',obtained_on:'2026-11-02',file_name:'s.pdf',file_size_bytes:2048,sha256:'a'.repeat(64),mime_type:'application/pdf',added_at:'2026-11-02T08:00:00Z',added_by_name:'Mia',withdrawn_at:null,withdrawn_reason:null,
 custody:[{custody_id:'k1',event_type:'Received',from_holder:null,to_holder:'Mia',note:'From the client',event_at:'2026-11-02T08:00:00Z',recorded_by_name:'Mia'}],...o});
const G=(o={})=>({my_level:'Lead',case:{case_id:'c1',case_ref:'FOR-2026-0001',title:'Cash <review>',mandate_text:'Instructed to examine receipts.',mandate_date:'2026-11-01',status:'Open',client_id:'cl',client_name:'UAT Ltd',firm_id:'f',firm_code:'AUDB',lead_id:'p1',lead_name:'Pat',opened_at:'2026-11-01T08:00:00Z',locked_at:null,issued_at:null,issued_by_name:null,issued_report_id:null,issued_standard_reference:null,issued_report_sha256:null},
 access:[{access_id:'a1',staff_id:'p1',full_name:'Pat',category_code:'PARTNER',level:'Lead',added_at:'2026-11-01T08:00:00Z',added_by_name:'Pat',removed_at:null,removed_reason:null},{access_id:'a2',staff_id:'m1',full_name:'Mia',category_code:'MANAGER',level:'Investigator',added_at:'2026-11-01T09:00:00Z',added_by_name:'Pat',removed_at:null,removed_reason:null}],
 evidence:[E()],findings:[{finding_id:'f1',seq:1,title:'Not banked',description:'Receipts were not banked on the day.',recorded_at:'2026-11-03T08:00:00Z',recorded_by_name:'Mia',withdrawn_at:null,withdrawn_reason:null,evidence_nos:[1]}],
 reports:[{report_id:'r1',version:1,sha256:'b'.repeat(64),saved_at:'2026-11-04T08:00:00Z',saved_by_name:'Mia',issued:false}],report_body:'Draft <report> text.',holds:[],events:[{event_type:'File opened',detail:null,occurred_at:'2026-11-05T08:00:00Z',actor_name:'Pat',evidence_id:null}],
 standard:{reference:'[FORENSIC STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]',status:'Suggested',needs_verified:true},...o});

test('wording helpers and gates',()=>{
 assert.equal(sizeText(2048),'2.0 KB');assert.equal(sizeText(0),'');
 assert.equal(settingStatus({rule_status:'Suggested'}),'Default - not yet confirmed');assert.match(settingStatus({rule_status:'Confirmed',confirmed_at:'2026-11-10T00:00:00Z'}),/Confirmed on 2026-11-10/);
 assert.equal(standardText({reference:'X',status:'Suggested'}),'X (not verified)');assert.equal(standardText({reference:'X',status:'Confirmed'}),'X (verified)');
 assert.match(FORENSIC_NOTE,/Other Partners and administrators cannot see it/);assert.match(STANDARD_NOTE,/placeholder until the Compliance Lead/);
 assert.deepEqual(CUSTODY_EVENTS,['Transferred','Examined','Copied','Sealed','Returned']);assert.ok(LEVEL_WORDS.Viewer);
 assert.equal(canWrite(G()),true);assert.equal(canWrite(G({my_level:'Viewer'})),false);assert.equal(canWrite(G({case:{...G().case,status:'Issued'}})),false);
 assert.equal(isLead(G()),true);assert.equal(isLead(G({my_level:'Investigator'})),false);
 assert.equal(holdActive(G()),false);assert.equal(holdActive(G({holds:[{action:'Set'}]})),true);assert.equal(holdActive(G({holds:[{action:'Set'},{action:'Released'}]})),false);
 // the issue blocker names the first missing piece, and the unverified standard blocks by default
 assert.match(issueBlocker(G({reports:[]})),/Save the report first/);
 assert.match(issueBlocker(G({evidence:[]})),/at least one item of evidence/);
 assert.match(issueBlocker(G({findings:[]})),/at least one finding/);
 assert.match(issueBlocker(G()),/standard reference has not been verified/);
 assert.equal(issueBlocker(G({standard:{reference:'R',status:'Confirmed',needs_verified:true}})),'');
 assert.equal(issueBlocker(G({standard:{reference:'R',status:'Suggested',needs_verified:false}})),'');
 assert.match(issueBlocker(G({case:{...G().case,status:'Issued'}})),/locked/);
});

test('list view: the note, the open button for Partners, empty states, escaping',()=>{
 const r={cases:[{case_id:'c1',case_ref:'FOR-2026-0001',title:'Cash <review>',client_name:'UAT Ltd',firm_code:'AUDB',lead_name:'Pat',my_level:'Investigator',evidence_count:2,finding_count:1,status:'Open',hold_active:true}],can_open:false};
 const h=listView({r,me:me('MANAGER'),button});
 assert.match(h,/Other Partners and administrators cannot see it/);assert.match(h,/Cash &lt;review&gt;/);assert.doesNotMatch(h,/Cash <review>/);assert.match(h,/Litigation hold/);assert.match(h,/forensic-case/);
 assert.doesNotMatch(h,/forensic-new/);assert.doesNotMatch(h,/forensic-settings/);
 const p=listView({r:{cases:[],can_open:true},me:me('PARTNER'),button});assert.match(p,/forensic-new/);assert.match(p,/forensic-settings/);assert.match(p,/not on any forensic file yet/);
 assert.match(listView({r:{cases:[],can_open:false},me:me('ASSISTANT'),button}),/not on the access list of any forensic file/);
});

test('case view: lead sees every control; an Investigator, a Viewer and a locked file see fewer',()=>{
 const lead=caseView({g:G(),button});
 for(const a of ['forensic-evidence-add','forensic-evidence-file','forensic-custody-add','forensic-evidence-withdraw','forensic-finding-add','forensic-finding-withdraw','forensic-report-edit','forensic-report-issue','forensic-hold-set','forensic-access-add','forensic-access-level','forensic-access-remove','forensic-lead-transfer'])assert.match(lead,new RegExp(a),a);
 assert.match(lead,/Bank &lt;extract&gt;/);assert.doesNotMatch(lead,/Bank <extract>/);assert.match(lead,/Draft &lt;report&gt; text/);assert.match(lead,/a{64}/);assert.match(lead,/Chain of custody/);assert.match(lead,/\(not verified\)/);
 assert.match(lead,/disabled title=/,'issue is disabled while the standard is unverified');
 const inv=caseView({g:G({my_level:'Investigator'}),button});
 for(const a of ['forensic-evidence-add','forensic-custody-add','forensic-finding-add','forensic-report-edit','forensic-evidence-file'])assert.match(inv,new RegExp(a),a);
 for(const a of ['forensic-evidence-withdraw','forensic-finding-withdraw','forensic-report-issue','forensic-hold-set','forensic-access-add','forensic-lead-transfer'])assert.doesNotMatch(inv,new RegExp(a),a);
 const view=caseView({g:G({my_level:'Viewer'}),button});
 assert.match(view,/forensic-evidence-file/);for(const a of ['forensic-evidence-add','forensic-custody-add','forensic-finding-add','forensic-report-edit','forensic-report-issue'])assert.doesNotMatch(view,new RegExp(a),a);
 const issued=caseView({g:G({case:{...G().case,status:'Issued',locked_at:'2026-11-06T00:00:00Z',issued_at:'2026-11-06T00:00:00Z',issued_by_name:'Pat',issued_standard_reference:'Ref (fictional)',issued_report_sha256:'c'.repeat(64)}}),button});
 assert.match(issued,/Issued by Pat/);assert.match(issued,/The file is locked/);assert.match(issued,/Ref \(fictional\)/);assert.doesNotMatch(issued,/forensic-evidence-add|forensic-finding-add|forensic-report-edit|forensic-report-issue|forensic-evidence-withdraw/);assert.match(issued,/forensic-custody-add/,'custody entries stay possible after the lock');
 const hold=caseView({g:G({holds:[{action:'Set',note:'Court order served',recorded_at:'2026-11-05T08:00:00Z',recorded_by_name:'Pat'}]}),button});assert.match(hold,/In force/);assert.match(hold,/forensic-hold-release/);assert.doesNotMatch(hold,/forensic-hold-set/);
 assert.doesNotMatch(caseView({g:G({access:[{...G().access[0],removed_at:'2026-11-06T00:00:00Z',removed_reason:'Left the matter',level:'Investigator'}]}),button}),/forensic-access-remove/);
});

test('settings view',()=>{
 const h=settingsView({r:{settings:[{setting_key:'standard_reference',label:'The standard reference',text_value:'[FORENSIC STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]',rule_status:'Suggested'},{setting_key:'report_needs_verified_standard',label:'Gate',text_value:'YES',rule_status:'Confirmed',confirmed_at:'2026-11-10T00:00:00Z',source_note:'Partner minute'}]},button});
 assert.match(h,/Default - not yet confirmed/);assert.match(h,/Confirmed on 2026-11-10/);assert.match(h,/forensic-setting-confirm/);assert.equal((h.match(/forensic-setting-confirm/g)||[]).length,1);assert.match(h,/forensic-setting-set/);
});

test('handler: only forensic- actions; requests and payloads',async()=>{
 const sent=[];let shown='',submit=null,after=null;
 const resp={forensic_list:{cases:[],can_open:true},forensic_get:G(),forensic_clients:{clients:[{client_id:'cl',company_name:'C'}],firms:[{client_id:'cl',firm_id:'f',firm_code:'AUDB',legal_name:'Fic'}]},forensic_open:{ok:true,case_id:'c9',case_ref:'FOR-2026-0009'},forensic_staff_options:{staff:[{staff_id:'p2',full_name:'Pam',category_code:'PARTNER'},{staff_id:'m2',full_name:'Max',category_code:'MANAGER'}]},forensic_settings_read:{settings:[{setting_key:'standard_reference',label:'S',text_value:'[X - PENDING COMPLIANCE REVIEW]',rule_status:'Suggested',revision:3}]}};
 const ui=createForensicUI({$:()=>null,field:()=>'',select:()=>'',form:()=>'',modal:(t,h,s,a)=>{shown=t+' '+h;submit=s;after=a;},request:async p=>{sent.push(p);return resp[p.action]||{ok:true};},notice:()=>{},button,area:()=>'',today:()=>'2026-11-10',data:()=>({me:me('PARTNER')})});
 assert.equal(await ui.handle('incoming-open','x'),false);assert.equal(await ui.handle('kra-open','x'),false);assert.equal(await ui.handle('finance-tab','x'),false);
 assert.equal(await ui.handle('forensic-open'),true);assert.deepEqual(sent[0],{action:'forensic_list'});assert.match(shown,/Forensic files/);
 const fd=o=>new Map(Object.entries(o));
 await ui.handle('forensic-new');assert.deepEqual(sent.at(-1),{action:'forensic_clients'});
 const op=await submit(fd({combo:'cl|f',title:'Cash review',mandate_date:'2026-11-01',mandate_text:'The mandate text'}));
 assert.deepEqual(sent.at(-1),{action:'forensic_open',client_id:'cl',firm_id:'f',title:'Cash review',mandate_date:'2026-11-01',mandate_text:'The mandate text'});assert.equal(op.case_id,'c9');
 await ui.handle('forensic-case','c1');assert.deepEqual(sent.at(-1),{action:'forensic_get',case_id:'c1'});assert.match(shown,/Forensic file · FOR-2026-0001/);
 await ui.handle('forensic-custody-add','e1');await submit(fd({event_type:'Transferred',from_holder:'A',to_holder:'B',event_at:'2026-11-05T10:00',note:''}));
 assert.equal(sent.at(-1).action,'forensic_custody_add');assert.equal(sent.at(-1).evidence_id,'e1');assert.equal(sent.at(-1).case_id,'c1');assert.match(sent.at(-1).event_at,/^2026-11-05T/);
 await submit(fd({event_type:'Examined',from_holder:'',to_holder:'',event_at:'',note:''}));assert.ok(!('event_at' in sent.at(-1)));
 await ui.handle('forensic-finding-add');
 const multi={get:k=>({title:'Not banked',description:'Receipts were not banked on the day.'})[k],getAll:k=>k==='ev'?['e1','e2']:[],entries:()=>[]};
 await submit(multi);assert.deepEqual(sent.at(-1),{action:'forensic_finding_add',case_id:'c1',title:'Not banked',description:'Receipts were not banked on the day.',evidence_ids:['e1','e2']});
 await ui.handle('forensic-report-edit');await submit(fd({body:'A new report body that is long enough.'}));assert.deepEqual(sent.at(-1),{action:'forensic_report_save',case_id:'c1',body:'A new report body that is long enough.'});
 await ui.handle('forensic-report-issue','c1');await submit(fd({confirm:'true'}));assert.deepEqual(sent.at(-1),{action:'forensic_report_issue',case_id:'c1',confirm:true});
 await submit(fd({}));assert.equal(sent.at(-1).confirm,false,'an unticked box sends an explicit false');
 await ui.handle('forensic-hold-set');await submit(fd({note:'Court order served'}));assert.deepEqual(sent.at(-1),{action:'forensic_hold_set',case_id:'c1',note:'Court order served'});
 await ui.handle('forensic-hold-release');await submit(fd({reason:'Matter withdrawn'}));assert.deepEqual(sent.at(-1),{action:'forensic_hold_release',case_id:'c1',reason:'Matter withdrawn'});
 await ui.handle('forensic-access-add');assert.deepEqual(sent.find(x=>x.action==='forensic_staff_options'),{action:'forensic_staff_options',case_id:'c1'});
 await submit(fd({staff_id:'m2',level:'Viewer'}));assert.deepEqual(sent.at(-1),{action:'forensic_access_add',case_id:'c1',staff_id:'m2',level:'Viewer'});
 await ui.handle('forensic-access-remove','m1');await submit(fd({reason:'Finished with the matter'}));assert.deepEqual(sent.at(-1),{action:'forensic_access_remove',case_id:'c1',staff_id:'m1',reason:'Finished with the matter'});
 await ui.handle('forensic-lead-transfer');assert.doesNotMatch(shown,/Max/,'only Partners are offered as the new lead');
 await submit(fd({new_lead_id:'p2',reason:'The lead is leaving the firm'}));assert.deepEqual(sent.at(-1),{action:'forensic_lead_transfer',case_id:'c1',new_lead_id:'p2',reason:'The lead is leaving the firm'});
 await ui.handle('forensic-evidence-withdraw','e1');await submit(fd({reason:'Uploaded in error'}));assert.deepEqual(sent.at(-1),{action:'forensic_evidence_withdraw',case_id:'c1',evidence_id:'e1',reason:'Uploaded in error'});
 await ui.handle('forensic-settings');assert.deepEqual(sent.at(-1),{action:'forensic_settings_read'});
 await ui.handle('forensic-setting-set','standard_reference');await submit(fd({value:'A verified reference'}));assert.deepEqual(sent.at(-1),{action:'forensic_setting_set',setting_key:'standard_reference',revision:3,value:'A verified reference'});
 await ui.handle('forensic-setting-confirm','standard_reference');await submit(fd({source_note:'Compliance Lead email of 10 Nov'}));assert.deepEqual(sent.at(-1),{action:'forensic_setting_confirm',setting_key:'standard_reference',revision:3,source_note:'Compliance Lead email of 10 Nov'});
 // an upload sends the form as multipart with the case id and the forensic upload kind
 const calls=[];const ui2=createForensicUI({$:()=>null,field:()=>'',select:()=>'',form:()=>'',modal:(t,h,s)=>{submit=s;},request:async(p,o)=>{calls.push([p,o]);return p.action==='forensic_get'?G():{ok:true};},notice:()=>{},button,area:()=>'',today:()=>'2026-11-10',data:()=>({me:me('MANAGER')})});
 await ui2.handle('forensic-case','c1');await ui2.handle('forensic-evidence-add');const f=new Map([['description','x']]);await submit(f);
 assert.equal(f.get('case_id'),'c1');assert.deepEqual(calls.at(-1)[1],{file:true,uploadKind:'forensic'});
 // downloads ask the server by evidence id as a blob
 const dl=[];const ui3=createForensicUI({$:()=>null,field:()=>'',select:()=>'',form:()=>'',modal:()=>{},request:async(p,o)=>{dl.push([p,o]);return p.action==='forensic_get'?G():new Blob(['x']);},notice:()=>{},button,area:()=>'',today:()=>'2026-11-10',data:()=>({me:me('MANAGER')})});
 await ui3.handle('forensic-case','c1');globalThis.URL.createObjectURL=()=>'blob:x';globalThis.URL.revokeObjectURL=()=>{};globalThis.window={open:()=>{}};
 await ui3.handle('forensic-evidence-file','e1');assert.deepEqual(dl.at(-1),[{action:'forensic_evidence_download',evidence_id:'e1'},{blob:true}]);
});

test('server module, upload and download routes, areas',()=>{
 const ts=rd(fx+'forensic-actions.ts'),idx=rd(fx+'index.ts'),ac=rd(fx+'staff-access-control.mjs');
 const actions=[...ts.matchAll(/p\.action==='([a-z_]+)'/g)].map(x=>x[1]);
 assert.ok(actions.length>=19);
 for(const a of [...actions,'forensic_evidence_download'])assert.equal(areaForStaffAction(a),'audit',a+' sits in the Audit & assurance area');
 assert.match(ts,/eligible\(a\)/);assert.match(ts,/'PARTNER','MANAGER','SUPERVISOR','ASSISTANT'/);
 assert.match(ts,/Only a Partner can open a forensic file/);assert.match(ts,/Only the lead Partner can issue a forensic report/);
 assert.match(idx,/import \{forensicAction\} from '\.\/forensic-actions\.ts'/);assert.match(idx,/const forensic=await forensicAction\(tx,a,p\);if\(forensic!==undefined\)return forensic;/);
 assert.match(idx,/x-erp-upload-kind'\)==='forensic'/);assert.match(idx,/async function forensicUpload\(req:Request,id:any\)/);assert.match(idx,/'forensic\/'\+caseId\+'\/'\+evidence/);
 assert.match(idx,/forensic_evidence_register\(/);assert.match(idx,/forensic_evidence_file\(/);assert.match(idx,/p\.action==='forensic_evidence_download'/);
 // the upload rolls the stored file back when the database refuses, and the database is called before the storage upload
 assert.ok(idx.indexOf('forensic_evidence_register(')<idx.indexOf("admin.storage.from(BUCKET).upload(key,bytes",idx.indexOf('async function forensicUpload')));
 // the forensic action is registered after incoming and nothing in it uses the general audit trigger
 assert.ok(idx.indexOf('incomingAction(tx,a,p)')<idx.indexOf('forensicAction(tx,a,p)'));
 assert.doesNotMatch(ts,/audit_events/);
});

test('menu link, wiring and cache busters',()=>{
 const f=MODULE_LINKS.find(m=>m.key==='forensic');assert.equal(f.built,true);assert.equal(f.action,'forensic-open');assert.equal(f.parent,'engagements');
 for(const r of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'])assert.ok(moduleLinks(me(r),'engagements',()=>true,{forensic:true}).some(x=>x.key==='forensic'&&x.suite==='forensic-open'),r);
 for(const r of ['INTERN','ADMIN'])assert.ok(!moduleLinks(me(r),'engagements',()=>true,{forensic:true}).some(x=>x.key==='forensic'),r);
 const su=rd('staff-suite.mjs');
 assert.match(su,/import \{createForensicUI\} from '\.\/staff-forensic\.mjs\?v=20261110-taxrole-v3'/);assert.match(su,/const forensic=createForensicUI\(\{\.\.\.ctx,button,area,check\}\)/);assert.match(su,/if\(await forensic\.handle\(action,id\)\)return;/);assert.match(su,/incoming,forensic,deadlines\}/);
 assert.match(rd('staff-forensic.mjs'),/request\(f,\{file:true,uploadKind:'forensic'\}\)/);
 const rel=JSON.parse(rd(fx+'release.json')).build;assert.match(rel,/^2026-11-11\.2778$/);assert.match(rd('staff-pilot.html'),new RegExp('data-build="'+rel.replace(/\./g,'\\.')+'"'));
 assert.doesNotMatch(rd('staff-forensic.mjs')+rd(fx+'forensic-actions.ts')+rd('supabase/migrations/20261110266000_forensic_file.sql'),/ISRS\s*4000/,'the unverified standard number appears nowhere in the code');
});

test('migration rules',()=>{
 const m=rd('supabase/migrations/20261110266000_forensic_file.sql');
 assert.equal((m.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,2,'settings plus a loop over the other tables');
 assert.match(m,/FORCE ROW LEVEL SECURITY/);assert.match(m,/forensic_on_list\(case_id\)/);
 assert.doesNotMatch(m,/log_change\(/,'no general change-audit trigger on any forensic table');assert.doesNotMatch(m,/CREATE TRIGGER change_audit/);
 assert.doesNotMatch(m,/GRANT (INSERT|UPDATE|DELETE)[^;]*forensic_(cases|access|evidence|custody|findings|reports|holds|events)/);
 assert.match(m,/Administrators and Interns cannot be added/);assert.match(m,/PENDING COMPLIANCE REVIEW/);
});

test('visibility decision (10 Nov 2026): no forensic hint on ordinary screens, the menu entry is gated by the database, the log is separate',()=>{
 const pilot=rd('staff-pilot.mjs'),nav=rd('staff-nav.mjs'),ts=rd(fx+'forensic-actions.ts');
 assert.equal(MODULE_LINKS.find(m=>m.key==='forensic').gate,'forensic');
 assert.deepEqual(moduleLinks(me('PARTNER'),'engagements').map(x=>x.key),['kra'],'hidden until the database answers yes');
 assert.match(pilot,/modLinks=v=>moduleLinks\(data\.me,v,canArea,navFlags\)/);
 assert.match(pilot,/request\(\{action:'forensic_menu'\}\),show=r\.show===true/);
 assert.match(pilot,/navFlags=\{forensic:false\};forensicMenuAt=0;/,'signing out clears it');
 assert.match(pilot,/catch\{forensicMenuAt=Date\.now\(\);\}/,'if the check fails the entry simply stays hidden');
 assert.match(ts,/if\(p\.action==='forensic_menu'\)\{if\(!\['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'\]\.includes\(a\.category_code\)\)return \{show:false\}/);
 assert.equal(areaForStaffAction('forensic_menu'),'audit');
 // nothing on the home, task, client or register screens mentions a forensic file
 for(const f of ['staff-client-cards.mjs','staff-client-register.mjs','staff-client-profile.mjs','staff-home.mjs','staff-work.mjs'])try{assert.doesNotMatch(rd(f),/orensic/,f);}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const mig=rd('supabase/migrations/20261110269000_forensic_visibility.sql');
 assert.match(mig,/DROP FUNCTION erp_private\.client_card_flags/);assert.doesNotMatch(mig.slice(mig.indexOf('CREATE FUNCTION erp_private.client_card_flags'),mig.indexOf('REVOKE')),/forensic/);
 assert.match(mig,/CHECK \(table_name !~\* 'forensic' AND action !~\* 'forensic'\)/);
});
