import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {retireFields,versionChanges,planVersion,retireGate,proposeGate,MAX_BATCH} from '../supabase/functions/staff-workspace-v12/practice-rules.mjs';
import {parseChanges,taskKeyHints,categoriesHtml,resultsHtml} from '../staff-service-categories.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const PT={staff_id:'p',category_code:'PARTNER'},MG={staff_id:'m',category_code:'MANAGER'},AS={staff_id:'a',category_code:'ASSISTANT'};

test('retire: one reason of 5 to 500 characters, a Partner only, never a retired one',()=>{
 for(const bad of ['','abc','x'.repeat(501),undefined])assert.match(retireFields({reason:bad}).problem,/5 to 500/);
 assert.deepEqual(retireFields({reason:'  Replaced   by the 2027 list '}).values,{reason:'Replaced by the 2027 list'});
 assert.equal(retireGate({status:'Approved'},PT).ok,true);assert.equal(retireGate({status:'Draft'},PT).ok,true);
 assert.match(retireGate({status:'Approved'},MG).problem,/Partner retires/);assert.match(retireGate({status:'Retired'},PT).problem,/already retired/);
 assert.equal(MAX_BATCH,50);
});

test('new version: the common changes are read strictly and need at least one change',()=>{
 assert.match(versionChanges({}).problem,/Say what changes/);
 assert.match(versionChanges({drop_task_keys:['Bad Key']}).problem,/not a task key/);
 assert.match(versionChanges({due_days:{file_return:367}}).problem,/0 to 366/);assert.match(versionChanges({due_days:{file_return:'x'}}).problem,/0 to 366/);assert.match(versionChanges({due_days:{file_return:1.5}}).problem,/0 to 366/);
 assert.match(versionChanges({mandatory:{review_pack:'no'}}).problem,/required or optional/);
 assert.match(versionChanges({drop_task_keys:['a_b'],due_days:{a_b:3}}).problem,/both removed and changed/);
 assert.match(versionChanges({name_suffix:'x'.repeat(61)}).problem,/60 characters/);
 const ok=versionChanges({drop_task_keys:[' a_b ','a_b'],due_days:{file_return:'7'},mandatory:{review_pack:false},name_suffix:' (2027) '});
 assert.deepEqual(ok.changes,{drop:['a_b'],due:{file_return:7},mandatory:{review_pack:false},suffix:'(2027)'});
 assert.ok(versionChanges({name_suffix:'(2027)'}).changes,'a name addition alone is a change');
});

test('new version: applied only where the task exists, and a category nothing applies to is skipped',()=>{
 const c=versionChanges({drop_task_keys:['gone','absent'],due_days:{file_return:7,absent2:1},name_suffix:'(2027)'}).changes;
 const a=planVersion(['gone','file_return','keep'],'Tax monthly',c);
 assert.deepEqual(a.drop,['gone']);assert.deepEqual(a.due,{file_return:7});assert.equal(a.name,'Tax monthly (2027)');assert.deepEqual(a.left.sort(),['absent','absent2']);assert.equal(a.applies,3);
 const b=planVersion(['keep'],'Tax monthly (2027)',c);assert.match(b.problem,/None of the changes applies/);assert.deepEqual(b.left.sort(),['absent','absent2','file_return','gone']);
 assert.equal(planVersion(['x_y'],'N (2027)',versionChanges({name_suffix:'(2027)',drop_task_keys:['x_y']}).changes).name,null,'the name is not extended twice');
});

test('new version: needs an approved category with no draft waiting',()=>{
 assert.equal(proposeGate({status:'Approved'},MG,false).ok,true);assert.equal(proposeGate({status:'Approved'},PT,false).ok,true);
 assert.match(proposeGate({status:'Approved'},AS,false).problem,/Partner or a Manager/);
 assert.match(proposeGate({status:'Approved'},MG,true).problem,/already waiting/);
 assert.match(proposeGate({status:'Draft'},MG,false).problem,/draft already/);assert.match(proposeGate({status:'Retired'},MG,false).problem,/retired/);
});

