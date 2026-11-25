import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {pipelineSteps,clientSetupPipelineAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-pipeline-actions.ts');
const base={sections_approved:0,sections_pending:0,owners:0,contacts:0,aml_stage:null,aml_submitted:false,aml_decision:null};
test('a client with nothing entered is not started and sits in the preparer queue',()=>{const s=pipelineSteps(base);assert.equal(s.preparer,'Not started');assert.equal(s.queue,'preparer');assert.ok(s.missing.includes('Owners'));});
test('partly entered data is in progress',()=>{const s=pipelineSteps({...base,owners:1,sections_pending:3});assert.equal(s.preparer,'In progress');assert.equal(s.queue,'preparer');});
test('a complete preparer step moves the client to the MLRO queue',()=>{const s=pipelineSteps({...base,owners:1,contacts:1,sections_approved:4,sections_pending:5,aml_stage:'MLRO review',aml_submitted:true});assert.equal(s.preparer,'Done');assert.equal(s.mlro,'Waiting');assert.equal(s.queue,'mlro');assert.equal(s.manager,'Not started');});
test('an MLRO decision moves the client to the manager queue; the partner is never ahead of the manager',()=>{const s=pipelineSteps({...base,owners:1,contacts:1,sections_approved:9,aml_submitted:true,aml_decision:'Accept'});assert.equal(s.mlro,'Done');assert.equal(s.manager,'Waiting');assert.equal(s.partner,'Not started');assert.equal(s.queue,'manager');});
test('only a Manager or Partner reads it, and other actions pass through',async()=>{
 await assert.rejects(()=>clientSetupPipelineAction(null,{category_code:'ASSISTANT'},{action:'client_setup_pipeline_read'}),/Manager or Partner/);
 assert.equal(await clientSetupPipelineAction(null,{category_code:'MANAGER'},{action:'other'}),undefined);});
test('the action is wired, rights-listed for leaders only, and read-only',()=>{
 const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/clientSetupPipelineAction\(tx,a,p\)/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-action-rights.mjs'),/'clientpipeline'.*leaders.*edit:\[\]/);
 assert.doesNotMatch(rd('supabase/functions/staff-workspace-v12/client-setup-pipeline-actions.ts'),/insert into|update erp_private|delete from/i);
 assert.match(rd('staff-pilot.mjs'),/staff-setup-pipeline\.mjs\?v=/);});
