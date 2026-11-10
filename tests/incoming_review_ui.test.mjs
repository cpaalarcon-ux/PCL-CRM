// Step 8 (joined-practice review): the Incoming Review screens, the server module, wiring and the rules it must not break.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {queueView,itemView,timelineView,linksView,sizeText,settingStatus,settingValue,matchText,duplicateText,bannerText,INCOMING_NOTE,SOURCES,STATUS_TONE,MATCH_TONE,createIncomingUI,incomingCardHtml} from '../staff-incoming.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const button=(a,l,id='',x='')=>`<button data-suite="${a}" data-id="${id}" ${x}>${l}</button>`;
const me=c=>({category_code:c,staff_id:'me'});
const item=(o={})=>({item_id:'i1',source_type:'WhatsApp',sender_name:'Jane <Client>',sender_address:'+254 712 345 678',received_at:'2026-11-09T09:00:00Z',subject:'Bank statement for March',message_text:'Please find the statement.\nThanks',file_name:'statement.pdf',file_size_bytes:2048,mime_type:'application/pdf',
 is_kyc:false,confidentiality:'Normal',client_id:'c1',client_name:'UAT <Fictional> Ltd',contact_id:'k1',contact_name:'Jane',match_result:'One match',match_count:1,duplicate_document_id:null,duplicate_item_id:null,status:'Received',logged_by_name:'Sam Supervisor',logged_at:'2026-11-09T09:05:00Z',
 category:null,document_id:null,decided_by_name:null,decided_at:null,decision_note:null,resolution:null,revision:1,past_retention:false,...o});

test('wording helpers',()=>{
 assert.equal(sizeText(500),'500 B');assert.equal(sizeText(2048),'2.0 KB');assert.equal(sizeText(3*1048576),'3.0 MB');assert.equal(sizeText(0),'');assert.equal(sizeText(null),'');
 assert.equal(settingStatus({rule_status:'Suggested'}),'Default - not yet confirmed');assert.match(settingStatus({rule_status:'Confirmed',confirmed_at:'2026-11-10T08:00:00Z'}),/Confirmed on 2026-11-10/);
 assert.equal(settingValue({int_value:365,text_value:null}),'365 days');assert.equal(settingValue({int_value:null,text_value:'SUPERVISOR'}),'Supervisor and above');assert.equal(settingValue({int_value:null,text_value:'LEADERS_ONLY'}),'Managers and Partners only');
 assert.match(matchText(item()),/Matched to UAT <Fictional> Ltd through Jane/);assert.match(matchText(item({match_result:'Several matches',match_count:2,client_id:null})),/2 clients use this number or email/);
 assert.match(matchText(item({match_result:'No match',client_id:null})),/No client contact has this number or email/);assert.match(matchText(item({match_result:'Chosen by staff'})),/Client chosen by staff: UAT/);
 assert.deepEqual(duplicateText(item()),[]);assert.equal(duplicateText(item({duplicate_document_id:'d',duplicate_item_id:'j'})).length,2);
 assert.equal(bannerText({incoming_waiting:0}),'No incoming files are waiting');assert.equal(bannerText({incoming_waiting:1,incoming_needs_review:0}),'1 incoming file waiting');assert.equal(bannerText({incoming_waiting:4,incoming_needs_review:1}),'4 incoming files waiting, 1 needs a closer look');assert.equal(bannerText({incoming_waiting:4,incoming_needs_review:2}),'4 incoming files waiting, 2 need a closer look');
 assert.match(INCOMING_NOTE,/A Partner has not yet confirmed them/);assert.match(INCOMING_NOTE,/Nothing is ever deleted/);assert.match(INCOMING_NOTE,/not set up/);
 assert.deepEqual(SOURCES,['WhatsApp','Email','Hand delivered','Post or courier']);assert.equal(STATUS_TONE['Needs Review'],'warn');assert.equal(MATCH_TONE['One match'],'ok');
});

