import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {dateFields,mergeDates,sameDates,datesGate,dateWarnings,datesLine} from '../supabase/functions/staff-workspace-v12/practice-rules.mjs';
import {categoriesHtml,resultsHtml} from '../staff-service-categories.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const T='2026-11-16';

test('dates: real, in range, not in the future; at least one when asked for; optional with an approval',()=>{
 assert.deepEqual(dateFields({},T).values,null);assert.match(dateFields({},T,{required:true}).problem,/or both/);
 for(const bad of ['2027-02-30','27-01-01','2027/01/01','2019-12-31','2101-01-01','abc'])assert.match(dateFields({effective_from:bad},T).problem,/Effective from/,bad);
 assert.match(dateFields({last_reviewed:'2026-11-17'},T).problem,/future/);assert.match(dateFields({last_reviewed:'2019-01-01'},T).problem,/real date/);
 assert.match(dateFields({last_reviewed:T,dates_note:'x'.repeat(501)},T).problem,/500/);
 assert.deepEqual(dateFields({effective_from:' 2027-01-01 ',last_reviewed:T,dates_note:'  ok  '},T).values,{effective_from:'2027-01-01',last_reviewed:T,note:'ok'});
 assert.deepEqual(dateFields({last_reviewed:T},T).values,{effective_from:null,last_reviewed:T,note:null});
});

test('dates: a blank date is carried forward from the one in force; the same dates are not recorded twice',()=>{
 const cur={effective_from:'2027-01-01',last_reviewed:'2026-11-10'};
 assert.deepEqual(mergeDates(cur,{effective_from:'2027-03-01',last_reviewed:null,note:null}),{effective_from:'2027-03-01',last_reviewed:'2026-11-10',note:null});
 assert.deepEqual(mergeDates(null,{effective_from:null,last_reviewed:T,note:'n'}),{effective_from:null,last_reviewed:T,note:'n'});
 assert.equal(sameDates(cur,mergeDates(cur,{effective_from:'2027-01-01',last_reviewed:null,note:'new note'})),true);
 assert.equal(sameDates(cur,mergeDates(cur,{effective_from:'2027-01-02',last_reviewed:null,note:null})),false);assert.equal(sameDates(null,{effective_from:'2027-01-01'}),false);
});

test('dates: a Partner or Manager records them on a draft or an approved version, never a retired one',()=>{
 const P={category_code:'PARTNER'},M={category_code:'MANAGER'},A={category_code:'ASSISTANT'};
 assert.equal(datesGate({status:'Draft'},M).ok,true);assert.equal(datesGate({status:'Approved'},P).ok,true);
 assert.match(datesGate({status:'Approved'},A).problem,/Partner or a Manager/);assert.match(datesGate({status:'Retired'},P).problem,/keeps the dates it had/);
});

test('dates: warnings on an engagement plan are said, not enforced',()=>{
 assert.deepEqual(dateWarnings(null,'2026-12-01',T),[]);assert.deepEqual(dateWarnings({effective_from:null,last_reviewed:null},'2026-12-01',T),[]);
 assert.match(dateWarnings({effective_from:'2027-01-01'},'2026-12-01',T)[0],/takes effect on 2027-01-01, after this period starts/);
 assert.deepEqual(dateWarnings({effective_from:'2026-11-01'},'2026-12-01',T),[],'in force before the period starts: nothing to say');
 assert.match(dateWarnings({last_reviewed:'2025-11-15'},'2026-12-01',T)[0],/more than a year ago/);assert.deepEqual(dateWarnings({last_reviewed:'2025-11-16'},'2026-12-01',T),[]);
 assert.equal(dateWarnings({effective_from:'2027-01-01',last_reviewed:'2020-01-01'},'2026-12-01',T).length,2);
 assert.equal(datesLine(null),'No dates recorded');assert.equal(datesLine({effective_from:'2027-01-01',last_reviewed:T}),'From 2027-01-01 · reviewed '+T);assert.equal(datesLine({last_reviewed:T}),'reviewed '+T);
});

test('the form: dates shown on every row, a date box that serves three buttons, escaped',()=>{
 const t=o=>({template_id:'t1',template_code:'TAX',version:1,name:'Tax <x>',service_group:'Tax Compliance',source:'Staff',status:'Approved',tasks:3,services:'TAX',waiting:false,task_list:[],can_propose:true,can_retire:true,dates_line:'From 2027-01-01 · reviewed 2026-11-10',...o});
 const c=categoriesHtml({sole:false,can_retire:true,templates:[t({}),t({template_id:'t2',template_code:'ACC',dates_line:undefined})]});
 assert.match(c,/From 2027-01-01 · reviewed 2026-11-10/);assert.match(c,/No dates recorded/);assert.match(c,/id="scDates"/);assert.match(c,/id="scEffective" type="date"|type="date" id="scEffective"/);assert.match(c,/id="scReviewed"/);assert.match(c,/data-sc="check-dates"/);
 assert.match(c,/recorded with <b>Approve<\/b> and with <b>New version<\/b>/);assert.doesNotMatch(c,/<x>/);
 const r=resultsHtml({dry:false,kind:'dates',summary:{total:1,done:1,skipped:0},results:[{label:'A',outcome:'Dates recorded',note:'From 2027-01-01 · reviewed 2026-11-10'}]});
 assert.match(r,/given dates/);assert.match(r,/Dates recorded/);assert.match(r,/From 2027-01-01/);
});

test('wiring: insert-only table, shown on set-up, build label, tokens',()=>{
 const m=rd('supabase/migrations/20261118120000_service_template_dates.sql');
 assert.match(m,/GRANT SELECT,INSERT ON erp_private\.service_template_dates TO erp_api/);assert.doesNotMatch(m,/GRANT[^;]*UPDATE/);assert.match(m,/FORCE ROW LEVEL SECURITY/);assert.match(m,/immutable BEFORE UPDATE OR DELETE/);assert.match(m,/A retired service template keeps the dates it had/);assert.match(m,/log_change\('date_id'\)/);
 const act=rd(fx+'practice-template-actions.ts');assert.match(act,/'service_category_dates'/);assert.match(act,/recordDates/);assert.doesNotMatch(act.replace(/\/\/[^\n]*/g,''),/update erp_private\.|delete from/i);
 const st=rd(fx+'service-template-actions.ts');assert.match(st,/dateWarnings\(tpl,i\.period_start,today\)/);assert.match(st,/effective_from:x\.effective_from/);assert.match(st,/template_effective_from/);
 assert.match(rd('staff-service-setup.mjs'),/no dates recorded/);assert.match(rd('staff-bulk-setup.mjs'),/reviewed /);
 const imp=rd('staff-improvements.mjs');assert.match(imp,/staff-service-setup\.mjs\?v=20261121-wiz-v1/);for(const f of ['staff-bulk-setup','staff-service-categories'])assert.match(imp,new RegExp(f+'\\.mjs\\?v=20261116-dates-v1'));
 assert.match(rd(fx+'release.json'),/2026-11-14\.2876/);assert.match(rd('staff-pilot.html'),/data-build="2026-11-14\.2876"/);
});
