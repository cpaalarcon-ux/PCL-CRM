import test from 'node:test';import assert from 'node:assert/strict';
import {dateIn,parseMultiYearTb,previewMultiYearTb,MAX_YEARS} from '../supabase/functions/staff-workspace-v12/year-tb-multi.mjs';
// Fictional figures only. The year being prepared starts on 1 January 2026, so the comparatives expect 31/12/2025 (year-end) and 31/12/2024 (opening).
const known=new Map([['10000','Cash'],['30000','Share capital'],['31000','Retained earnings'],['40000','Sales'],['50000','Cost of sales'],['60000','Unmapped expense']]);
const lineDefs=[{line_code:'SFP.CASH',statement:'Financial position'},{line_code:'SFP.SHARE_CAP',statement:'Financial position'},{line_code:'SFP.RETAINED',statement:'Financial position'},{line_code:'PL.REVENUE',statement:'Profit or loss'},{line_code:'PL.COST_SALES',statement:'Profit or loss'}];
const map=(a,l,o={})=>({account_code:a,line_code:l,effective_from:'2020-01-01',effective_to:null,status:'Approved',...o});
const maps=[map('10000','SFP.CASH'),map('30000','SFP.SHARE_CAP'),map('31000','SFP.RETAINED'),map('40000','PL.REVENUE'),map('50000','PL.COST_SALES')];
const NET=['Code\tName\t31/12/2024\t31/12/2025','10000\tCash\t200\t600','30000\tShare capital\t(100)\t(100)','31000\tRetained\t(100)\t(100)','40000\tSales\t\t(1,000)','50000\tCost of sales\t\t600'].join('\n');
const pv=(text,o={})=>previewMultiYearTb({text,known,maps,lineDefs,startsOn:'2026-01-01',...o});

