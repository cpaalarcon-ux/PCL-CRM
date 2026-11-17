import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {documentObjectKey} from '../supabase/functions/staff-workspace-v12/validation.mjs';
import {clientFilingPrefix,clientFolderName,evidencePath} from '../supabase/functions/staff-workspace-v12/engagement-setup-rules.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const C='3f2a9c10-aaaa-4bbb-8ccc-111122223333',F='4f2a9c10-aaaa-4bbb-8ccc-111122223333',D='5f2a9c10-aaaa-4bbb-8ccc-111122223333';
test('build 2862: a file is stored under its folder path when it has one, and keeps the old path when it does not',()=>{
 assert.equal(documentObjectKey(C,F,D,'application/pdf'),`clients/${C}/firms/${F}/${D}.pdf`,'no folder: the path every earlier file has');
 const task=evidencePath({clientName:'Chev Ltd',clientId:C,serviceCode:'VAT',periodStart:'2026-01-01',taskKey:'tpl:VAT:v2:sales:2026-01-01'});
 assert.equal(documentObjectKey(C,F,D,'application/pdf',task),task+D+'.pdf');
 assert.equal(documentObjectKey(C,F,D,'text/csv','Clients/Chev_Ltd-3f2a9c10/KYC/'),`Clients/Chev_Ltd-3f2a9c10/KYC/${D}.csv`);
 for(const bad of ['../x/','Clients/../x/','Clients/a/','/Clients/a/b/','Clients/a b/c/','https://x/a/b/','Other/a/b/','Clients/a/b'])assert.throws(()=>documentObjectKey(C,F,D,'application/pdf',bad),e=>e.status===400,bad);
 assert.throws(()=>documentObjectKey(C,F,D,'text/html','Clients/a/b/'),'a type that is not allowed is still refused');
});
test('only client-level KYC and Permanent File uploads get a client folder; everything else is left as it was',()=>{
 assert.equal(clientFilingPrefix('KYC Pending','Chev Ltd',C),'Clients/Chev_Ltd-3f2a9c10/KYC/');
 assert.equal(clientFilingPrefix('Permanent File','Chev Ltd',C),'Clients/Chev_Ltd-3f2a9c10/Permanent_File/');
 for(const c of ['Working Papers','Tax Returns','Import Sources','Correspondence','KRA Notices','Final Reports'])assert.equal(clientFilingPrefix(c,'Chev Ltd',C),null,c);
 assert.equal(clientFolderName('',C),'Client-3f2a9c10');
 assert.notEqual(clientFolderName('Chev',C),clientFolderName('Chev','9f2a9c10-aaaa-4bbb-8ccc-111122223333'),'two clients with one name never share a folder');
});
test('the upload files under the folder in the same step as the record, and the task screen shows the path',()=>{
 const ix=rd('supabase/functions/staff-workspace-v12/index.ts');
 assert.match(ix,/let key=documentObjectKey\(cid,firm,doc,mime\)/);assert.match(ix,/select path_prefix from erp_private\.evidence_folders where task_id=\$\{tid\}/);assert.match(ix,/else if\(!pid\)\{const nm=/);assert.match(ix,/if\(prefix\)key=documentObjectKey\(cid,firm,doc,mime,prefix\)/);
 assert.ok(ix.indexOf("if(prefix)key=documentObjectKey")<ix.indexOf("insert into erp_private.documents(document_id"),'the path is settled before the record is written');
 assert.ok(ix.indexOf("insert into erp_private.documents(document_id")<ix.indexOf("admin.storage.from(BUCKET).upload(key,bytes,{contentType:mime,upsert:false});\n  if(result.error)fail(502,'The file could not be stored. No document was saved."));
 assert.match(rd('staff-task-workspace.mjs'),/id="taskFolder" class="muted" data-task-id="\$\{t\.task_id\}"/);
 const pr=rd('staff-procedures.mjs');assert.match(pr,/action:'engagement_folder_read',task_id:id/);assert.match(pr,/data-evidence-path/);assert.match(pr,/if\(!host\)return;paintFolder\(id\);/);
});
