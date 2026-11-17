import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {evidencePath,folderSummary,folderSentence} from '../supabase/functions/staff-workspace-v12/engagement-setup-rules.mjs';
test('build 2857: the folder path is fixed by client, service, period and task, and is safe as a storage path',()=>{
 const base={clientName:'Chev Ltd & Sons',clientId:'3f2a9c10-aaaa-bbbb-cccc-111122223333',serviceCode:'VAT',periodStart:'2026-01-01',taskKey:'tpl:VAT:v2:file_return:2026-01-01'};
 assert.equal(evidencePath(base),'Clients/Chev_Ltd_Sons-3f2a9c10/VAT_2026/Period_2026-01/file_return_2026_01_01/');
 assert.equal(evidencePath(base),evidencePath({...base}),'the same set-up always gives the same path');
 assert.notEqual(evidencePath(base),evidencePath({...base,clientId:'9f2a9c10-aaaa-bbbb-cccc-111122223333'}),'two clients with one name never share a folder');
 const odd=evidencePath({...base,clientName:'../../etc/Ünïcode  /x',taskKey:'tpl:VAT:v1:../x y'});assert.match(odd,/^Clients\/[A-Za-z0-9_-]+\/VAT_2026\/Period_2026-01\/[A-Za-z0-9_-]+\/$/);assert.doesNotMatch(odd,/\.\./);
 assert.match(evidencePath({...base,clientName:'',taskKey:''}),/^Clients\/Client-3f2a9c10\/.*\/Task\/$/);
});
test('the preview counts periods, tasks and folders from the plan and words them correctly',()=>{
 const year=Array.from({length:12},(_,i)=>({period_start:`2026-${String(i+1).padStart(2,'0')}-01`,period_end:`2026-${String(i+1).padStart(2,'0')}-28`}));
 assert.equal(folderSentence(folderSummary(year)),'This will generate 12 periods, 12 tasks and 12 evidence folders.');
 assert.deepEqual(folderSummary([...year,...year]),{periods:12,tasks:24,folders:24},'two tasks in a period are two tasks but one period');
 assert.equal(folderSentence(folderSummary([year[0]])),'This will generate 1 period, 1 task and 1 evidence folder.');
 assert.deepEqual(folderSummary(null),{periods:0,tasks:0,folders:0});
});
test('the screen shows the sentence from the plan, and the release makes the folder with the task',()=>{
 const ui=fs.readFileSync(new URL('../staff-service-setup.mjs',import.meta.url),'utf8');
 assert.match(ui,/data-evidence-summary>This will generate <b>\$\{sum\.periods\}<\/b>/);assert.match(ui,/plan\.create\.length\?`<p data-evidence-summary>/);
 const act=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/service-template-actions.ts',import.meta.url),'utf8');
 assert.match(act,/summary:folderSummary\(tasks\.create\)/);assert.match(act,/if\(rows\.length\)await tx`insert into erp_private\.evidence_folders/);assert.match(act,/on conflict\(task_id\) do nothing/);
});
