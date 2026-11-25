// Build 2849: the policy cards, go-live date and public holidays used to sit above and below every Settings tab. Each now sits on one tab, and the
// long Accounting & Tax Rules tab is folded so one card is open at a time. Layout only: no card is removed and no rule changes.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {SETTINGS_TABS,CARD_TAB,tabForCard,layoutView,FOLD_TABS,FOLD_TITLES,fold} from '../staff-settings-layout.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const button=(a,l,c,x='')=>`<button data-v3="${a}" data-id="${c}" ${x}>${l}</button>`;

test('the extra cards go on one tab each, so they are no longer repeated on all nine',()=>{
 const suite=rd('staff-suite.mjs'),pilot=rd('staff-pilot.mjs');
 assert.match(suite,/function settings\(extra=\{\}\)\{if\(d\(\)\.me\.category_code==='ADMIN'\)return adminSettings\(\)\+Object\.values\(extra\)\.join\(''\)/);
 assert.match(suite,/for\(const \[code,html\] of Object\.entries\(extra\)\)if\(code in panels\)panels\[code\]\+=html;/);
 assert.match(pilot,/suite\.settings\(\{access:policyCard\(/);assert.match(pilot,/firm:holidaysUI\.render\(\)\}\)/);
 assert.doesNotMatch(pilot,/goLiveCard\(data,esc\)\+suite\.settings\(\)/,'nothing is added above the tab bar any more');
 assert.doesNotMatch(pilot,/suite\.settings\(\)\+holidaysUI/,'nor below the panels');
 const panels=Object.fromEntries(SETTINGS_TABS.map(t=>[t.code,'']));panels.access='<div id="policyCard">P</div>';panels.firm='<div id="holidaysCard">H</div>';
 const html=layoutView({active:'overview',panels,button});
 assert.equal((html.match(/id="policyCard"/g)||[]).length,1);assert.equal((html.match(/id="holidaysCard"/g)||[]).length,1);
 const inPanel=(code,id)=>{const m=html.match(new RegExp('id="settingsPanel-'+code+'"[^>]*>([\\s\\S]*?)(?=<div class="settings-panel"|$)'));return !!m&&m[1].includes(id);};
 assert.ok(inPanel('access','policyCard'));assert.ok(inPanel('firm','holidaysCard'));assert.ok(!inPanel('overview','policyCard'));assert.ok(!inPanel('payroll','holidaysCard'));
});

test('the tab descriptions say where those cards went',()=>{
 assert.match(SETTINGS_TABS.find(t=>t.code==='access').about,/Partner policies and the go-live date/);assert.match(SETTINGS_TABS.find(t=>t.code==='firm').about,/public holidays/);
});

test('Accounting & Tax Rules starts closed, and the cards keep their links and one-at-a-time behavior',()=>{
 assert.deepEqual([...FOLD_TABS],['accounting']);
 for(const id of Object.keys(FOLD_TITLES))assert.equal(tabForCard(id),'accounting',id+' lives on the accounting tab');
 const a=fold('chartCard','<section id="chartCard">C</section>'),b=fold('taxRatesCard','<section id="taxRatesCard">T</section>');
 assert.match(a,/name="settings-fold-accounting".*<summary>Chart of accounts<\/summary><section id="chartCard">C<\/section>/);
 assert.doesNotMatch(a+b,/\sopen(?:\s|>)/);assert.match(b,/<summary>Tax rates and rules<\/summary>/);assert.match(b,/id="taxRatesCard"/);
 assert.equal(fold('x',''),'','an empty card makes no empty fold');assert.match(fold('someNewCard','z'),/<summary>some New<\/summary>/);
 assert.match(fold('a','<b>',{tab:'x"y'}),/name="settings-fold-x&quot;y"/);
 assert.match(rd('staff-suite.mjs'),/panels\[tab\]\+=FOLD_TABS\.includes\(tab\)\?fold\(id,html,\{tab\}\):html/);
});

test('every card that was on the tab is still on it, and other tabs are not folded',()=>{
 for(const [id,tab] of Object.entries(CARD_TAB))assert.equal(tabForCard(id),tab);
 assert.ok(!FOLD_TABS.includes('overview')&&!FOLD_TABS.includes('access'));
 assert.match(rd('staff-suite.mjs'),/staff-settings-layout\.mjs\?v=20261119-settings-v1/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261119-fixes-v1/);
});