test('dates: day first, several writings, and a date that is not real is refused rather than swapped',()=>{
 assert.equal(dateIn('31/12/2025'),'2025-12-31');assert.equal(dateIn('2025-12-31'),'2025-12-31');assert.equal(dateIn('31.12.2025'),'2025-12-31');assert.equal(dateIn('31 December 2025'),'2025-12-31');assert.equal(dateIn('Year ended 30 Jun 2025 Debit'),'2025-06-30');
 assert.equal(dateIn('12/31/2025'),null,'a month-first date is not read as day-first');assert.equal(dateIn('31/02/2025'),null);assert.equal(dateIn('Total'),null);
});
test('parser: one balance column per date; brackets are credits; a blank cell is nil',()=>{
 const p=parseMultiYearTb(NET);assert.deepEqual(p.errors,[]);assert.deepEqual(p.years.map(y=>y.as_of),['2024-12-31','2025-12-31']);
 const y24=p.years[0],y25=p.years[1];assert.deepEqual(y24.rows.map(r=>[r.code,r.debit,r.credit]),[['10000',200,0],['30000',0,100],['31000',0,100]]);
 assert.deepEqual(y25.rows.map(r=>[r.code,r.name,r.debit,r.credit]),[['10000','Cash',600,0],['30000','Share capital',0,100],['31000','Retained',0,100],['40000','Sales',0,1000],['50000','Cost of sales',600,0]]);
});
test('parser: a debit and a credit column per date work too, and columns are sorted by date',()=>{
 const p=parseMultiYearTb(['Code\t31/12/2025 Debit\t31/12/2025 Credit\t31/12/2024 Dr\t31/12/2024 Cr','10000\t600\t\t200\t','30000\t\t100\t\t100'].join('\n'));
 assert.deepEqual(p.errors,[]);assert.deepEqual(p.years.map(y=>y.as_of),['2024-12-31','2025-12-31']);assert.deepEqual(p.years[1].rows.map(r=>[r.code,r.debit,r.credit]),[['10000',600,0],['30000',0,100]]);
});
test('parser: what cannot be read is named and nothing is guessed',()=>{
 const e=t=>parseMultiYearTb(t).errors.join(' | ');
 assert.match(e(''),/Paste the trial balances/);assert.match(e('Code\tTotal\n10000\t5'),/not a balance date/);assert.match(e('Code\t12/31/2025\n10000\t5'),/looks like a date but is not a real one/);
 assert.match(e('Code\t31/12/2025\t31/12/2025\n10000\t5\t5'),/two balance columns/);assert.match(e('Code\t31/12/2025 Debit\n10000\t5'),/needs a credit column/);
 assert.match(e('Code\t31/12/2025\t31/12/2025 Debit\t31/12/2025 Credit\n10000\t5\t1\t1'),/either one balance column or a debit and a credit/);
 assert.match(e('Code\t31/12/2025\n!!\t5'),/not an account code/);assert.match(e('Code\t31/12/2025\n10000\tabc'),/"abc" is not an amount/);
 assert.match(e('Code\t31/12/2025 Debit\t31/12/2025 Credit\n10000\t5\t5'),/both a debit and a credit/);assert.match(e('Code\t31/12/2025 Debit\t31/12/2025 Credit\n10000\t-5\t'),/positive amounts/);
 const many=['Code',...Array.from({length:MAX_YEARS+1},(_,i)=>`31/12/${2019+i}`)].join('\t');assert.match(e(many+'\n10000\t1'),/At most 6 years/);
});
test('preview: each year says whether it balances, how many accounts are mapped, and which are not',()=>{
 const r=pv(NET);assert.equal(r.can_save,true);assert.equal(r.ok,true);assert.deepEqual(r.expected,{year_end:'2025-12-31',opening:'2024-12-31'});
 const [o,y]=r.years;assert.deepEqual([o.as_of,o.role,o.expected,o.rows,o.balanced,o.mapped_accounts,o.unmapped_accounts,o.state],['2024-12-31','Opening',true,3,true,3,0,'Ready']);
 assert.deepEqual([y.as_of,y.role,y.rows,y.total_debit,y.total_credit,y.difference,y.mapped_accounts,y.state],['2025-12-31','Year-end',5,1200,1200,0,5,'Ready']);assert.deepEqual(r.warnings,[]);
});
test('preview: an account with no approved statement line is named, does not stop the upload, and asks for acknowledgement',()=>{
 const t=['Code\t31/12/2024\t31/12/2025','10000\t200\t600','30000\t(100)\t(100)','31000\t(100)\t(500)','60000\t\t100','40000\t\t(100)'].join('\n');
 const r=pv(t);assert.equal(r.can_save,true);assert.equal(r.needs_unmapped_ack,true);const y=r.years[1];assert.equal(y.state,'Accounts not mapped');assert.deepEqual(y.unmapped,[{code:'60000',name:'Unmapped expense',amount:100}]);assert.equal(y.unmapped_amount,100);assert.equal(y.mapped_accounts,4);
 assert.match(r.warnings.join(' '),/no approved statement line \(2025-12-31\).*Needs review/);
 const later=pv(t,{maps:[...maps.filter(m=>m.account_code!=='40000'),map('40000','PL.REVENUE',{effective_from:'2026-01-01'})]});assert.equal(later.years[1].unmapped_accounts,2,'a map that starts after the balance date is not in force then');
 const pending=pv(t,{maps:maps.map(m=>m.account_code==='10000'?{...m,status:'Draft'}:m)});assert.equal(pending.years[0].unmapped_accounts,1,'only an approved map counts');
 const noLine=pv(t,{lineDefs:lineDefs.filter(l=>l.line_code!=='PL.REVENUE')});assert.ok(noLine.years[1].unmapped.some(u=>u.code==='40000'),'a map to a line that does not exist is not a mapping');
});
test('preview: what blocks the upload is named per year, and the other years are still shown',()=>{
 const t=['Code\t31/12/2024\t31/12/2025\t31/12/2026','10000\t200\t600\t5','30000\t(100)\t(100)\t(5)','31000\t(50)\t(500)\t','99999\t\t\t','10000\t\t1\t'].join('\n');
 const r=pv(t);assert.equal(r.can_save,false);const [a,b,c]=r.years;
 assert.equal(a.state,'Blocked');assert.match(a.problems.join(' '),/Does not balance: debits KES 200\.00, credits KES 150\.00 \(difference KES 50\.00\)/);
 assert.equal(b.state,'Blocked');assert.deepEqual(b.duplicates,['10000']);assert.match(b.problems.join(' '),/10000 appears more than once/);
 assert.equal(c.state,'Blocked');assert.match(c.problems.join(' '),/not before this financial year starts \(2026-01-01\)/);
 assert.ok(r.problems.some(p=>/^2024-12-31: Does not balance/.test(p)));
 const unk=pv(['Code\t31/12/2025','10000\t5','77777\t(5)'].join('\n'));assert.equal(unk.can_save,false);assert.match(unk.years[0].problems.join(' '),/Not in the chart of accounts: 77777.*not guessed/);assert.equal(unk.years[0].unknown_accounts,1);
 assert.equal(pv('Code\t31/12/2025\n',{}).can_save,false);assert.match(pv('Code\t31/12/2025\n').problems.join(' '),/no balances/i);
});
test('preview: missing and extra years are warned about, and an existing record is shown as replaced',()=>{
 const only=['Code\t31/12/2025','10000\t5','30000\t(5)'].join('\n');const r=pv(only);assert.equal(r.can_save,true);assert.match(r.warnings.join(' '),/no column for 2024-12-31.*Not available/);
 const old=pv(['Code\t31/12/2023\t31/12/2025','10000\t5\t5','30000\t(5)\t(5)'].join('\n'));assert.match(old.warnings.join(' '),/2023-12-31 is recorded as an earlier year-end/);assert.equal(old.years[0].expected,false);
 const ex=[{tb_kind:'Year-end',as_of:'2025-12-31',version:2,row_count:2,total_debit:5,total_credit:5}];const e=pv(only,{existing:ex});assert.deepEqual(e.years[0].replaces,{version:2});assert.equal(e.years[0].same_as_recorded,true);assert.match(e.warnings.join(' '),/same rows and totals as version 2/);
 const e2=pv(only,{existing:[{...ex[0],total_debit:6,total_credit:6}]});assert.equal(e2.years[0].same_as_recorded,false);assert.deepEqual(e2.years[0].replaces,{version:2});
 const op=pv(['Code\t31/12/2024','10000\t5','30000\t(5)'].join('\n'),{existing:[{tb_kind:'Year-end',as_of:'2024-12-31',version:1,row_count:2,total_debit:5,total_credit:5}]});assert.equal(op.years[0].replaces,null,'the opening column is compared with opening trial balances, not year-end ones');
});