test('queue: rows, badges, escaping, empty states',()=>{
 const r={items:[item(),item({item_id:'i2',client_id:null,client_name:null,match_result:'No match',status:'Needs Review',is_kyc:true,confidentiality:'Restricted',duplicate_item_id:'i1',subject:'ID <card>'})],counts:{incoming_waiting:2,incoming_needs_review:1}};
 const h=queueView({r,me:me('SUPERVISOR'),button,archived:false});
 assert.match(h,/id="incomingQueue"/);assert.match(h,/UAT &lt;Fictional&gt; Ltd/);assert.doesNotMatch(h,/<Fictional>/);assert.match(h,/Jane &lt;Client&gt;/);assert.match(h,/ID &lt;card&gt;/);
 assert.match(h,/Not known yet/);assert.match(h,/Identity \/ KYC/);assert.match(h,/>Restricted</);assert.match(h,/>Duplicate</);
 assert.equal((h.match(/data-suite="incoming-item"/g)||[]).length,2);
 assert.match(h,/data-suite="incoming-log"/);assert.match(h,/data-suite="incoming-settings"/);assert.match(h,/2 incoming files waiting, 1 needs a closer look/);assert.match(h,/A Partner has not yet confirmed them/);
 assert.match(h,/Managers and Partners also see Restricted files/,'a Supervisor is told what a leader sees');
 assert.doesNotMatch(queueView({r,me:me('MANAGER'),button,archived:false}),/Managers and Partners also see Restricted files/);
 assert.match(queueView({r:{items:[],counts:{}},me:me('PARTNER'),button,archived:false}),/No incoming files are waiting/);
 assert.match(queueView({r:{items:[],counts:{}},me:me('PARTNER'),button,archived:true}),/Nothing has been filed or archived yet/);
 const arch=queueView({r:{items:[item({status:'Archived',resolution:'Rejected',past_retention:true})],counts:{}},me:me('PARTNER'),button,archived:true});
 assert.match(arch,/Rejected · past retention/);
});

test('item: client choice, accept button only once a client is known, decisions',()=>{
 const cand=[{client_id:'c1',client_name:'Client <One>',contact_name:'Jane'},{client_id:'c2',client_name:'Client Two',contact_name:'Joe'}];
 const w=itemView({item:item({client_id:null,client_name:null,match_result:'Several matches',match_count:2,status:'Needs Review'}),candidates:cand,clients:[{client_id:'c1',company_name:'Client <One>'}],me:me('SUPERVISOR'),button});
 assert.match(w,/Clients that match this sender/);assert.equal((w.match(/data-suite="incoming-use-client"/g)||[]).length,2);assert.match(w,/Client &lt;One&gt;/);assert.doesNotMatch(w,/<One>/);
 assert.doesNotMatch(w,/data-suite="incoming-accept"/);assert.match(w,/Choose the client to accept this file/);
 assert.match(w,/id="incomingClient"/);assert.match(w,/data-suite="incoming-pick-client"/);
 const ok=itemView({item:item(),clients:[],me:me('SUPERVISOR'),button});
 assert.match(ok,/data-suite="incoming-accept"/);for(const r of ['Replacement requested','Rejected','Duplicate','Withdrawn'])assert.match(ok,new RegExp('data-suite="incoming-archive" data-id="'+r+'"'));
 assert.match(ok,/data-suite="incoming-file"/);assert.match(ok,/Please find the statement\./);assert.match(ok,/Mark as Restricted/);assert.match(ok,/Mark as identity \/ KYC/);
 const dup=itemView({item:item({duplicate_document_id:'d1',status:'Needs Review'}),clients:[],me:me('MANAGER'),button});assert.match(dup,/Possible duplicate[^]*already filed for a client/);
 const restricted=itemView({item:item({confidentiality:'Restricted',is_kyc:true}),clients:[],me:me('MANAGER'),button});assert.match(restricted,/Mark as Normal/);assert.match(restricted,/Not identity \/ KYC/);
 const done=itemView({item:item({status:'Accepted and Linked',resolution:'Accepted',document_id:'doc1',decided_by_name:'Mia Manager',decided_at:'2026-11-10T07:00:00Z',category:'Correspondence',decision_note:'Checked'}),clients:[],me:me('MANAGER'),button});
 assert.match(done,/Accepted[^]*by Mia Manager on 2026-11-10[^]*Filed as Correspondence/);assert.match(done,/data-suite="incoming-links" data-id="doc1"/);assert.doesNotMatch(done,/incoming-accept|incoming-archive/);
 const gone=itemView({item:item({status:'Archived',resolution:'Replacement requested',decided_by_name:'Mia Manager',decided_at:'2026-11-10T07:00:00Z',decision_note:'Unreadable scan'}),clients:[],me:me('MANAGER'),button});
 assert.match(gone,/Replacement requested[^]*Unreadable scan/);assert.doesNotMatch(gone,/incoming-accept/);
});

