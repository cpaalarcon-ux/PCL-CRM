import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {foldHeader,trailTitle,barHeight,watchStickyBar}=await import('../staff-sticky-bar.mjs');
const {workspaceHeader}=await import('../staff-workspace-header.mjs');
const rd=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page=body=>{const d=new JSDOM('<!doctype html><main><div id="content">'+body+'</div></main>');return d.window;};
const bar='<div class="detail-return"><button type="button" data-return-back="1">Back to the project</button></div>';
const head=(o={})=>workspaceHeader({client:'Fictional client',project:'Fictional VAT Project',period:'Monthly · 2026-10-01',status:'Awaiting review',esc,...o});

test('the header is folded into the Back bar so there is one sticky container and Back stays the first control',()=>{
 const w=page(bar+head()+'<section>body</section>'),root=w.document.querySelector('#content');
 assert.equal(foldHeader(root),true);
 const b=root.querySelector('.detail-return');
 assert.ok(b.querySelector('.workspace-header'),'the header is inside the bar');
 assert.equal(root.querySelectorAll('.workspace-header').length,1,'only one header exists');
 assert.equal(b.firstElementChild.tagName,'BUTTON');assert.equal(b.querySelectorAll('button').length,1,'Back is still the only button');
 assert.match(b.querySelector('.status-badge').textContent,/Awaiting review/,'the status keeps its text');
 assert.ok(b.querySelector('.status-badge [aria-hidden=true]'),'and its symbol');
 assert.equal(foldHeader(root),false,'folding again changes nothing');
});
test('the full trail is available as a title when it is shortened on a narrow screen',()=>{
 const w=page(bar+head()),root=w.document.querySelector('#content');foldHeader(root);
 const trail=root.querySelector('.wh-trail');
 assert.equal(trail.title,'Client: Fictional client › Project: Fictional VAT Project › Period: Monthly · 2026-10-01');
 assert.equal(trailTitle(root.querySelector('.workspace-header')),trail.title);
});
test('an Intern still does not see the client name',()=>{
 const w=page(bar+head({client:''})),root=w.document.querySelector('#content');foldHeader(root);
 assert.doesNotMatch(root.querySelector('.detail-return').textContent,/Fictional client/);
 assert.match(root.querySelector('.wh-trail').title,/^Project: Fictional VAT Project/);
});
test('a screen that redraws its header replaces the old one in the bar, never stacking two',async()=>{
 const w=page(bar+'<div class="project-banner">'+head()+'</div>'),root=w.document.querySelector('#content');
 const stop=watchStickyBar(root);
 assert.ok(root.querySelector('.detail-return .workspace-header'),'folded at start');
 root.querySelector('.project-banner').innerHTML=head({period:'Monthly · 2026-09-01'});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(root.querySelectorAll('.workspace-header').length,1);
 assert.match(root.querySelector('.detail-return .wh-trail').title,/2026-09-01/);
 assert.match(w.document.documentElement.style.getPropertyValue('--detail-bar-h'),/^\d+px$/);
 stop();
});
test('a screen without the Back bar keeps its own header in place',()=>{
 const w=page(head()),root=w.document.querySelector('#content');
 assert.equal(foldHeader(root),false);assert.ok(root.querySelector('.workspace-header'));
 assert.equal(barHeight(root),0);
});
test('the css pins one bar, wraps on a phone, truncates the trail and keeps focus out from under it',async()=>{
 const css=await rd('staff-pilot.css');
 assert.match(css,/\.detail-return\{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-start;flex-wrap:wrap;/);
 assert.match(css,/\.detail-return \.workspace-header\{[^}]*position:static/);
 assert.match(css,/\.detail-return \.wh-trail\{[^}]*text-overflow:ellipsis/);
 assert.match(css,/html\{scroll-padding-top:calc\(var\(--detail-bar-h,0px\) \+ \.5rem\)\}/);
 assert.match(css,/#content :is\(input,select,textarea,button,a,summary,\[tabindex\]\):focus\{scroll-margin-block-start:max\(4\.5rem,calc\(var\(--detail-bar-h,0px\) \+ \.75rem\)\)\}/);
 const sticky=[...css.matchAll(/([^{}]+)\{[^}]*position:sticky;top:0[^}]*\}/g)].map(m=>m[1].trim()).filter(s=>/workspace-header|detail-return/.test(s));
 assert.deepEqual(sticky,['.detail-return'],'only the Back bar is sticky at the top; the header is not a second sticky element');
 assert.match(css,/#editor\{scroll-padding-block:4\.5rem 5rem\}/,'dialogs keep their own padding for the pinned Save');
});
test('the bar is wired in with fresh cache tokens',async()=>{
 const pilot=await rd('staff-pilot.mjs'),html=await rd('staff-pilot.html'),auth=await rd('staff-pilot-auth.js');
 assert.match(pilot,/staff-sticky-bar\.mjs\?v=20261119-sticky-v1/);assert.match(pilot,/watchStickyBar\(\$\('#content'\)\)/);
 assert.match(html,/staff-pilot\.css\?v=20261119-queue-v1&amp;rev=20261119-(?:sticky|2905)/);assert.match(html,/staff-pilot-auth\.js\?v=20261109-cf-v1&amp;rev=20261119-(?:sticky|2905)/);
 assert.match(auth,/staff-pilot\.mjs\?v=20261114-setupguide-v1&rev=20261119-(?:sticky|2905)/);
});
