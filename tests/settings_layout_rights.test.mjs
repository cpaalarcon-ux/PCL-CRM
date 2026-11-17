// Settings layout and the "Who can do what" page (build 2836). Pure: no database, no browser.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const L=await import('../staff-settings-layout.mjs');
const button=(a,l,id='',x='')=>`<button type="button" data-su="${a}" data-id="${id}" ${x}>${l}</button>`;

test('every Settings card sits on exactly one tab and none is dropped',()=>{
 const suite=rd('staff-suite.mjs'),m=suite.match(/const pieces=\{([\s\S]*?)\};\n  const panels/)[1];
 const keys=[...m.matchAll(/(?:^|[,\n ])([a-zA-Z]+Card|settingsHub):/g)].map(x=>x[1]);
 assert.equal(new Set(keys).size,keys.length);assert.ok(keys.length>=15,'all cards kept: '+keys.length);
 const tabs=new Set(L.SETTINGS_TABS.map(t=>t.code));
 for(const k of keys){assert.ok(tabs.has(L.tabForCard(k)),k);assert.ok(k in L.CARD_TAB,k+' has a named tab');}
 assert.equal(L.tabForCard('aFutureCard'),'records','a card nobody placed still shows, under Records & Audit History');
 assert.match(suite,/staff-settings-layout\.mjs\?v=20261119-settings-v1/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261119-settings-v1/);
 assert.match(suite,/action==='settings-tab'/);
});
test('the page shows one tab and keeps the others in the page, hidden',()=>{
 const panels=Object.fromEntries(L.SETTINGS_TABS.map(t=>[t.code,`<p>${t.code} body</p>`]));
 const html=L.layoutView({active:'accounting',panels,button});
 for(const t of L.SETTINGS_TABS)assert.match(html,new RegExp(`id="settingsPanel-${t.code}"`));
 assert.equal((html.match(/ hidden>/g)||[]).length,L.SETTINGS_TABS.length-1);
 assert.match(html,/id="settingsPanel-accounting" role="tabpanel">/);
 assert.match(html,/aria-selected="true"/);assert.deepEqual(L.SETTINGS_TABS.map(t=>t.label),['Overview','Firm & Users','Access & Approvals','Service Catalogue','Accounting & Tax Rules','Upload & Export Templates','Payroll Configuration','Integrations','Records & Audit History']);assert.match(html,/Settings \u2192 Tax|Settings → Accounting/);
 assert.match(L.layoutView({active:'nonsense',panels,button}),/id="settingsPanel-overview" role="tabpanel">/,'an unknown tab falls back to the overview');
});
test('Who can do what: ranked, a Partner never below a Manager, the viewer is marked',()=>{
 assert.deepEqual(L.ROLE_COLUMNS.map(c=>c[0]),['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']);
 const rank=v=>v==='—'?0:v==='Yes'?3:2;
 for(const g of L.RIGHTS_ROWS)for(const r of g.rows){
  assert.equal(r.who.length,5,r.what);
  assert.ok(rank(r.who[0])>=rank(r.who[1]),'Partner is not below Manager: '+r.what);
  for(let i=1;i<4;i++)assert.ok(rank(r.who[i-1])>=rank(r.who[i])||r.what.startsWith('Issue a client letter'),'ranked down the table: '+r.what);
 }
 const taxRow=L.RIGHTS_ROWS.flatMap(g=>g.rows).find(r=>/VAT, withholding tax and excise/.test(r.what));
 assert.match(taxRow.who[0],/^Yes/);assert.match(taxRow.who[1],/Tax Manager/);assert.equal(taxRow.who[2],'—');
 const html=L.rightsView({me:'PARTNER'});
 assert.match(html,/id="rightsTable"/);assert.match(html,/Engagement Partner<small> \(you\)<\/small>/);assert.match(html,/never approves it/);
 assert.doesNotMatch(L.rightsView({me:'ADMIN'}),/\(you\)/);
});
test('the rights page says what the server enforces',()=>{
 const fx='supabase/functions/staff-workspace-v12/';
 const all=fs.readdirSync(path.join(root,fx)).filter(f=>/\.(ts|mjs)$/.test(f)).map(f=>rd(fx+f)).join('\n');
 for(const msg of ['Only an Engagement Partner can manage additional rights','Only a Partner can sign off or withdraw a policy','Only a Partner can set the go-live date','Only the Engagement Partner can approve the audit file','Only the named signatory or an Engagement Partner can issue this letter','The measurement register is kept by Supervisors, Managers and Partners','Only an Engagement Partner or the designated Tax Manager can confirm and approve tax rules'])assert.ok(all.includes(msg),msg);
 assert.match(rd('supabase/migrations/20261116250000_partner_rank_tax_rules.sql'),/category_code='PARTNER'/);
 assert.match(rd(fx+'release.json'),/2026-11-14\.2860/);assert.match(rd('staff-pilot.html'),/data-build="2026-11-14\.2860"/);
});
test('tabs with nothing to configure say so; every tab has a breadcrumb',()=>{
 const html=L.layoutView({active:'payroll',panels:Object.fromEntries(L.SETTINGS_TABS.map(t=>[t.code,'']) ),button});
 assert.match(html,/Payroll components .* are not configured here yet/);assert.match(html,/does not file on the KRA or eTIMS portals/);
 assert.equal((html.match(/class="muted settings-crumb"/g)||[]).length,L.SETTINGS_TABS.length);
 assert.match(html,/Settings → Upload &amp; Export Templates/);
 const suite=rd('staff-suite.mjs');assert.match(suite,/panels\.access\+=rightsView/);
});