test('timeline and links',()=>{
 const ev=[{kind:'Communication',id:'m1',at:'2026-11-09',created_at:'2026-11-09T10:00:00Z',reference:'COM/AUDB/2026/00001',channel:'WhatsApp',direction:'Incoming',sender_address:'+254712345678',title:'Statement <March>',status:'Open',documents:[{document_id:'d1',file_name:'statement.pdf',category:'Correspondence'}]},
  {kind:'Document',id:'d2',at:'2026-11-08',created_at:'2026-11-08T10:00:00Z',title:'filed.pdf',category:'Working Papers',source_type:'Upload',documents:[{document_id:'d2',file_name:'filed.pdf',category:'Working Papers'}]},
  {kind:'Communication',id:'m2',at:'2026-11-07',created_at:'x',reference:'COM/2',channel:'Internal note',direction:null,title:'Note',status:'Closed',documents:[]}];
 const h=timelineView({events:ev,button});
 assert.match(h,/WhatsApp[^]*Incoming[^]*Statement &lt;March&gt;/);assert.doesNotMatch(h,/<March>/);assert.match(h,/statement\.pdf/);assert.match(h,/Internal note/);
 assert.equal((h.match(/data-suite="incoming-links"/g)||[]).length,2,'each document has a linked-records button');
 assert.match(timelineView({events:[],button}),/Nothing has been recorded for this client yet/);
 const l=linksView({links:[{link_id:'l1',communication_id:'m1',communication_reference:'COM/1',communication_channel:'Email'},{link_id:'l2',period_start:'2025-01-01',period_end:'2025-12-31'},{link_id:'l3',kra_case_id:'k',notice_reference:'KRA/1',removed_at:'2026-11-10',removal_reason:'Wrong notice'}],document:{file_name:'a <b>.pdf',category:'KRA Notices'},button});
 assert.match(l,/a &lt;b&gt;\.pdf/);assert.match(l,/Communication COM\/1 \(Email\)/);assert.match(l,/Period 2025-01-01 to 2025-12-31/);assert.equal((l.match(/data-suite="incoming-link-remove"/g)||[]).length,2,'removed links have no button');assert.match(l,/Removed:[^]*KRA notice KRA\/1[^]*Wrong notice/);assert.match(l,/data-suite="incoming-link-add"/);
 assert.match(linksView({links:[],document:{},button}),/no extra links/);
});

