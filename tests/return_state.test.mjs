import test from 'node:test';import assert from 'node:assert/strict';
import {safeReturnHash,returnLabel,chooseReturn,createReturnStore} from '../staff-return-state.mjs';
import {workspaceRoute} from '../staff-task-workspace.mjs';
import {workspaceHeader,statusTone} from '../staff-workspace-header.mjs';
import {needsWorkspaceConfirmation,workspaceContext,workspaceRecordMatches,workspaceScopeHash} from '../staff-workspace-navigation.mjs';
const id='00000000-0000-4000-8000-000000000003';
test('returnTo is only ever one of the app\'s own routes, never another address',()=>{
 for(const good of ['#view=home','view=projects','#project='+id,'#client='+id,'#task='+id])assert.equal(safeReturnHash(good),good.startsWith('#')?good:'#'+good);
 for(const bad of ['https://evil.example/','//evil.example','javascript:alert(1)','#view=home&x=1','#project=../x','#project=','#view=Home','#unknown=1','#view=home%0d%0a','http://x/#view=home','','#'+'a'.repeat(200)])assert.equal(safeReturnHash(bad),'',String(bad));
 assert.equal(safeReturnHash(null),'');
});
test('workspaceRoute reads a valid returnTo and drops a bad one',()=>{
 assert.deepEqual(workspaceRoute('#task=abc&returnTo=project%3Dp1'),{view:'task',id:'abc',returnTo:'#project=p1'});
 assert.deepEqual(workspaceRoute('#task=abc&returnTo=https%3A%2F%2Fevil.example'),{view:'task',id:'abc'});
 assert.deepEqual(workspaceRoute('#client=c1'),{view:'clientfile',id:'c1'});
});
test('workspace switches distinguish linked records from firm-wide areas and other clients',()=>{
 const data={clients:[{client_id:'c1'},{client_id:'c2'}],projects:[{project_id:'p1',client_id:'c1'},{project_id:'p2',client_id:'c2'}],tasks:[{task_id:'t1',project_id:'p1'}]};
 const route=workspaceRoute;
 const scoped=route(workspaceScopeHash('documents',{kind:'project',id:'p1'}));
 assert.deepEqual(workspaceContext(scoped,data),{client:data.clients[0],project:data.projects[0]});
 assert.equal(needsWorkspaceConfirmation(route('#task=t1'),scoped,data),false);
 assert.equal(needsWorkspaceConfirmation(scoped,route('#client=c1'),data),false);
 assert.equal(needsWorkspaceConfirmation(scoped,route('#view=documents'),data),true);
 assert.equal(needsWorkspaceConfirmation(scoped,route('#project=p2'),data),true);
 assert.equal(needsWorkspaceConfirmation(route('#view=clients'),route('#view=home'),data),false);
 assert.equal(needsWorkspaceConfirmation(route('#view=clients'),route('#view=staff'),data),true);
 assert.equal(workspaceRecordMatches({task_id:'t1'},scoped.scope,data),true);
 assert.equal(workspaceRecordMatches({client_id:'c1'},scoped.scope,data),false);
 assert.equal(workspaceRecordMatches({project_id:'p2'},scoped.scope,data),false);
 assert.deepEqual(route('#view=finance&scope=project.bad/id'),{view:'finance',scope:null,scoped:true});
 assert.equal(workspaceContext(route('#view=finance&scope=project.missing'),data),null);
});
test('a list becomes the place to return to; detail to detail keeps the original place',()=>{
 assert.equal(chooseReturn({currentHash:'#project=p1',currentIsDetail:false,nextIsDetail:true}),'#project=p1');
 assert.equal(chooseReturn({currentHash:'',currentIsDetail:false,nextIsDetail:true}),'#view=home');
 assert.equal(chooseReturn({currentHash:'#task=t1',currentIsDetail:true,carried:'#view=home',nextIsDetail:true}),'#view=home');
 assert.equal(chooseReturn({currentHash:'#task=t1',currentIsDetail:true,carried:'https://evil.example',nextIsDetail:true}),'');
 assert.equal(chooseReturn({currentHash:'#view=home',currentIsDetail:false,nextIsDetail:false}),'');
 assert.match(returnLabel('#view=home'),/Home/);assert.match(returnLabel('#project=p1'),/project/);assert.match(returnLabel('#view=clients'),/clients/);
});
test('the saved list state survives a reload, is bounded, and tolerates broken storage',()=>{
 const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)},store=createReturnStore(storage,{max:3});
 for(let i=0;i<5;i++)assert.equal(store.save('#project=p'+i,{n:i}),true);
 assert.equal(store.peek('#project=p0'),null);assert.deepEqual(store.peek('#project=p4'),{n:4});
 assert.deepEqual(createReturnStore(storage,{max:3}).peek('#project=p4'),{n:4});
 assert.equal(store.save('https://evil.example',{}),false);
 assert.deepEqual(store.take('#project=p4'),{n:4});assert.equal(store.peek('#project=p4'),null);
 const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},b=createReturnStore(broken);assert.equal(b.save('#view=home',{a:1}),true);assert.equal(b.peek('#view=home'),null);
 assert.equal(createReturnStore({getItem:()=>'not json',setItem(){}}).peek('#view=home'),null);
});
test('the workspace header gives the trail and a written status, never colour alone',()=>{
 const h=workspaceHeader({client:'Chev <b>Energies',project:'FY2026 Audit',period:'Oct 2026',status:'Awaiting review',esc:x=>String(x).replace(/</g,'&lt;')});
 assert.match(h,/<header class="workspace-header" aria-label="Where you are working">/);assert.match(h,/Chev &lt;b>Energies/);assert.match(h,/Client: /);assert.match(h,/Period: /);assert.match(h,/Status: <\/span>Awaiting review/);assert.match(h,/tone-wait/);assert.match(h,/aria-hidden="true">●/);
 assert.equal(workspaceHeader({}),'');assert.equal(statusTone('Completed'),'good');assert.equal(statusTone('Blocked'),'bad');assert.equal(statusTone('Whatever'),'neutral');
 assert.doesNotMatch(workspaceHeader({client:'A',esc:x=>x}),/wh-status/);
});
