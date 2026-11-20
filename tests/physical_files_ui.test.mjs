// Physical file register: what the screen shows and hides, and how it is wired (build 2781).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {filesView,historyView,METHODS} from '../staff-physical-files.mjs';
import {ticketsView} from '../staff-client-support.mjs';
import {fileActions,highPriorityStale,ticketFileLine,HIGH_PRIORITY_RESPONSE_HOURS} from '../staff-physical-file-rules.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {rightForAction,STAFF_RIGHTS} from '../supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const button=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const f=(o={})=>({file_id:'f1',file_ref:'PHY-2026-001',client_id:'c1',firm_id:'x',description:'Bank statements <box>',received_on:'2026-11-10',received_from:'Driver',location:'Shelf B, Box 4',holder_id:null,holder_name:null,status:'In store',digital_document_id:null,digital_name:null,no_scan_reason:null,company_name:'Fictional Co',ticket_number:7,revision:1,...o});
test('actions open on a file depend on its state, and a locked file offers none',()=>{
 const mgr={category_code:'MANAGER'};
 assert.deepEqual(fileActions(f(),mgr).open,['pf-move','pf-copy','pf-pending'],'no copy yet: it cannot go back or be archived');
 assert.match(fileActions(f(),mgr).notes.join(' '),/No scanned copy/);
 assert.deepEqual(fileActions(f({no_scan_reason:'Originals only, client asked'}),mgr).open,['pf-move','pf-copy','pf-pending','pf-archive']);
 assert.deepEqual(fileActions(f({digital_document_id:'d',status:'Pending dispatch'}),mgr).open,['pf-move','pf-copy','pf-return','pf-archive']);
 for(const s of ['Returned to client','Archived']){const a=fileActions(f({status:s,digital_document_id:'d'}),mgr);assert.deepEqual(a.open,[]);assert.match(a.notes[0],/locked/);}
 assert.deepEqual(fileActions(f(),{category_code:'INTERN'}).open,[]);
});
test('the register draws, escapes, and offers the dispatch note only after a return',()=>{
 const h=filesView({files:[f({holder_id:'s1',holder_name:'A colleague',status:'With staff'}),f({file_id:'f2',file_ref:'PHY-2026-002',status:'Returned to client',digital_document_id:'d',digital_name:'scan <1>.pdf'})],me:{category_code:'MANAGER'},button,nameOf:(id,fb)=>id==='s1'?'Sam S':fb});
 assert.match(h,/PHY-2026-001/);assert.match(h,/Bank statements &lt;box&gt;/);assert.doesNotMatch(h,/<box>/);assert.match(h,/With Sam S/);assert.match(h,/Ticket CST-7/);
 assert.match(h,/Not linked/);assert.match(h,/scan &lt;1&gt;\.pdf/);assert.equal((h.match(/Dispatch note/g)||[]).length,1);assert.match(h,/Locked/);
 assert.match(filesView({files:[],me:{category_code:'MANAGER'},button}),/No physical files registered yet/);
 const hist=historyView(f(),[{moved_at:'2026-11-10T08:00:00Z',kind:'Returned to client',moved_by_name:'Sam <S>',dispatch_note_no:'DN-2026-001',dispatch_method:'Courier',dispatch_recipient:'Mr X',dispatch_reference:'W1',note:'ok'}]);
 assert.match(hist,/DN-2026-001 · Courier · Mr X · ref W1/);assert.match(hist,/Sam &lt;S&gt;/);assert.match(hist,/only added to/);
 assert.deepEqual(METHODS,['Hand delivery','Courier','Post','Collected by client']);
});
test('tickets: high priority not started in 24 hours, and files still in the office',()=>{
 const now=Date.parse('2026-11-11T12:00:00Z');
 assert.equal(HIGH_PRIORITY_RESPONSE_HOURS,24);
 assert.equal(highPriorityStale({status:'Open',priority:'High',opened_at:'2026-11-10T11:00:00Z'},now),true);
 assert.equal(highPriorityStale({status:'Open',priority:'High',opened_at:'2026-11-11T08:00:00Z'},now),false);
 assert.equal(highPriorityStale({status:'In progress',priority:'Urgent',opened_at:'2026-11-01T08:00:00Z'},now),false);
 assert.equal(highPriorityStale({status:'Open',priority:'Medium',opened_at:'2026-11-01T08:00:00Z'},now),false);
 assert.match(ticketFileLine([{file_ref:'PHY-2026-001',status:'In store'},{file_ref:'PHY-2026-002',status:'Archived'}]),/1 physical file still in the office \(PHY-2026-001\)/);
 const t={ticket_id:'t1',ticket_number:7,subject:'S',company_name:'Co',service_name:'Svc',is_billable:false,status:'Open',assigned_name:'Sam',opened_at:'2026-11-09T08:00:00Z',priority:'High',high_priority_stale:true,files_in_office:2};
 const h=ticketsView({tickets:[t],me:{category_code:'MANAGER'},button});
 assert.match(h,/High priority and not started within 24 hours/);assert.match(h,/2 physical files still in the office/);
 assert.doesNotMatch(ticketsView({tickets:[{...t,high_priority_stale:false,files_in_office:0}],me:{category_code:'MANAGER'},button}),/not started within 24 hours|still in the office/);
});
test('wiring: documents area, one right, the server route, busters, same rules on both sides, and no retention period',()=>{
 for(const a of ['physical_file_list','physical_file_register','physical_file_move','physical_file_return','physical_file_archive','physical_file_dispatch_note'])assert.equal(areaForStaffAction(a),'documents',a);
 const r=STAFF_RIGHTS.find(x=>x.code==='physicalfiles.work');assert.ok(r);assert.deepEqual(r.roles,['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']);assert.equal(rightForAction('physical_file_register'),'physicalfiles.work');
 const idx=read('supabase/functions/staff-workspace-v12/index.ts');assert.match(idx,/physicalFileAction\(tx,a,p\)/);assert.match(idx,/setPhysicalPdfLib\(PDFLib\)/);
 assert.equal(read('staff-physical-file-rules.mjs'),read('supabase/functions/staff-workspace-v12/physical-file-rules.mjs'),'screen and server rules are the same file');
 const su=read('staff-suite.mjs');assert.match(su,/staff-client-support\.mjs\?v=20261111-physfile-v1/);
 const cs=read('staff-client-support.mjs');assert.match(cs,/staff-physical-files\.mjs\?v=20261111-physfile-v1/);assert.match(read('staff-physical-files.mjs'),/staff-physical-file-rules\.mjs\?v=20261111-physfile-v1/);
 for(const file of ['staff-physical-files.mjs','staff-physical-file-rules.mjs','supabase/functions/staff-workspace-v12/physical-file-actions.ts','supabase/migrations/20261111020000_physical_files.sql'])assert.doesNotMatch(read(file).replace(/Retention periods[^.\n]*\.|retention[^.\n]*not decided[^.\n]*\./gi,''),/retention_|retain_until|destroy_on|dispose/i,file);
 assert.doesNotMatch(read('staff-physical-files.mjs'),/ISRS 4000/);
});
