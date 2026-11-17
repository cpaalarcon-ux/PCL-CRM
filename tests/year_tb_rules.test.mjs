import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {parseTbText,validateTb,deriveComparatives,expectedDates,openingDateFor} from '../supabase/functions/staff-workspace-v12/year-tb-rules.mjs';
import {tbListHtml,deriveHtml} from '../staff-year-tbs.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const defs=[['PL.REVENUE','Profit or loss','Revenue','Credit',1],['PL.OPEX','Profit or loss','Operating costs','Debit',2],['SFP.SHARE_CAP','Financial position','Equity','Credit',300],['SFP.RETAINED','Financial position','Equity','Credit',370],['SFP.DRAWINGS','Financial position','Equity','Debit',340],['SFP.CASH','Financial position','Current assets','Debit',270]].map(([line_code,statement,section,normal_side,sort_order])=>({line_code,statement,section,normal_side,sort_order,label:line_code}));
const maps=[['40000','PL.REVENUE'],['60000','PL.OPEX'],['30000','SFP.SHARE_CAP'],['37000','SFP.RETAINED'],['34000','SFP.DRAWINGS'],['10000','SFP.CASH']].map(([account_code,line_code])=>({account_code,line_code,status:'Approved',effective_from:'2000-01-01',effective_to:null}));
const rows=(...x)=>x.map(([code,debit,credit])=>({code,name:'',debit,credit}));
test('parser: columns, nets, brackets, thousands with tabs; bad rows are named',()=>{
 const p=parseTbText('40000\t0\t1,000.50\n60000,400\n30000\tShare capital\t(100)\n#note\n10000\tCash\t5\t0\n70000;0;0');
 assert.deepEqual(p.errors,[]);assert.deepEqual(p.rows.map(r=>[r.code,r.debit,r.credit]),[['40000',0,1000.5],['60000',400,0],['30000',0,100],['10000',5,0]]);
 assert.match(parseTbText('40000\t5\t5').errors[0],/both a debit and a credit/);assert.match(parseTbText('40000\tx\ty\tz\tw').errors[0],/expected code/);assert.match(parseTbText('!!\t1\t0').errors[0],/not an account code/);assert.match(parseTbText('40000\tabc').errors[0],/not a number/);
});
test('validate: balance, duplicates and unknown accounts stop the record',()=>{
 const known=new Set(['40000','60000']);
 assert.deepEqual(validateTb(rows(['40000',0,10],['60000',10,0]),known).problems,[]);
 assert.match(validateTb(rows(['40000',0,10],['60000',9,0]),known).problems[0],/does not balance/);
 assert.match(validateTb(rows(['40000',0,10],['40000',10,0]),known).problems[0],/appears twice/);
 assert.match(validateTb(rows(['90000',0,10],['60000',10,0]),known).problems[0],/not in the chart/);
 assert.match(validateTb([],known).problems[0],/no balances/);
});
test('dates: the year-end and opening dates the comparatives expect',()=>{
 assert.deepEqual(expectedDates('2026-01-01'),{prior_end:'2025-12-31',opening_as_of:'2024-12-31'});assert.equal(openingDateFor('2025-06-30'),'2024-06-30');
});
test('derivation: only what the trial balances support; nothing zero-filled',()=>{
 const ye={closing_state:'Before year-end close',rows:rows(['10000',600,0],['60000',600,0],['40000',0,1000],['30000',0,100],['37000',0,100])},op={rows:rows(['10000',200,0],['30000',0,100],['37000',0,100])};
 const d=deriveComparatives({yearEnd:ye,opening:op,maps,lineDefs:defs,priorEnd:'2025-12-31'});
 assert.equal(d.pl.state,'Derived');assert.equal(d.pl.profit,400);assert.match(d.texts.pl,/PL\.REVENUE\t1000\.00/);assert.match(d.texts.pl,/PL\.OPEX\t600\.00/);
 assert.equal(d.eq.state,'Needs review');assert.match(d.texts.eq,/SFP\.RETAINED\tPROFIT\t400\.00/);assert.equal(d.cf.state,'Not available');assert.deepEqual(d.warnings,[]);
 // a drawing taken in the year is shown as dividends or drawings, with a point to confirm
 const ye2={closing_state:'Before year-end close',rows:rows(['10000',540,0],['34000',60,0],['60000',600,0],['40000',0,1000],['30000',0,100],['37000',0,100])};
 const d2=deriveComparatives({yearEnd:ye2,opening:op,maps,lineDefs:defs,priorEnd:'2025-12-31'});
 assert.match(d2.texts.eq,/SFP\.DRAWINGS\tDIVIDENDS_DRAWINGS\t-60\.00/);assert.ok(d2.warnings.some(w=>/Dividends or drawings/.test(w)));
 // missing or unsuitable inputs
 assert.equal(deriveComparatives({yearEnd:null,opening:op,maps,lineDefs:defs,priorEnd:'2025-12-31'}).pl.state,'Not available');
 assert.equal(deriveComparatives({yearEnd:ye,opening:null,maps,lineDefs:defs,priorEnd:'2025-12-31'}).eq.state,'Not available');
 const post=deriveComparatives({yearEnd:{closing_state:'After year-end close',rows:ye.rows},opening:op,maps,lineDefs:defs,priorEnd:'2025-12-31'});assert.equal(post.pl.state,'Not available');assert.equal(post.eq.state,'Not available');assert.equal(post.texts.pl,'');
 // an account with no approved line is named, and nothing is derived
 const um=deriveComparatives({yearEnd:{closing_state:'Before year-end close',rows:rows(['10000',5,0],['99999',0,5])},opening:op,maps,lineDefs:defs,priorEnd:'2025-12-31'});assert.equal(um.pl.state,'Needs review');assert.match(um.pl.reason,/99999/);assert.equal(um.texts.pl,'');
});
test('screens escape what they show and the ledger screen uses them',()=>{
 const esc=v=>String(v).replace(/</g,'&lt;'),table=(h,r)=>r.map(x=>x.join('|')).join('\n'),btn=(a,l)=>`[${a}]`,warn=w=>w.join(';');
 const h=tbListHtml({expected:{year_end:'2025-12-31',opening:'2024-12-31'},trial_balances:[{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',version:1,row_count:5,total_debit:1200,entered_by_name:'A <b>',source_reference:'Signed accounts'}]},{esc,table,btn,canEdit:true});
 assert.match(h,/A &lt;b>/);assert.match(h,/\[tb-add\]/);assert.match(h,/never as zero/);assert.doesNotMatch(tbListHtml({expected:{year_end:'a',opening:'b'},trial_balances:[]},{esc,table,btn,canEdit:false}),/tb-add/);
 assert.match(deriveHtml({statements:{'Cash flow':{state:'Not available',reason:'Enter it <now>'}},warnings:['Check this']},{esc,warn}),/Not available[\s\S]*&lt;now>/);
 const ui=rd('staff-ledger.mjs');assert.match(ui,/ledger_tb_list/);assert.match(ui,/ledger_tb_save/);assert.match(ui,/ledger_comparatives_from_tbs/);assert.match(ui,/staff-year-tbs\.mjs\?v=20261116-yeartb-v1/);assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261121-cat-v1/);
});
