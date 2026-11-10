// Step 9 and the 10 Nov follow-up (build 2680): links appear only for built modules and only for the roles that can open them.
// KRA notices, Forensic files and Audit files sit under Engagements & Delivery; the menu groups open and close and remember it; Incoming review carries a count.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MODULE_LINKS,NO_LINK_MODULES,GROUP_ENGAGEMENTS,moduleLinks,readOpen,writeOpen,openForView,badgeView,badgeHtml,rollupBadge,NAV_STORE_KEY} from '../staff-nav.mjs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const me=c=>({category_code:c});
test('built modules get one link under their parent, for the right roles',()=>{
  assert.deepEqual(moduleLinks(me('PARTNER'),'engagements').map(x=>x.key),['kra'],'Forensic files stay hidden until the database says this person may see the entry');
  assert.deepEqual(moduleLinks(me('PARTNER'),'engagements',()=>true,{forensic:true}).map(x=>x.key),['kra','forensic']);
  assert.deepEqual(moduleLinks(me('ASSISTANT'),'engagements',()=>true,{forensic:true}).map(x=>x.key),['kra','forensic']);
  assert.deepEqual(moduleLinks(me('ASSISTANT'),'engagements',()=>true,{forensic:false}).map(x=>x.key),['kra']);
  assert.deepEqual(moduleLinks(me('INTERN'),'engagements'),[]);
  assert.deepEqual(moduleLinks(me('ADMIN'),'engagements'),[]);
  for(const r of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'])assert.deepEqual(moduleLinks(me(r),'projects'),[],'Projects & Tasks holds no module links: it is the project and task manager');
  for(const parent of ['documents','communications']){
    for(const r of ['PARTNER','MANAGER','SUPERVISOR'])assert.equal(moduleLinks(me(r),parent).length,1,r+' '+parent);
    for(const r of ['ASSISTANT','INTERN','ADMIN'])assert.deepEqual(moduleLinks(me(r),parent),[],r+' '+parent);
  }
  assert.equal(moduleLinks(me('PARTNER'),'documents')[0].suite,'incoming-open');
  assert.equal(moduleLinks(me('PARTNER'),'communications')[0].suite,'incoming-timeline-pick');
  assert.equal(moduleLinks(me('PARTNER'),'engagements')[0].suite,'kra-open');assert.equal(moduleLinks(me('PARTNER'),'engagements',()=>true,{forensic:true})[1].suite,'forensic-open');
});
test('a link needs the area to be allowed',()=>{
  assert.deepEqual(moduleLinks(me('PARTNER'),'documents',a=>a!=='documents'),[]);
  assert.deepEqual(moduleLinks(me('PARTNER'),'engagements',a=>a!=='audit',{forensic:true}).map(x=>x.key),['kra'],'without the audit area a person keeps KRA notices but not Forensic files');
  assert.deepEqual(moduleLinks(me('PARTNER'),'engagements',a=>a!=='projects',{forensic:true}).map(x=>x.key),['forensic']);
});
test('Engagements & Delivery is a group with no page of its own',()=>{
  assert.deepEqual([GROUP_ENGAGEMENTS.key,GROUP_ENGAGEMENTS.title],['engagements','Engagements & Delivery']);
  assert.ok(MODULE_LINKS.filter(m=>m.parent==='engagements').length>=2);
  assert.ok(!MODULE_LINKS.some(m=>m.parent==='projects'),'nothing is filed under Projects & Tasks');
});
test('AUP has no list screen so no link; a module that is not built lists no roles',()=>{
  // Forensic files were not built at Step 9, so they had no link then. The forensic file is built now (see forensic_file_ui.test.mjs), so its link is checked there.
  // Anything that is not built must list no roles and so can never show a link.
  assert.deepEqual(NO_LINK_MODULES,['aup']);
  assert.ok(!MODULE_LINKS.some(m=>m.key==='aup'));
  assert.ok(!MODULE_LINKS.some(m=>!m.built&&m.roles.length),'an unbuilt module must not list roles');
});
test('every link points at an action its screen really handles',()=>{
  const kra=rd('staff-kra.mjs'),inc=rd('staff-incoming.mjs'),fo=rd('staff-forensic.mjs');
  assert.match(kra,/action==='kra-open'/);
  assert.match(inc,/action==='incoming-open'/);
  assert.match(inc,/action==='incoming-timeline-pick'/);
  for(const m of MODULE_LINKS.filter(x=>x.built))assert.ok(kra.includes(`'${m.action}'`)||inc.includes(`'${m.action}'`)||fo.includes(`'${m.action}'`),m.key);
});
test('the sidebar draws the links as sub-items that open the module, never as a page or a current page',()=>{
  const app=rd('staff-pilot.mjs');
  assert.match(app,/from '\.\/staff-nav\.mjs\?v=20261110-taxlead-v1'/);
  assert.match(app,/parent\('projects','Projects & Tasks','▣',modLinks\('projects'\)\)/);
  assert.match(app,/parent\('documents','Documents','▤',modLinks\('documents'\)\)/);
  assert.match(app,/parent\('communications','Communications Hub','◉',modLinks\('communications'\)\)/);
  assert.match(app,/subs=\[audit,\.\.\.modLinks\('engagements'\)\]\.filter\(Boolean\)/,'Audit files, KRA notices and Forensic files are the links under Engagements & Delivery');
  assert.match(app,/item\.suite\?`<button class="side-item side-sub side-module" type="button" data-suite="\$\{item\.suite\}"/);
  assert.match(rd('staff-pilot.html'),/data-build="2026-11-10\.2760"/);
});
test('the order matches the agreed list: Engagements & Delivery follows Communications and precedes Finance & Reports',()=>{
  const app=rd('staff-pilot.mjs');
  assert.match(app,/parent\('communications','Communications Hub','◉',modLinks\('communications'\)\),engagements,leaf\('finance','Finance & Reports','£'\),admin\]/);
});
test('the menu keeps the same top-level items',()=>{
  const app=rd('staff-pilot.mjs');
  assert.match(app,/sideItems=\[\{view:'home',title:'Home',icon:'⌂',subs:\[\]\}/);
  for(const t of ["'Clients'","'Projects & Tasks'","'Time & Attendance'","'Documents'","'Communications Hub'","'Finance & Reports'","'Administration'"])assert.ok(app.includes(t),t);
  assert.ok(app.includes('GROUP_ENGAGEMENTS.title')||app.includes("'Engagements & Delivery'"));
});

// ---- Open and closed groups ----
const mem=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v),dump:()=>m};};
test('groups start closed; the group holding the page opens by itself; the choice is remembered per person',()=>{
  const items=[{view:'home',subs:[]},{view:'clients',subs:[{view:'leads'}]},{view:'documents',subs:[{suite:'incoming-open'}]},{key:'engagements',view:'engagements',group:true,subs:[{view:'audit'}]}];
  const active=it=>it.view==='audit';
  assert.deepEqual([...openForView(new Set(),items,()=>false)],[],'nothing opens on Home');
  assert.deepEqual([...openForView(new Set(),items,active)],['engagements'],'viewing Audit files opens Engagements & Delivery');
  assert.deepEqual([...openForView(new Set(['documents']),items,active)].sort(),['documents','engagements'],'a group the person opened stays open');
  const st=mem();
  writeOpen(st,'staff-1',new Set(['documents']));
  assert.deepEqual([...readOpen(st,'staff-1')],['documents']);
  assert.deepEqual([...readOpen(st,'staff-2')],[],'another person on the same browser has their own menu');
  assert.ok([...st.dump().keys()].every(k=>k.startsWith(NAV_STORE_KEY+':')));
});
test('a blocked, empty or damaged store never breaks the menu',()=>{
  const bad={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  assert.deepEqual([...readOpen(bad,'x')],[]);assert.doesNotThrow(()=>writeOpen(bad,'x',new Set(['a'])));
  for(const raw of ['{not json','{"a":1}','[1,2,{"x":1}]',''])assert.deepEqual([...readOpen({getItem:()=>raw},'x')],[],raw);
  assert.deepEqual([...readOpen({getItem:()=>JSON.stringify(['ok',5,'x'.repeat(80)])},'x')],['ok'],'only short text keys are kept');
  assert.deepEqual([...readOpen(null,'x')],[]);
});
test('the toggle is wired: a chevron for pages, the label for the group, state saved, focus kept',()=>{
  const app=rd('staff-pilot.mjs');
  assert.match(app,/class="side-chevron" type="button" data-nav-toggle="\$\{k\}" aria-expanded="\$\{open\}" aria-controls="side-sub-\$\{k\}"/);
  assert.match(app,/data-nav-toggle="\$\{k\}" aria-expanded="\$\{open\}" aria-controls="side-sub-\$\{k\}"><span class="side-icon"/,'the group label toggles itself');
  assert.match(app,/id="side-sub-\$\{k\}"\$\{open\?'':' hidden'\}/,'closed links are hidden, not just collapsed');
  assert.match(app,/if\(b\?\.dataset\.navToggle\)\{toggleNavGroup\(b\.dataset\.navToggle\);return;\}/);
  assert.match(app,/writeOpen\(globalThis\.localStorage,data\.me\.staff_id,navOpen\);nav\(\);/);
  assert.match(app,/\?\.focus\(\)/,'focus returns to the toggle after the menu repaints');
  assert.match(app,/navBadges=\{\};navOpenFor='';navBadgeAt=0;/,'signing out clears the count and the remembered menu');
});

// ---- Count badge ----
test('the badge hides at zero, caps at 99+, is grey, and red only when something is overdue',()=>{
  assert.equal(badgeView(0,0),null);assert.equal(badgeView(undefined,5),null);assert.equal(badgeView('x',1),null);assert.equal(badgeView(-4,0),null);
  assert.deepEqual(badgeView(7,0),{text:'7',overdue:false,label:'7 waiting'});
  assert.deepEqual(badgeView(99,0).text,'99');assert.equal(badgeView(100,0).text,'99+');assert.equal(badgeView(5000,2).text,'99+');
  assert.deepEqual(badgeView(12,3),{text:'12',overdue:true,label:'12 waiting, 3 overdue'});
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  assert.equal(badgeHtml(null,esc),'');
  assert.match(badgeHtml(badgeView(7,0),esc),/^<span class="nav-badge" role="img" aria-label="7 waiting"/);
  assert.match(badgeHtml(badgeView(7,1),esc),/^<span class="nav-badge overdue"/);
});
test('a closed group shows the total of the counts under it, so a waiting file is never hidden',()=>{
  const subs=[{badge:'incoming'},{title:'no badge'}];
  assert.deepEqual(rollupBadge(subs,{incoming:{waiting:4,overdue:0}}),badgeView(4,0));
  assert.equal(rollupBadge(subs,{incoming:{waiting:0,overdue:0}}),null);assert.equal(rollupBadge(subs,{}),null);assert.equal(rollupBadge([],{incoming:{waiting:3}}),null);
  const app=rd('staff-pilot.mjs');
  assert.match(app,/roll=open\?'':badgeHtml\(rollupBadge\(item\.subs,navBadges\),esc\)/,'the roll-up shows only while the group is closed');
});
test('the count comes from the database, only for people whose menu shows the link, and refreshes after a change',()=>{
  const app=rd('staff-pilot.mjs'),act=rd('supabase/functions/staff-workspace-v12/incoming-actions.ts');
  assert.match(app,/if\(!moduleLinks\(data\.me,'documents',canArea\)\.some\(x=>x\.badge==='incoming'\)\)return;/);
  assert.match(app,/request\(\{action:'incoming_badge'\}\)/);
  assert.match(app,/Date\.now\(\)-navBadgeAt<45000/,'at most one count request every 45 seconds unless something changed');
  assert.match(app,/incoming_\(accept\|archive\|kyc_approve\|choose_client\|set_handling\)/);
  assert.match(act,/'incoming_badge'\]/);assert.match(act,/erp_private\.incoming_badge\(\)/);
  assert.ok(MODULE_LINKS.find(m=>m.key==='incoming').badge==='incoming');
});

// ---- Phone drawer ----
test('under 768px the menu is a drawer opened by a hamburger, closed by the backdrop, a link or Escape',()=>{
  const html=rd('staff-pilot.html'),css=rd('staff-pilot.css'),app=rd('staff-pilot.mjs');
  assert.match(html,/<button id="navToggle" class="nav-hamburger" type="button" aria-label="Open the menu" aria-controls="workspaceSidebar" aria-expanded="false">/);
  assert.match(html,/<div id="navBackdrop" class="nav-backdrop" aria-hidden="true"><\/div><aside id="workspaceSidebar"/);
  assert.match(css,/@media\(max-width:768px\)\{\s*\.nav-hamburger\{display:inline-flex\}\s*\.workspace-sidebar\{position:fixed[^}]*visibility:hidden;transform:translateX\(-102%\)/);
  assert.match(css,/body\.nav-open \.workspace-sidebar\{visibility:visible;transform:none/);
  assert.match(css,/\.nav-hamburger\{display:none/,'the hamburger is hidden on wider screens');
  assert.match(css,/prefers-reduced-motion:reduce\)\{\.workspace-sidebar\{transition:none!important\}/);
  assert.match(app,/\$\('#navToggle'\)\?\.addEventListener\('click'/);assert.match(app,/\$\('#navBackdrop'\)\?\.addEventListener\('click',\(\)=>setNavDrawer\(false\)\)/);
  assert.match(app,/e\.key==='Escape'&&document\.body\.classList\.contains\('nav-open'\)/);
  assert.match(app,/if\(b&&b\.closest\('#sideNav'\)\)setNavDrawer\(false\)/);
  assert.match(app,/matchMedia\?\.\('\(min-width:769px\)'\)/,'widening the window closes the drawer');
});