test('handler: only incoming- actions; requests and the accept payload',async()=>{
 const sent=[];let shown='',submit=null,after=null;
 const resp={incoming_list:{items:[item()],counts:{incoming_waiting:1,incoming_needs_review:0},settings:[]},incoming_clients:{clients:[{client_id:'c1',company_name:'C'}]},incoming_options:{firms:[{firm_id:'f1',firm_code:'AUDB',legal_name:'Fic'}],projects:[],tasks:[],kra_cases:[],communications:[],categories:['Correspondence'],project_required:[]},incoming_accept:{ok:true,document_id:'doc',category:'Correspondence',communication_id:'cm'},incoming_candidates:{candidates:[]},document_links:{links:[],document:{document_id:'doc1',file_name:'a.pdf',category:'KRA Notices',client_id:'c1'}},client_timeline:{events:[]}};
 const ui=createIncomingUI({$:()=>null,field:()=>'',select:()=>'',form:()=>'',modal:(t,h,s,a)=>{shown=t+' '+h;submit=s;after=a;},request:async p=>{sent.push(p);return resp[p.action]||{ok:true};},notice:()=>{},button,area:()=>'',today:()=>'2026-11-10',data:()=>({me:me('SUPERVISOR')})});
 assert.equal(await ui.handle('kra-open','x'),false);assert.equal(await ui.handle('finance-tab','x'),false);assert.equal(await ui.handle('aup-open','x'),false);
 assert.equal(await ui.handle('incoming-open'),true);assert.deepEqual(sent[0],{action:'incoming_list',archived:false});assert.match(shown,/Incoming review/);
 await ui.handle('incoming-archived');assert.deepEqual(sent.at(-1),{action:'incoming_list',archived:true});assert.match(shown,/filed and archived/);
 await ui.handle('incoming-item','i1');assert.match(shown,/Incoming file · Bank statement/);
 await ui.handle('incoming-accept','i1');assert.deepEqual(sent.at(-1),{action:'incoming_options',client_id:'c1'});assert.match(shown,/Accept and link/);
 // The accept form sends explicit booleans, and "create a communication" is dropped when an existing communication is chosen.
 const fd=o=>new Map(Object.entries(o)),asEntries=m=>m;
 const out=await submit(fd({firm_id:'f1',category:'Correspondence',project_id:'',task_id:'',kra_case_id:'',period_start:'',period_end:'',confidentiality:'Normal',communication_id:'',create_communication:'true',note:''}));
 assert.equal(out.ok,true);const req=sent.at(-1);
 assert.deepEqual([req.action,req.item_id,req.client_id,req.firm_id,req.category,req.create_communication,req.confirm_duplicate],['incoming_accept','i1','c1','f1','Correspondence',true,false]);
 await submit(fd({firm_id:'f1',category:'Correspondence',communication_id:'cm9',create_communication:'true',confirm_duplicate:'true'}));
 assert.deepEqual([sent.at(-1).communication_id,sent.at(-1).create_communication,sent.at(-1).confirm_duplicate],['cm9',false,true]);
 await ui.handle('incoming-archive','Rejected');assert.match(shown,/Reject this file/);
 await submit(fd({reason:'Not for this client at all'}));assert.deepEqual(sent.at(-1),{action:'incoming_archive',item_id:'i1',resolution:'Rejected',reason:'Not for this client at all'});
 await ui.handle('incoming-use-client','c2');assert.deepEqual(sent.find(x=>x.action==='incoming_choose_client'),{action:'incoming_choose_client',item_id:'i1',client_id:'c2'});
 await ui.handle('incoming-handling','Restricted');assert.deepEqual(sent.find(x=>x.action==='incoming_set_handling'),{action:'incoming_set_handling',item_id:'i1',confidentiality:'Restricted',is_kyc:false});
 await ui.handle('incoming-timeline','c1');assert.deepEqual(sent.at(-1),{action:'client_timeline',client_id:'c1'});
 await ui.handle('incoming-links','doc1');assert.deepEqual(sent.at(-1),{action:'document_links',document_id:'doc1'});
});

test('card on the Documents page is for reviewers only',()=>{
 assert.equal(incomingCardHtml(me('ASSISTANT'),button),'');assert.equal(incomingCardHtml(me('INTERN'),button),'');assert.equal(incomingCardHtml(me('ADMIN'),button),'');
 for(const r of ['SUPERVISOR','MANAGER','PARTNER'])assert.match(incomingCardHtml(me(r),button),/id="incomingCard"[^]*incoming-open[^]*incoming-timeline-pick[^]*data-incoming-count/);
});

