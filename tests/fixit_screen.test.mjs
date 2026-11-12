// Exception queue for bank statement lines (build 2785): filters, similar lines, the grouped account dropdown and the wiring. Mapping itself is tested in ledger_integration.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {newState,filterItems,similarLines,wordingKey,accountGroups,splitView,detailView,REASONS} from '../staff-fixit-screen.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const h={esc,kes:n=>Number(n).toFixed(2),shortDate:d=>String(d||'').slice(0,10),btn:(a,l,id='')=>`<button data-ledger="${a}" data-id="${esc(id)}">${l}</button>`};
const it=(o={})=>({row_id:'r1',revision:1,reason:'Not mapped',date:'2026-09-01',bank:'KCB 0123',reference:'MPESA CHARGE 8821',description:'',money_in:0,money_out:35,suggestion:null,...o});
const items=[it(),it({row_id:'r2',reference:'MPESA CHARGE 9934',money_out:35}),it({row_id:'r3',reference:'MPESA CHARGE 7710',money_in:35,money_out:0}),it({row_id:'r4',reference:'SALARY PAYMENT',money_out:90000,bank:'Equity 9'}),
 it({row_id:'r5',reference:'LEDGER FEE',suggestion:{account_code:'62510',keyword:'ledger fee'}}),it({row_id:'r6',reason:'Transfer has no opposite line',reference:'TRF TO SAVINGS',money_out:5000})];
const accounts=[{code:'62500',name:'Bank transaction fees',group:'Finance costs'},{code:'62510',name:'Bank monthly service charges',group:'Finance costs'},{code:'51000',name:'Salaries',group:'Staff costs'}];

test('wording ignores numbers, so repeated charges are recognised as alike',()=>{
 assert.equal(wordingKey(items[0]),wordingKey(items[1]));assert.equal(wordingKey(items[0]),'mpesa charge');
 assert.deepEqual(similarLines(items,items[0]).map(x=>x.row_id),['r2'],'the money-in line with the same wording is not similar: direction differs');
 assert.deepEqual(similarLines(items,items[5]),[],'a transfer line is not bulk-tagged');
 assert.deepEqual(similarLines([it({reference:'12345'}),it({row_id:'x',reference:'67890'})],it({reference:'12345'})),[],'numbers alone give no wording');
});

test('filters by reason, direction, bank and text',()=>{
 const f=o=>filterItems(items,{...newState(),...o}).map(x=>x.row_id);
 assert.equal(f({}).length,6);assert.deepEqual(f({reason:'Not mapped'}),['r1','r2','r3','r4','r5']);assert.deepEqual(f({reason:'suggested'}),['r5']);assert.deepEqual(f({reason:'transfer'}),['r6']);
 assert.deepEqual(f({dir:'in'}),['r3']);assert.deepEqual(f({bank:'Equity 9'}),['r4']);assert.deepEqual(f({q:'  mpesa-charge '}),['r1','r2','r3']);assert.deepEqual(f({reason:'Not mapped',dir:'out',q:'fee'}),['r5']);
 assert.equal(REASONS.length,4);
});

test('account dropdown is grouped and starts on the suggested account',()=>{
 assert.deepEqual(accountGroups(accounts).map(g=>[g.group,g.accounts.length]),[['Finance costs',2],['Staff costs',1]]);
 const html=detailView({item:items[4],similar:[],fx:newState(),accounts,acct:new Map(accounts.map(a=>[a.code,a.name])),canMap:true,h});
 assert.match(html,/<optgroup label="Finance costs">/);assert.match(html,/<option value="62510" selected>/);assert.match(html,/The dropdown starts on it; you still choose/);assert.match(html,/does not post to the ledger/);
});

test('detail panel: bulk buttons appear only when there is something to do; read-only roles cannot map',()=>{
 const fx=newState(),acct=new Map();
 let html=detailView({item:items[0],similar:[items[1]],fx,accounts,acct,canMap:true,h});
 assert.match(html,/Map this line and 1 similar/);assert.doesNotMatch(html,/fx-map-sel/);assert.match(html,/fx-select-similar/);
 fx.sel.add('r4');html=detailView({item:items[0],similar:[],fx,accounts,acct,canMap:true,h});assert.match(html,/Map 1 selected/);assert.doesNotMatch(html,/similar/);
 assert.doesNotMatch(detailView({item:items[0],similar:[],fx,accounts,acct,canMap:false,h}),/fxAccount|fx-map/);
 assert.match(detailView({item:items[5],similar:[],fx,accounts,acct,canMap:true,h}),/no opposite line/);assert.doesNotMatch(detailView({item:items[5],similar:[],fx,accounts,acct,canMap:true,h}),/fxAccount/);
 assert.match(detailView({item:null,similar:[],fx,accounts,acct,canMap:true,h}),/Choose a line on the left/);
});

test('split view escapes text, marks the open line and shows counts',()=>{
 const fx={...newState(),active:'r1'};fx.sel.add('r2');
 const html=splitView({items:[...items,it({row_id:'x',reference:'<script>alert(1)</script>'})],fx,accounts,acct:new Map(),canMap:true,h});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/class="fx-active"/);assert.match(html,/7 of 7 line\(s\) shown · 1 ticked/);
 assert.match(html,/checked/);assert.match(html,/Tick the 6 unmapped shown/);
});

test('wiring: handlers, versioned imports, styles, build label',()=>{
 const ui=rd('staff-ledger.mjs');
 for(const a of ['fx-open','fx-map-one','fx-map-similar','fx-map-sel','fx-select-similar','fx-select-shown','fx-clear'])assert.ok(ui.includes("'"+a+"'"),a);
 assert.match(ui,/staff-fixit-screen\.mjs\?v=20261111-fixit-v1/);assert.match(ui,/ledger_bank_lines_map/);assert.match(ui,/does not post to the ledger/);
 assert.doesNotMatch(ui,/bank-map-selected/,'the old tick-then-map button is replaced');
 const css=rd('staff-pilot.css');assert.match(css,/\.fx-split\{/);assert.match(css,/\.sr-only\{/);assert.match(rd('staff-pilot.html'),/staff-pilot\.css\?v=20261111-fixit-v1/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261111-bankfixit-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/release.json'),/2026-11-12\.2793/);assert.match(rd('staff-pilot.html'),/2026-11-12\.2793/);
});
