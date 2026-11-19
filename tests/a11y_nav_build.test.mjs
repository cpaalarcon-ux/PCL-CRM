import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
// Static audit of the staff screens: a form control must be named by a wrapping label, a label-for, or aria-label/labelledby.
function unlabelled(src){
 const out=[],re=/<(input|select|textarea)\b([^>]*)>/gi;let m;
 while((m=re.exec(src))){
  const attrs=m[2];
  if(/type\s*=\s*["']?(hidden|submit|button|reset|image)/i.test(attrs)||/\saria-label(ledby)?\s*=/i.test(' '+attrs))continue;
  const before=src.slice(Math.max(0,m.index-1500),m.index);if(before.lastIndexOf('<label')>before.lastIndexOf('</label>'))continue;
  if(/\$\{common\}|\$\{name\}/.test(attrs)||/\.replace\(\s*['"`]$/.test(src.slice(Math.max(0,m.index-14),m.index)))continue; // helper-built controls: labelled by the helper that wraps them
  const id=/\sid\s*=\s*["']([^"']+)["']/.exec(attrs);if(id){const key=id[1].replace(/\$\{[^}]*\}/g,'');if(key&&src.includes('for="'+id[1]+'"'))continue;if(key&&new RegExp('for="'+key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(src))continue;}
  out.push(m[0].slice(0,90));
 }
 return out;
}
test('table-cell and inline controls added or fixed in build 2903 carry accessible names',()=>{
 const must={
  'staff-ppe.mjs':['bf_class_','bf_use_','bf_tax_','bf_acc_','add_class_','add_use_'],
  'staff-schedules.mjs':['c_${i}','d_${i}','a_${i}','r_${i}','m_${i}'],
  'staff-partner-equity.mjs':['${f[0]}_${i}'],
  'staff-obligation-check.mjs':['data-ob-note','data-ob-reason'],
  'staff-audit-sacco.mjs':['data-sacco-map'],'staff-bulk-setup.mjs':['data-bulk-firm'],'staff-ledger.mjs':['data-opening-target'],'staff-setup-review.mjs':['data-return-note'],'staff-client-lifecycle.mjs':['name="${field}"']
 };
 for(const [f,keys] of Object.entries(must)){const src=rd(f);for(const k of keys){assert.ok(src.includes(k),f+' '+k);const esc=k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');assert.match(src,new RegExp('<(?:input|select)[^>]*(?:aria-label=[^>]*'+esc+'|'+esc+'[^>]*aria-label=)'),f+' '+k+' has aria-label');}}
});
test('no staff screen has an unlabelled input, select or textarea',()=>{
 const bad={};for(const f of fs.readdirSync(new URL('..',import.meta.url)).filter(x=>/^staff-.*\.mjs$/.test(x))){const r=unlabelled(rd(f));if(r.length)bad[f]=r;}
 assert.deepEqual(bad,{});
});
test('every error message region announces itself to a screen reader',()=>{
 const missing=[];for(const f of fs.readdirSync(new URL('..',import.meta.url)).filter(x=>/^staff-.*\.mjs$/.test(x))){for(const m of rd(f).matchAll(/<(?:p|div|span)\s[^>]*class="[^"]*\berror\b[^"]*"[^>]*>/g))if(!/role=|aria-live/.test(m[0]))missing.push(f+': '+m[0].slice(0,80));}
 assert.deepEqual(missing,[]);
 assert.match(rd('staff-pilot.html'),/id="notice" role="status" aria-live="polite"/);
});
test('pinned actions never hide the field being typed in, and controls meet the 24px target size',()=>{
 const css=rd('staff-pilot.css'),html=rd('staff-pilot.html');
 assert.match(html,/name="viewport" content="[^"]*interactive-widget=resizes-content/);
 assert.match(css,/#editor\{scroll-padding-block:4\.5rem 5rem\}/);
 assert.match(css,/input\[type=checkbox\],input\[type=radio\]\{inline-size:1\.5rem;block-size:1\.5rem/);
 assert.match(css,/button,\[role=button\],select,summary\{min-height:24px;min-width:24px\}/);
 assert.match(css,/\.status-badge\.tone-good\{color:#176635/);
});
test('the header and Back wiring is in the right screens and the cache tokens changed with them',()=>{
 const pilot=rd('staff-pilot.mjs'),v6=rd('staff-workspace-v6.mjs');
 assert.match(rd('staff-client-profile.mjs'),/workspaceHeader\(\{client:c\.company_name/);assert.match(v6,/workspaceHeader\(\{client:clientName\(p\.client_id\)/);assert.match(rd('staff-task-workspace.mjs'),/workspaceHeader\(\{client:!intern/);
 assert.match(pilot,/data-return-back="1"/);assert.match(pilot,/if\(b\.dataset\.returnBack\)\{goBack\(\);return;\}/);
 assert.match(pilot,/staff-return-state\.mjs\?v=20261119-nav-v1/);assert.match(pilot,/staff-task-workspace\.mjs\?v=20261119-nav-v1/);
 assert.match(pilot,/staff-workspace-v6\.mjs\?v=20261119-draft-v1&rev=20261119-(?:nav|2903)/);assert.match(pilot,/staff-client-profile\.mjs\?v=20261121-und-v1&rev=20261119-nav/);
 assert.match(rd('staff-pilot-auth.js'),/staff-pilot\.mjs\?v=20261114-setupguide-v1&rev=20261119-2906/);
 assert.match(v6,/selectProject\(id\)\{if\(selected!==id\)\{selectedPeriod='';taskFilter='All';\}selected=id;\}/);
});
