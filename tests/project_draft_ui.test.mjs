import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const projectUi=fs.readFileSync(new URL('../staff-workspace-v6.mjs',import.meta.url),'utf8');
const appHtml=fs.readFileSync(new URL('../staff-pilot.html',import.meta.url),'utf8');

test('draft project explains that retained UAT tasks do not mean the project is active',()=>{
 assert.match(projectUi,/Schedule configured · task release held/);
 assert.match(projectUi,/Earlier UAT carry-over/);
 assert.match(projectUi,/Draft project:<\/b> the schedule is saved, but no new tasks are released/);
 assert.match(projectUi,/Existing UAT tasks remain visible from earlier testing but do not make this draft project active/);
 assert.match(projectUi,/financial outputs are not ready/);
});

test('staging build cache key changes with the access guide',()=>{
 assert.match(appHtml,/2026-11-03\.3/);
 assert.match(appHtml,/20261103-sign-in-bootstrap-v1/);
});

test('new recurring tax work uses a client reporting-month boundary and one separate catch-up upload',()=>{
 assert.match(projectUi,/currentReportingMonth\(selectedClient\|\|\{\},today\(\)\)/);
 assert.match(projectUi,/nextReportingMonthStart\(value,client,today\(\)\)/);
 assert.match(projectUi,/One catch-up upload task/);
 assert.match(projectUi,/Preview ready — not saved/);
 assert.match(projectUi,/project_id:id,client_id:el\('client_id'\)\.value,firm_id:el\('firm_id'\)\.value/);
 assert.match(projectUi,/projectClientSetupHint/);
 assert.match(projectUi,/Opening mappings are reviewed with the journal at posting/);
});

test('schedule preview checks client setup before it returns a plan',()=>{
 const actions=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/workspace-actions.ts',import.meta.url),'utf8');
 const preview=actions.slice(actions.indexOf("if(p.action==='schedule_config_preview')"),actions.indexOf("if(p.action==='project_save')"));
 assert.match(preview,/await requireProjectSetup\(tx,cid\)/);
 assert.match(preview,/client_firm_links/);
 assert.match(preview,/project\.client_id!==cid\|\|project\.handling_firm_id!==firm/);
 assert.match(preview,/starts_on\.slice\(8,10\)!=='01'/);
});

