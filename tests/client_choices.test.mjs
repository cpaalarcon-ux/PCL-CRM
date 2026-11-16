import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {selectionFields,endFields,profileCovers,returnAllowed,exceptionFields,exceptionDecision,closeFields,exceptionsInForce,EXCEPTION_KINDS} from '../supabase/functions/staff-workspace-v12/client-choices-rules.mjs';
import {buildClientTasks} from '../supabase/functions/staff-workspace-v12/client-setup-tasks-rules.mjs';
import {returnsHtml,exceptionsHtml,exceptionsNotice} from '../staff-client-choices.mjs';
import {kindButtons} from '../staff-statutory-files.mjs';
import {linkHtml} from '../staff-setup-tasks.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const prof=(rc,from,to=null,status='Published',version=1)=>({return_code:rc,effective_from:from,effective_to:to,status,version});

test('choosing a return: needs a return and a first day, and a published export profile must cover that day',()=>{
 assert.match(selectionFields({return_code:'XX',effective_from:'2026-01-01'}).problem,/Choose the return/);
 assert.match(selectionFields({return_code:'NSSF',effective_from:'soon'}).problem,/first day/);
 assert.match(selectionFields({return_code:'NSSF',effective_from:'2026-01-01',note:'x'.repeat(501)}).problem,/too long/);
 assert.deepEqual(selectionFields({return_code:'SHIF',effective_from:'2026-01-01',note:'  per client letter '}).values,{return_code:'SHIF',effective_from:'2026-01-01',note:'per client letter'});
 assert.equal(profileCovers([prof('NSSF','2026-01-01')],'NSSF','2026-06-01').ok,true);
 assert.match(profileCovers([prof('NSSF','2026-01-01','2026-03-31')],'NSSF','2026-06-01').problem,/No published export profile covers NSSF monthly return/);
 assert.match(profileCovers([prof('NSSF','2026-01-01',null,'Draft')],'NSSF','2026-06-01').problem,/Settings/,'a draft profile is not enough');
 assert.match(profileCovers([],'PAYE_P10','2026-06-01').problem,/PAYE return \(P10\)/);
});

test('ending a choice needs a last day on or after the first, and a reason',()=>{
 const sel={effective_from:'2026-03-01'};
 assert.match(endFields({effective_to:'2026-02-28',reason:'client stopped'},sel).problem,/before the first day/);
 assert.match(endFields({effective_to:'2026-06-30',reason:'no'},sel).problem,/Say why/);
 assert.match(endFields({effective_to:'later',reason:'client stopped'},sel).problem,/last day/);
 assert.deepEqual(endFields({effective_to:'2026-06-30',reason:'client stopped using NSSF'},sel).values,{effective_to:'2026-06-30',reason:'client stopped using NSSF'});
});

