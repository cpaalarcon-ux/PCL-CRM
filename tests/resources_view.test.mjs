// Build 2796: Resources under Documents, one layout for the Settings cards, and the Home page without the reference card.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const dom=new JSDOM('<!doctype html><div id="x"></div>');globalThis.document=dom.window.document;
const {settingsCard}=await import('../staff-settings-cards.mjs');
const {resourcesView,createResourcesUI,TEMPLATES}=await import('../staff-resources.mjs');
const {moduleLinks}=await import('../staff-nav.mjs');

test('the Settings card layout: title, purpose, who it is for, and the button on the right; text is escaped',()=>{
 const html=settingsCard({id:'c1',title:'A <b>title</b>',purpose:'Why & what',audience:'Partners',actions:'<button>Open</button>'});
 document.querySelector('#x').innerHTML=html;const c=document.querySelector('section.settings-card#c1');
 assert.ok(c);assert.equal(c.querySelector('.section-head h2').textContent,'A <b>title</b>');assert.equal(c.querySelector('.settings-card-text p').textContent,'Why & what');
 assert.match(c.querySelector('.settings-audience').textContent,/^For: Partners$/);assert.equal(c.querySelector('.actions button').textContent,'Open');assert.equal(c.querySelectorAll('b').length,0);
 assert.match(settingsCard({title:'T'}),/For: Managers and Partners/,'the default audience');
});

test('every Settings card is drawn with the shared layout',()=>{
 for(const [f,id] of [['staff-deadlines.mjs','deadlineCard'],['staff-tax-roles.mjs','taxRoleCard'],['staff-starter-confirm.mjs','starterConfirmCard'],['staff-due-backlog.mjs','dueBacklogCard']]){
  const s=rd(f);assert.match(s,/import \{settingsCard\} from '\.\/staff-settings-cards\.mjs\?v=20261112-resources-v1'/,f);assert.match(s,new RegExp(`settingsCard\\(\\{id:'${id}'`),f);assert.doesNotMatch(s,/<section class="card[^"]*"[^>]*><div class="section-head"><h2>/,f+' has no hand-made card head left');
 }
 const suite=rd('staff-suite.mjs');for(const id of ['referenceCard','chartCard'])assert.match(suite,new RegExp(`settingsCard\\(\\{id:'${id}'`));
});

test('Resources: the chart search and both templates, for everyone; leaders are told where accounts are added',()=>{
 document.querySelector('#x').innerHTML=resourcesView(false);
 assert.ok(document.querySelector('[data-accounting="catalog"]'));assert.deepEqual([...document.querySelectorAll('a[download]')].map(a=>a.getAttribute('href')),TEMPLATES.map(t=>t.file));
 assert.match(document.body.textContent,/Managers and Partners add new accounts/);
 document.querySelector('#x').innerHTML=resourcesView(true);assert.match(document.body.textContent,/stay Draft until a Partner activates them/);
 assert.deepEqual(TEMPLATES.map(t=>t.file),['/Opening_TB_Upload_Template.xlsx','/Purchase_Upload_Template.xlsx']);
});

test('Resources opens as a window from the Documents menu and does nothing else',async()=>{
 let shown=null,me={category_code:'ASSISTANT'};const ui=createResourcesUI({modal:(t,h)=>{shown={t,h};},data:()=>({me})});
 assert.equal(await ui.handle('something-else'),false);assert.equal(shown,null);
 assert.equal(await ui.handle('resources-open'),true);assert.equal(shown.t,'Resources');assert.match(shown.h,/Managers and Partners add new accounts/);
 me={category_code:'PARTNER'};await ui.handle('resources-open');assert.match(shown.h,/Draft until a Partner activates/);
});

test('the Documents menu shows Resources to every role that can open Documents, and to no other',()=>{
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN'])assert.ok(moduleLinks({category_code:role},'documents').some(l=>l.suite==='resources-open'&&l.title==='Resources'),role);
 assert.ok(!moduleLinks({category_code:'ADMIN'},'documents').some(l=>l.suite==='resources-open'),'an Administrator has no Documents area');
 assert.ok(!moduleLinks({category_code:'ASSISTANT'},'documents',a=>a!=='documents').some(l=>l.suite==='resources-open'),'a person without the Documents area does not see it');
 assert.ok(moduleLinks({category_code:'ASSISTANT'},'documents').every(l=>l.title!=='Incoming review'),'the leaders-only link is still leaders-only');
});

test('Home no longer carries the reference card, and the wiring is in place',()=>{
 const dash=rd('staff-dashboard.mjs');assert.doesNotMatch(dash,/home-reference|QUICK REFERENCES|data-dashboard="account-catalog"/);assert.doesNotMatch(rd('staff-pilot.mjs'),/dashboard==='account-catalog'/);
 const suite=rd('staff-suite.mjs');assert.match(suite,/createResourcesUI\(ctx\)/);assert.match(suite,/resources\.handle\(action\)/);assert.match(suite,/staff-resources\.mjs\?v=20261112-resources-v1/);
 for(const f of ['staff-resources.mjs','staff-settings-cards.mjs'])assert.doesNotMatch(rd(f),/forensic|ISRS 4000/i);
 assert.match(rd('staff-pilot.mjs'),/staff-nav\.mjs\?v=20261112-resources-v1/);assert.match(rd('staff-pilot.mjs'),/staff-dashboard\.mjs\?v=20261112-resources-v1/);
 assert.equal(JSON.parse(rd('supabase/functions/staff-workspace-v12/release.json')).build,'2026-11-14.2797');assert.match(rd('staff-pilot.html'),/data-build="2026-11-14\.2797"/);
 assert.equal(rd('staff-settings-hub-rules.mjs'),rd('supabase/functions/staff-workspace-v12/settings-hub-rules.mjs'),'the two copies of the hub rules agree');
});