test('server module: actions, areas, rules',()=>{
 const ts=rd(fx+'incoming-actions.ts'),idx=rd(fx+'index.ts');
 const actions=[...ts.matchAll(/p\.action==='([a-z_]+)'/g)].map(x=>x[1]);
 for(const a of ['incoming_list','incoming_clients','incoming_options','incoming_candidates','incoming_choose_client','incoming_set_handling','incoming_accept','incoming_archive','incoming_kyc_approve','incoming_settings_read','incoming_setting_set','incoming_setting_confirm','document_links','document_link_add','document_link_remove','client_timeline'])assert.ok(actions.includes(a),a);
 for(const a of actions)assert.ok(areaForStaffAction(a),a+' has an access area');
 for(const a of actions.filter(a=>a.startsWith('incoming_')||a.startsWith('document_')))assert.equal(areaForStaffAction(a),'documents',a);
 assert.equal(areaForStaffAction('client_timeline'),'communications');assert.equal(areaForStaffAction('incoming_download'),'documents');
 assert.match(idx,/import \{incomingAction\} from '\.\/incoming-actions\.ts'/);assert.match(idx,/const incoming=await incomingAction\(tx,a,p\);if\(incoming!==undefined\)return incoming;/);
 assert.ok(idx.indexOf('kraAction(tx,a,p)')<idx.indexOf('incomingAction(tx,a,p)')&&idx.indexOf('incomingAction(tx,a,p)')<idx.indexOf('auditAction(tx,a,p'));
 assert.match(ts,/partnerOf\(a,'Only a Partner can change an incoming-file setting\.'\)/);assert.match(ts,/partnerOf\(a,'Only a Partner can confirm an incoming-file setting\.'\)/);
 assert.match(ts,/reviewer=\(a:any\)=>\{if\(!\['PARTNER','MANAGER','SUPERVISOR'\]\.includes\(a\.category_code\)\)/,'Assistants, Interns and administrators are turned away');
 assert.doesNotMatch(ts,/delete from|update erp_private\.incoming_items|insert into erp_private\.incoming_items|insert into erp_private\.documents/i,'items and documents are written only by the database functions');
 assert.match(ts,/choice\(p\.confidentiality,\['Normal','Restricted'\]\)/,'Forensic cannot be chosen at review');
 assert.match(idx,/x-erp-upload-kind'\)==='incoming'/);assert.match(idx,/p\.action==='incoming_download'/);assert.match(idx,/'Correspondence','KRA Notices'\]\);\n const importPurpose/);
 const cfg=rd(fx+'tax-config-actions.ts');assert.match(cfg,/erp_private\.incoming_counts\(\)/);
 const su=rd(fx+'suite-actions.ts');assert.match(su,/'Letter','Email','WhatsApp','Call','Meeting','Visit','Internal note'/);assert.match(su,/Say whether the WhatsApp message was incoming or outgoing/);
 assert.match(rd(fx+'workspace-read.ts'),/d\.source_type,d\.confidentiality,d\.communication_id/);
});

test('wiring: screen imported, routed, reachable from Documents and Communications',()=>{
 const su=rd('staff-suite.mjs'),pi=rd('staff-pilot.mjs'),css=rd('staff-pilot.css');
 assert.match(su,/import \{createIncomingUI\} from '\.\/staff-incoming\.mjs\?v=20261110-taxrole-v3'/);assert.match(su,/const incoming=createIncomingUI\(\{\.\.\.ctx,button,area,check\}\)/);assert.match(su,/if\(await incoming\.handle\(action,id\)\)return;/);assert.match(su,/return \{[^}]*kra,incoming(,forensic)?(,deadlines)?\}/);
 assert.match(su,/'Letter','Email','WhatsApp','Call','Meeting','Visit','Internal note'/);assert.match(su,/select\('direction'/);assert.match(su,/field\('sender_address'/);
 assert.match(pi,/return incomingCardHtml\(data\.me,suite\.button\)\+/);assert.match(pi,/if\(view==='documents'\)void suite\.incoming\.paintCard\(\);/);
 assert.match(pi,/'Correspondence','KRA Notices','Import Sources'\]/);assert.match(css,/\.timeline-doc\{/);
 const html=rd('staff-pilot.html'),rel=JSON.parse(rd(fx+'release.json'));
 assert.match(html,new RegExp('data-build="'+rel.build.replace(/\./g,'\\.')+'"'));assert.equal(rel.build,'2026-11-11.2775');
 for(const f of ['staff-pilot.mjs','staff-suite.mjs','staff-pilot-auth.js','staff-pilot.html','staff-improvements.mjs','staff-audit.mjs','staff-audit-home.mjs','staff-audit-reports.mjs'])assert.doesNotMatch(rd(f),/20261109-kra-v1/,f+' carries the new cache-buster');
});

test('migration: the rules that must not be loosened',()=>{
 const m=rd('supabase/migrations/20261109265000_incoming_review.sql');
 assert.doesNotMatch(m,/ISRS 4000/);assert.doesNotMatch(m,/DELETE FROM erp_private\./i);assert.doesNotMatch(m,/GRANT (INSERT|UPDATE|DELETE)[^;]*ON erp_private\.(incoming_items|document_links)/,'items and links are written only through functions');
 for(const t of ['incoming_items','incoming_settings','document_links'])assert.match(m,new RegExp('ALTER TABLE erp_private\\.'+t+' FORCE ROW LEVEL SECURITY'),t);
 assert.match(m,/Forensic level is not offered/);assert.match(m,/'Correspondence','KRA Notices'\)/);
 const fns=[...m.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (erp_private\.[a-z_]+)\(/g)].map(x=>x[1]);
 assert.ok(fns.length>=25);for(const fn of new Set(fns)){const at=m.indexOf('FUNCTION '+fn+'(');assert.ok(/search_path/.test(m.slice(at,at+3800)),fn+' pins the search path');}
});
