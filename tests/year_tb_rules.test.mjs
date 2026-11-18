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
 assert.equal(d.eq.state,'Needs review');assert.match(d.texts.eq,/SFP\.RETAINED\tPROFIT\t400\.00/);assert.equal(d.cf.state,'Needs review');assert.deepEqual(d.warnings.filter(w=>!/^Cash flow:/.test(w)),[]);
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
 const ui=rd('staff-ledger.mjs');assert.match(ui,/ledger_tb_list/);assert.match(ui,/ledger_tb_save/);assert.match(ui,/ledger_comparatives_from_tbs/);assert.match(ui,/staff-year-tbs\.mjs\?v=20261116-yeartb-v1/);assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261127-ppe-v1/);
});

test('build 2876: the prior-year cash flow is worked out from the two year-end trial balances, and is Not available when it cannot be',()=>{
 const D=[...defs,{line_code:'SFP.TRADE_REC',statement:'Financial position',section:'Current assets',normal_side:'Debit',sort_order:260,label:'Trade receivables',cash_flow_class:'Operating'},{line_code:'SFP.MYSTERY',statement:'Financial position',section:'Non-current assets',normal_side:'Debit',sort_order:100,label:'Mystery asset',cash_flow_class:null}];
 const M=[...maps,{account_code:'11000',line_code:'SFP.TRADE_REC',status:'Approved',effective_from:'2000-01-01',effective_to:null},{account_code:'15999',line_code:'SFP.MYSTERY',status:'Approved',effective_from:'2000-01-01',effective_to:null}];
 const op={rows:rows(['10000',200,0],['11000',50,0],['30000',0,100],['37000',0,150])};
 // profit 400; receivables grew by 100 (cash down 100); cash rose from 200 to 500 (profit 400 less 100)
 const ye={closing_state:'Before year-end close',rows:rows(['10000',500,0],['11000',150,0],['60000',600,0],['40000',0,1000],['30000',0,100],['37000',0,150])};
 const d=deriveComparatives({yearEnd:ye,opening:op,maps:M,lineDefs:D,priorEnd:'2025-12-31'});
 assert.equal(d.cf.state,'Needs review');
 const by=Object.fromEntries(d.cf.lines.map(l=>[l.line_code,l.amount]));
 assert.equal(by['CF.PBT'],400);assert.equal(by['CF.WC_REC'],-100);assert.equal(by['CF.CASH_OPEN'],200);assert.equal(by['CF.CASH_CLOSE'],500);
 const net=d.cf.lines.filter(l=>!['CF.CASH_OPEN','CF.CASH_CLOSE'].includes(l.line_code)).reduce((a,l)=>a+l.amount,0);assert.equal(by['CF.CASH_OPEN']+net,by['CF.CASH_CLOSE'],'the lines add up to the closing cash exactly');
 assert.match(d.texts.cf,/CF\.PBT\t400\.00/);assert.match(d.texts.cf,/CF\.WC_REC\t-100\.00/);assert.ok(d.warnings.some(w=>/register/.test(w)),'no PPE register: disposals are not separated, and it says so');
 // no opening trial balance, a year-end taken after the close, or no year-end at all: Not available with the reason, never zero
 const noOp=deriveComparatives({yearEnd:ye,opening:null,maps:M,lineDefs:D,priorEnd:'2025-12-31'});assert.equal(noOp.cf.state,'Not available');assert.match(noOp.cf.reason,/No opening trial balance/);assert.deepEqual(noOp.cf.lines,[]);assert.equal(noOp.texts.cf,'');
 const after=deriveComparatives({yearEnd:{closing_state:'After year-end close',rows:ye.rows},opening:op,maps:M,lineDefs:D,priorEnd:'2025-12-31'});assert.equal(after.cf.state,'Not available');assert.match(after.cf.reason,/before the year-end close/);
 const none=deriveComparatives({yearEnd:null,opening:op,maps:M,lineDefs:D,priorEnd:'2025-12-31'});assert.equal(none.cf.state,'Not available');assert.match(none.cf.reason,/cannot be final/);
 // an equity movement that is not profit, capital or drawings cannot be placed in a financing line: Not available
 const odd=deriveComparatives({yearEnd:{closing_state:'Before year-end close',rows:rows(['10000',560,0],['11000',150,0],['60000',600,0],['40000',0,1000],['30000',0,100],['37000',0,210])},opening:op,maps:M,lineDefs:D,priorEnd:'2025-12-31'});
 assert.equal(odd.cf.state,'Not available');assert.match(odd.cf.reason,/Other equity movements/);
 // a balance with no cash-flow class is never guessed into a line
 const myst=deriveComparatives({yearEnd:{closing_state:'Before year-end close',rows:rows(['10000',400,0],['15999',100,0],['11000',150,0],['60000',600,0],['40000',0,1000],['30000',0,100],['37000',0,150])},opening:op,maps:M,lineDefs:D,priorEnd:'2025-12-31'});
 assert.equal(myst.cf.state,'Not available');
 // an unmapped account stops every statement, the cash flow included
 const unm=deriveComparatives({yearEnd:{closing_state:'Before year-end close',rows:rows(['10000',500,0],['99999',150,0],['60000',600,0],['40000',0,1000],['30000',0,100],['37000',0,150])},opening:op,maps:M,lineDefs:D,priorEnd:'2025-12-31'});
 assert.equal(unm.cf.state,'Not available');assert.match(unm.cf.reason,/no approved statement line/);
});
