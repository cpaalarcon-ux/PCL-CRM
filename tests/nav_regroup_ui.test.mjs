// Step 9: the one menu regroup. Links appear only for built modules and only for the roles that can open them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULE_LINKS,NO_LINK_MODULES,moduleLinks} from '../staff-nav.mjs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const me=c=>({category_code:c});
test('built modules get one link under their parent, for the right roles',()=>{
  assert.deepEqual(moduleLinks(me('PARTNER'),'projects').map(x=>x.key),['kra']);
  assert.deepEqual(moduleLinks(me('ASSISTANT'),'projects').map(x=>x.key),['kra']);
  assert.deepEqual(moduleLinks(me('INTERN'),'projects'),[]);
  assert.deepEqual(moduleLinks(me('ADMIN'),'projects'),[]);
  for(const parent of ['documents','communications']){
    for(const r of ['PARTNER','MANAGER','SUPERVISOR'])assert.equal(moduleLinks(me(r),parent).length,1,r+' '+parent);
    for(const r of ['ASSISTANT','INTERN','ADMIN'])assert.deepEqual(moduleLinks(me(r),parent),[],r+' '+parent);
  }
  assert.equal(moduleLinks(me('PARTNER'),'documents')[0].suite,'incoming-open');
  assert.equal(moduleLinks(me('PARTNER'),'communications')[0].suite,'incoming-timeline-pick');
  assert.equal(moduleLinks(me('PARTNER'),'projects')[0].suite,'kra-open');
});
test('a link needs the area to be allowed',()=>{
  assert.deepEqual(moduleLinks(me('PARTNER'),'documents',a=>a!=='documents'),[]);
});
test('a module that is not built has no link for anyone; AUP has no list screen so no link',()=>{
  const forensic=MODULE_LINKS.find(m=>m.key==='forensic');
  assert.equal(forensic.built,false);
  for(const r of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN','ADMIN'])assert.deepEqual(moduleLinks(me(r),'projects').filter(x=>x.key==='forensic'),[],r);
  assert.deepEqual(NO_LINK_MODULES,['aup']);
  assert.ok(!MODULE_LINKS.some(m=>m.key==='aup'));
  assert.ok(!MODULE_LINKS.some(m=>!m.built&&m.roles.length),'an unbuilt module must not list roles');
});
test('every link points at an action its screen really handles',()=>{
  const kra=rd('staff-kra.mjs'),inc=rd('staff-incoming.mjs');
  assert.match(kra,/action==='kra-open'/);
  assert.match(inc,/action==='incoming-open'/);
  assert.match(inc,/action==='incoming-timeline-pick'/);
  for(const m of MODULE_LINKS.filter(x=>x.built))assert.ok(kra.includes(`'${m.action}'`)||inc.includes(`'${m.action}'`),m.key);
});
test('the sidebar draws the links as sub-items that open the module, never as a page or a current page',()=>{
  const app=rd('staff-pilot.mjs');
  assert.match(app,/import \{moduleLinks\} from '\.\/staff-nav\.mjs\?v=20261110-nav-v1'/);
  assert.match(app,/parent\('projects','Projects & Tasks','▣',\[audit,\.\.\.modLinks\('projects'\)\]\)/);
  assert.match(app,/parent\('documents','Documents','▤',modLinks\('documents'\)\)/);
  assert.match(app,/parent\('communications','Communications Hub','◉',modLinks\('communications'\)\)/);
  assert.match(app,/item\.suite\?`<button class="side-item side-sub side-module" type="button" data-suite="\$\{item\.suite\}"/);
  assert.doesNotMatch(app,/forensic/i);
  assert.match(rd('staff-pilot.html'),/data-build="2026-11-10\.2660"/);
});
test('the menu keeps the same top-level items',()=>{
  const app=rd('staff-pilot.mjs');
  assert.match(app,/sideItems=\[\{view:'home',title:'Home',icon:'⌂',subs:\[\]\}/);
  for(const t of ["'Clients'","'Projects & Tasks'","'Time & Attendance'","'Documents'","'Communications Hub'","'Finance & Reports'","'Administration'"])assert.ok(app.includes(t),t);
});