test('a return is filed only if chosen for the month; a client with no choice recorded keeps every return',()=>{
 assert.deepEqual(returnAllowed([],'NSSF','2026-06-01','2026-06-30'),{allowed:true,configured:false});
 const rows=[{return_code:'NSSF',effective_from:'2026-03-01',effective_to:'2026-08-31'},{return_code:'SHIF',effective_from:'2026-07-01',effective_to:null}];
 assert.equal(returnAllowed(rows,'NSSF','2026-06-01','2026-06-30').allowed,true);
 assert.equal(returnAllowed(rows,'NSSF','2026-09-01','2026-09-30').allowed,false,'after it ended');
 assert.equal(returnAllowed(rows,'NSSF','2026-02-01','2026-02-28').allowed,false,'before it started');
 assert.equal(returnAllowed(rows,'SHIF','2026-12-01','2026-12-31').allowed,true,'ongoing');
 const no=returnAllowed(rows,'PAYE_P10','2026-06-01','2026-06-30');assert.equal(no.allowed,false);assert.equal(no.configured,true);assert.match(no.problem,/not chosen for this client's payroll service for 2026-06/);
});

test('an exception needs a library rule, a kind, dates, a reason and a legal basis',()=>{
 const ok={rate_key:'KE_VAT_STD',kind:'NOT_APPLICABLE',effective_from:'2026-01-01',reason:'The client makes only exempt supplies, so the rule does not apply.',legal_basis:'VAT Act, First Schedule, Part I'};
 assert.ok(exceptionFields(ok,['KE_VAT_STD']).values);
 assert.match(exceptionFields({...ok,rate_key:'OTHER'},['KE_VAT_STD']).problem,/central library/);
 assert.match(exceptionFields({...ok,kind:'X'},['KE_VAT_STD']).problem,/does not apply or applies with a variation/);
 assert.match(exceptionFields({...ok,effective_from:''},['KE_VAT_STD']).problem,/first day/);
 assert.match(exceptionFields({...ok,effective_to:'2025-12-31'},['KE_VAT_STD']).problem,/before the first day/);
 assert.match(exceptionFields({...ok,reason:'too short'},['KE_VAT_STD']).problem,/20 to 1,000/);
 assert.match(exceptionFields({...ok,legal_basis:'x'},['KE_VAT_STD']).problem,/legal basis/);
 assert.deepEqual(Object.keys(EXCEPTION_KINDS),['NOT_APPLICABLE','VARIATION']);
});

test('who decides: a different Partner or the Tax Lead; never the proposer, never a plain Manager',()=>{
 const row={status:'Draft',created_by:'m1'};
 assert.equal(exceptionDecision(row,{staff_id:'p1',category_code:'PARTNER'}).ok,true);
 assert.equal(exceptionDecision(row,{staff_id:'m2',category_code:'MANAGER'},{taxLead:true}).ok,true,'the Tax Lead right');
 assert.match(exceptionDecision(row,{staff_id:'m2',category_code:'MANAGER'}).problem,/Partner, or the Tax Lead/);
 assert.match(exceptionDecision({...row,created_by:'p1'},{staff_id:'p1',category_code:'PARTNER'}).problem,/proposed this exception/);
 assert.match(exceptionDecision({...row,created_by:'m1'},{staff_id:'m1',category_code:'MANAGER'},{taxLead:true}).problem,/proposed this exception/,'a Tax Lead cannot approve their own proposal');
 assert.match(exceptionDecision({status:'Active'},{staff_id:'p1',category_code:'PARTNER'}).problem,/not waiting/);
 assert.match(closeFields({reason:'short'},{},'end').problem,/Say why/);
 assert.match(closeFields({reason:'no longer exempt',effective_to:'2025-01-01'},{effective_from:'2026-01-01'},'end').problem,/before the first day/);
 assert.deepEqual(closeFields({reason:'proposed in error',},{},'withdraw').values,{reason:'proposed in error'});
});

test('exceptions in force: approved only, for the rule and the date',()=>{
 const rows=[{status:'Active',rate_key:'A',effective_from:'2026-01-01',effective_to:null},{status:'Draft',rate_key:'A',effective_from:'2026-01-01',effective_to:null},{status:'Active',rate_key:'B',effective_from:'2026-01-01',effective_to:'2026-03-31'},{status:'Ended',rate_key:'A',effective_from:'2025-01-01',effective_to:'2025-12-31'}];
 assert.equal(exceptionsInForce(rows,['A'],'2026-06-01').length,1);
 assert.equal(exceptionsInForce(rows,['B'],'2026-06-01').length,0);
 assert.equal(exceptionsInForce(rows,['A','B'],'2026-02-01').length,2);
});

test('the queue gets a review task for proposed exceptions, split by who may decide',()=>{
 const base=o=>({clients:[{client_id:'c1',company_name:'Alpha'}],sections:[],versions:{c1:[{status:'Approved'}]},journals:{c1:[{status:'Posted'}]},openingStatus:{},routing:[],engagements:[],exceptions:[],me:{staff_id:'m1',leader:true,canApproveExceptions:true},...o});
 const only=t=>t.filter(x=>x.kind==='exception_review');
 const ex=[{client_id:'c1',status:'Draft',created_by:'m1'},{client_id:'c1',status:'Draft',created_by:'z'},{client_id:'c1',status:'Active',created_by:'z'},{client_id:'c2',status:'Draft',created_by:'z'}];
 const t=only(buildClientTasks(base({exceptions:ex})));assert.equal(t.length,1);assert.equal(t[0].count,2);assert.equal(t[0].blocked_mine,1);assert.equal(t[0].needs_me,true);assert.equal(t[0].go,'exceptions');
 assert.equal(only(buildClientTasks(base({exceptions:ex,me:{staff_id:'m1',leader:true,canApproveExceptions:false}})))[0].needs_me,false,'a Manager without the Tax Lead right does not decide');
 assert.equal(only(buildClientTasks(base({exceptions:[{client_id:'c1',status:'Draft',created_by:'m1'}]})))[0].needs_me,false,'only my own proposal');
 assert.deepEqual(only(buildClientTasks(base({exceptions:[]}))),[]);
 assert.match(linkHtml({client_id:'c9',go:'exceptions'},{}),/data-v3="exceptions" data-id="c9"/);
});

test('screens: payroll returns and tax rule exceptions',()=>{
 const res={client:{company_name:'<i>Alpha</i>'},configured:false,can_edit:true,history:[{return_label:'NSSF monthly return',effective_from:'2026-01-01',effective_to:'2026-05-31',selected_by_name:'A',note:'',ended_reason:'client stopped'}],offered:[
  {return_code:'NSSF',label:'NSSF monthly return',authority:'NSSF',profile:{version:2,template_version:'T9',verified_on:'2026-11-01'},chosen:false,selection_id:null},
  {return_code:'SHIF',label:'SHIF monthly contributions',authority:'SHA',profile:null,chosen:false,selection_id:null},
  {return_code:'PAYE_P10',label:'PAYE return (P10)',authority:'KRA',profile:{version:1,template_version:'V30',verified_on:'2026-11-01'},chosen:true,selection_id:'s1'}]};
 const h=returnsHtml(res,{});
 assert.match(h,/&lt;i&gt;Alpha&lt;\/i&gt;/);assert.match(h,/every return is offered, as before/);
 assert.match(h,/data-return="NSSF" data-chosen="no".*data-cc="choose-return" data-id="NSSF"/s);
 assert.match(h,/No published export profile/);assert.match(h,/Publish a profile in Settings first/);
 assert.match(h,/data-return="PAYE_P10" data-chosen="yes".*data-cc="end-return" data-id="s1"/s);
 assert.match(h,/Ended: client stopped/);
 assert.doesNotMatch(returnsHtml({...res,can_edit:false},{}),/data-cc=/,'staff below Manager can only read');
 const exr={client:{company_name:'Alpha'},note:'The rule itself stays in the central library.',can_approve:true,exceptions:[
  {exception_id:'e1',rate_key:'KE_VAT_STD',rate_label:'VAT standard',kind:'NOT_APPLICABLE',kind_label:'Does not apply',effective_from:'2026-01-01',effective_to:null,reason:'r',legal_basis:'b',status:'Draft',created_by_name:'M',mine:false,revision:'1'},
  {exception_id:'e2',rate_key:'KE_VAT_STD',rate_label:'VAT standard',kind:'VARIATION',kind_label:'Variation',effective_from:'2026-01-01',effective_to:null,reason:'r',legal_basis:'b',status:'Draft',created_by_name:'M',mine:true,revision:'1'},
  {exception_id:'e3',rate_key:'K3',rate_label:'K3',kind:'VARIATION',kind_label:'Variation',effective_from:'2026-01-01',effective_to:null,reason:'r',legal_basis:'b',status:'Active',created_by_name:'M',approved_by_name:'P',mine:false,revision:'2'}]};
 const x=exceptionsHtml(exr,{});
 assert.match(x,/data-cc="approve-exception" data-id="e1"/);assert.doesNotMatch(x,/data-cc="approve-exception" data-id="e2"/,'no approve button on my own proposal');
 assert.match(x,/Waiting for a different approver/);assert.match(x,/data-cc="end-exception" data-id="e3"/);assert.match(x,/approved by P/);
 assert.doesNotMatch(exceptionsHtml({...exr,can_approve:false},{}),/approve-exception/,'no approve button without the right');
 assert.match(exceptionsHtml({...exr,exceptions:[]},{}),/No exception recorded/);
 assert.equal(exceptionsNotice([]),'');assert.match(exceptionsNotice([{rate_key:'K',kind:'NOT_APPLICABLE',effective_from:'2026-01-01',effective_to:null,reason:'why',legal_basis:'law'}]),/The figures below use the firm-wide rule/);
});

test('the statutory files screen offers only chosen returns, and says so when none is chosen for a month',()=>{
 const m={import_id:'i1',allowed_kinds:['NSSF','PAYE_P10']};
 const h=kindButtons(m,null,s=>s);assert.match(h,/data-kind="NSSF"/);assert.match(h,/data-kind="PAYE_P10"/);assert.doesNotMatch(h,/data-kind="SHIF"/);
 assert.match(kindButtons({import_id:'i1',allowed_kinds:[]},null,s=>s),/No return is chosen for this month/);
 assert.equal((kindButtons({import_id:'i1'},null,s=>s).match(/data-kind=/g)||[]).length,3,'an old answer without the list shows all three');
});

test('wiring: actions, screens, migration safeguards',()=>{
 const idx=rd('supabase/functions/staff-workspace-v12/index.ts'),act=rd('supabase/functions/staff-workspace-v12/client-choices-actions.ts'),sf=rd('supabase/functions/staff-workspace-v12/statutory-file-actions.ts');
 assert.match(idx,/clientChoicesAction\(tx,a,p\)/);assert.match(act,/client_setup_returns_choose/);assert.match(act,/client_setup_exception_decide/);
 assert.match(sf,/returnAllowed\(chosenRows/);assert.match(sf,/allowed_kinds/);
 assert.match(rd('supabase/functions/staff-workspace-v12/tax-review-actions.ts'),/client_exceptions/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/client_setup_/);
 const imp=rd('staff-improvements.mjs');assert.match(imp,/a==='returns'\)await choices\.returns\(id\)/);assert.match(imp,/a==='exceptions'\)await choices\.exceptions\(id\)/);assert.match(rd('staff-client-profile.mjs'),/data-v3=\"returns\" data-id=\"\$\{id\}\"`,'Payroll returns'\)/);assert.match(rd('staff-client-profile.mjs'),/data-v3=\"exceptions\"/);
 const sql=rd('supabase/migrations/20261117210000_client_returns_and_tax_exceptions.sql');
 for(const t of ['client_payroll_returns','client_tax_exceptions']){assert.match(sql,new RegExp('ALTER TABLE erp_private\\.'+t+' FORCE ROW LEVEL SECURITY'));assert.match(sql,new RegExp('ON erp_private\\.'+t+' FOR EACH ROW EXECUTE FUNCTION erp_private\\.reject_delete'));}
 assert.match(sql,/CHECK\(approved_by IS NULL OR approved_by<>created_by\)/);assert.match(sql,/tax_rules_approver\(\)/);
});