test('the form text boxes read into structured changes, and say which line cannot be read',()=>{
 assert.deepEqual(parseChanges({drop:'a_b, c_d\ne_f',due:'file_return=7; review:3',required:'review_pack=optional, pay=Required',suffix:' (2027) '}).values,
  {drop_task_keys:['a_b','c_d','e_f'],due_days:{file_return:7,review:3},mandatory:{review_pack:false,pay:true},name_suffix:'(2027)'});
 assert.match(parseChanges({due:'file_return'}).problem,/file_return=7/);assert.match(parseChanges({due:'File=7'}).problem,/should read like/);assert.match(parseChanges({required:"x_y=maybe"}).problem,/required or optional/i);
 assert.deepEqual(parseChanges({}).values,{drop_task_keys:[],due_days:{},mandatory:{},name_suffix:''});
 const t=[{template_id:'1',task_list:[{task_key:'a_b',task_name:'A'},{task_key:'c_d',task_name:'C'}]},{template_id:'2',task_list:[{task_key:'a_b',task_name:'A'}]},{template_id:'3',task_list:[{task_key:'z_z',task_name:'Z'}]}];
 const h=taskKeyHints(t,['1','2']);assert.equal(h.ticked,2);assert.deepEqual(h.keys.map(k=>[k.task_key,k.count]),[['a_b',2],['c_d',1]]);assert.deepEqual(taskKeyHints(t,[]).keys,[]);
});

test('the form: every category can be ticked, the new-version box is shown, retire only to a Partner, results carry notes',()=>{
 const t=o=>({template_id:'t1',template_code:'TAX',version:1,name:'Tax <x>',service_group:'Tax Compliance',source:'Staff',status:'Approved',tasks:3,services:'TAX',waiting:false,task_list:[],can_propose:true,can_retire:true,...o});
 const c=categoriesHtml({sole:false,can_retire:true,templates:[t({}),t({template_id:'t2',template_code:'ACC',can_propose:false,propose_problem:'A draft of this category is already waiting for approval. Approve or retire it first.'})]});
 assert.equal((c.match(/data-sc-pick/g)||[]).length,2);assert.match(c,/data-propose="1"/);assert.match(c,/data-propose="0"/);assert.match(c,/id="scVersion"/);assert.match(c,/id="scRetire"/);assert.match(c,/data-sc="check-propose"/);assert.match(c,/data-sc="check-retire"/);assert.match(c,/already waiting for approval/);assert.doesNotMatch(c,/<x>/);
 const m=categoriesHtml({sole:false,can_retire:false,templates:[t({})]});assert.doesNotMatch(m,/id="scRetire"|check-retire/,'a Manager does not see the retire box');assert.match(m,/id="scVersion"/);
 const r=resultsHtml({dry:false,kind:'propose',summary:{total:2,done:1,skipped:1},results:[{label:'A',outcome:'Proposed',version:2,note:'2 changes. Not in this category, left alone: <k>.'},{label:'B',outcome:'Skipped',reason:'None of the changes applies to this category.'}]});
 assert.match(r,/proposed as a new version/);assert.match(r,/New version 2, a draft waiting for approval/);assert.doesNotMatch(r,/<k>/);assert.match(r,/None of the changes applies/);
 assert.match(resultsHtml({dry:true,kind:'propose',summary:{total:1,done:1,skipped:0},results:[{label:'A',outcome:'Ready',version:2}]}),/Would be version 2, a draft for a different person to approve/);
 assert.match(resultsHtml({dry:true,kind:'retire',summary:{total:1,done:1,skipped:0},results:[{label:'A',outcome:'Ready',note:'No approved version of this category will remain.'}]}),/ready to be retired[\s\S]*No approved version/);
});

test('wiring: new actions in the server file, existing single actions reused, nothing approved by a bulk propose, build label',()=>{
 const act=rd(fx+'practice-template-actions.ts');
 assert.match(act,/'service_category_retire','service_category_propose'/);assert.match(act,/service_template_retire/);assert.match(act,/service_template_propose/);
 assert.match(act,/A Partner retires service categories/);assert.doesNotMatch(act.replace(/\/\/[^\n]*/g,''),/update erp_private\.|delete from|insert into erp_private\.service_templates/i,'only the existing single actions write');
 assert.match(rd(fx+'staff-access-control.mjs'),/service_template_\|service_category_\|/,'routed by the existing prefix');
 assert.match(rd('staff-service-categories.mjs'),/service_category_retire/);
 assert.match(rd(fx+'release.json'),/2026-11-14\.2880/);assert.match(rd('staff-pilot.html'),/data-build="2026-11-14\.2880"/);
});
