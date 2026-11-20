import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadChoices} from '../staff-pilot-upload.mjs';
import {documentObjectKey,assertDocumentLinks,fileType} from '../supabase/functions/staff-pilot/validation.mjs';

const data={
 me:{staff_id:'assistant',category_code:'PARTNER'},
 clients:[{client_id:'client-a'},{client_id:'client-b'}],
 firms:[{firm_id:'firm-a'},{firm_id:'firm-b'}],
 client_firms:[{client_id:'client-a',firm_id:'firm-a'},{client_id:'client-a',firm_id:'firm-b'},{client_id:'client-b',firm_id:'firm-b'}],
 projects:[
  {project_id:'a',client_id:'client-a',handling_firm_id:'firm-a',status:'Draft'},
  {project_id:'a-other-firm',client_id:'client-a',handling_firm_id:'firm-b',status:'Draft'},
  {project_id:'b',client_id:'client-b',handling_firm_id:'firm-b',status:'Draft'},
  {project_id:'archived',client_id:'client-a',handling_firm_id:'firm-a',status:'Archived'}
 ],
 tasks:[{task_id:'a-mine',project_id:'a',assigned_to:'assistant'},{task_id:'a-team',project_id:'a',assigned_to:'other'},{task_id:'b-task',project_id:'b',assigned_to:'assistant'}]
};
const selected={client_id:'client-a',firm_id:'firm-a',project_id:'a',task_id:'a-mine'};
test('client, firm and project constrain upload choices independently',()=>{
 const choices=uploadChoices(data,selected);
 assert.deepEqual(choices.projects.map(p=>p.project_id),['a']);
 assert.deepEqual(choices.tasks.map(t=>t.task_id),['a-mine','a-team']);
 const changed=uploadChoices(data,{...selected,client_id:'client-b'});
 assert.deepEqual(changed.firms.map(f=>f.firm_id),['firm-b']);
 assert.deepEqual(changed.projects,[]);assert.deepEqual(changed.tasks,[]);
 assert.deepEqual(uploadChoices(data,{...selected,project_id:'b'}).tasks,[]);
});
test('Assistants can choose only their own tasks',()=>{
 const choices=uploadChoices({...data,me:{staff_id:'assistant',category_code:'ASSISTANT'}},selected);
 assert.deepEqual(choices.tasks.map(t=>t.task_id),['a-mine']);
});
test('a linked client without projects still has its firm and no unrelated tasks',()=>{
 const choices=uploadChoices({...data,projects:[]},selected);
 assert.equal(choices.firms.length,2);assert.deepEqual(choices.projects,[]);assert.deepEqual(choices.tasks,[]);
});
test('storage keys depend on validated IDs and MIME, never original names',()=>{
 const ids=['12345678-1234-4234-8234-123456789001','12345678-1234-4234-8234-123456789002','12345678-1234-4234-8234-123456789003'];
 const bytes=new Uint8Array([80,75,3,4,0]);
 const normal=documentObjectKey(...ids,fileType('working-paper.xlsx',bytes));
 const unicode=documentObjectKey(...ids,fileType('Client report — Formula Repair (新版).XLSX',bytes));
 assert.equal(normal,unicode);assert.match(normal,/^[a-z0-9/.-]+\.xlsx$/);
 assert.throws(()=>documentObjectKey('../bad',ids[1],ids[2],'application/pdf'));
 assert.throws(()=>documentObjectKey(...ids,'text/html'));
});
test('server permits consistent links and a client-level document',()=>{
 assert.doesNotThrow(()=>assertDocumentLinks(selected,data.projects[0],data.tasks[0]));
 assert.doesNotThrow(()=>assertDocumentLinks({...selected,project_id:null,task_id:null},null,null));
});
test('server rejects mismatched client, firm, task and missing project links',()=>{
 for(const selection of [{...selected,client_id:'client-b'},{...selected,firm_id:'firm-b'},{...selected,task_id:'b-task'}])
  assert.throws(()=>assertDocumentLinks(selection,data.projects[0],data.tasks[0]),e=>e.status===400);
 assert.throws(()=>assertDocumentLinks({...selected,project_id:null},null,data.tasks[0]),e=>e.status===400);
 assert.throws(()=>assertDocumentLinks(selected,null,null),e=>e.status===403);
 assert.throws(()=>assertDocumentLinks(selected,data.projects[0],null),e=>e.status===403);
 assert.throws(()=>assertDocumentLinks(selected,{...data.projects[0],status:'Archived'},data.tasks[0]),e=>e.status===400);
});
