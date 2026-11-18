import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {expandRun,verdict,previewVerdict,summarise,MAX_ROWS,OPERATIONS} from '../supabase/functions/staff-workspace-v12/bulk-setup-rules.mjs';
import {buildPayload,payloadKey,optionsHtml,clientRows,resultsHtml,runsHtml,runHtml} from '../staff-bulk-setup.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const U=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const eng={operation:'ENGAGEMENT',template_id:U(1),service_code:'TAX-COMP',period_start:'2026-01-01',period_end:'2026-03-31',scope:'Monthly VAT working for the first quarter.',responsible_staff:U(2),reviewer_staff:U(3)};

test('a run is checked as a whole first: a request-level problem stops it, a row-level problem only skips that row',()=>{
 assert.match(expandRun({operation:'NOPE',rows:[{client_id:U(9)}]}).problem,/Choose what to set up/);
 assert.match(expandRun({...eng,rows:[]}).problem,/at least one client/);
 assert.match(expandRun({...eng,rows:Array.from({length:MAX_ROWS+1},(_,i)=>({client_id:U(i+10)}))}).problem,/up to 200/);
 assert.match(expandRun({...eng,reviewer_staff:'x',rows:[{client_id:U(9)}]}).problem,/responsible person and the reviewer/);
 assert.match(expandRun({...eng,period_end:'2025-12-31',rows:[{client_id:U(9)}]}).problem,/cannot end before/);
 assert.match(expandRun({...eng,scope:'short',rows:[{client_id:U(9)}]}).problem,/at least 10/);
 assert.match(expandRun({...eng,period_start:'2026-02-30',rows:[{client_id:U(9)}]}).problem,/first and last day/);
 assert.match(expandRun({operation:'PAYROLL_RETURNS',return_codes:[],effective_from:'2026-01-01',rows:[{client_id:U(9)}]}).problem,/at least one return/);
 assert.match(expandRun({operation:'PAYROLL_RETURNS',return_codes:['NSSF'],effective_from:'',rows:[{client_id:U(9)}]}).problem,/first day/);
 const r=expandRun({...eng,rows:[{client_id:U(9)},{client_id:'nope'},{client_id:U(9)},{client_id:U(8),firm_id:'bad'},{client_id:U(7),reviewer_staff:'bad'},{client_id:U(6),reviewer_staff:U(5)}]});
 assert.equal(r.rows.length,6);
 assert.deepEqual(r.rows.map(x=>!!x.problem),[false,true,true,true,true,false]);
 assert.match(r.rows[1].problem,/no valid client reference/);assert.match(r.rows[2].problem,/more than once/);assert.match(r.rows[3].problem,/firm reference/);assert.match(r.rows[4].problem,/reviewer reference/);
 assert.equal(r.rows[5].input.reviewer_staff,U(5),'a row may name its own reviewer');assert.equal(r.rows[0].input.reviewer_staff,U(3),'otherwise the common one');
 // Payroll returns expand to one row per client and return, in the fixed order.
 const p=expandRun({operation:'PAYROLL_RETURNS',return_codes:['SHIF','NSSF','NSSF'],effective_from:'2026-01-01',note:' a  note ',rows:[{client_id:U(9)},{client_id:U(8)}]});
 assert.deepEqual(p.rows.map(x=>x.key),['NSSF','SHIF','NSSF','SHIF']);assert.equal(p.common.note,'a note');assert.deepEqual(p.common.return_codes,['NSSF','SHIF']);
 assert.equal(Object.keys(OPERATIONS).length,2);
});

test('verdicts and the summary: every skipped row has a reason, and exceptions are listed apart',()=>{
 const row={row_no:1,client_id:U(9),client_label:'Alpha',item:'NSSF'};
 const a=verdict(row,true,{record_ref:'abc'}),s=verdict(row,false,{reason:'  Already chosen.  '}),pv=previewVerdict(row,true,{note:'2 tasks would be created'}),ps=previewVerdict(row,false,{});
 assert.equal(a.outcome,'Applied');assert.equal(a.record_ref,'abc');assert.equal(s.outcome,'Skipped');assert.equal(s.reason,'Already chosen.');assert.equal(pv.outcome,'Ready');assert.ok(ps.reason.length>3,'a skipped row never has an empty reason');
 const sum=summarise([a,s,{...a,row_no:2}]);assert.deepEqual([sum.total,sum.applied,sum.skipped,sum.ready],[3,2,1,2]);assert.equal(sum.exceptions.length,1);assert.equal(sum.exceptions[0].reason,'Already chosen.');
});

test('the screen: one payload shape, the preview counts only for what was previewed, exceptions are a separate table, everything is escaped',()=>{
 const sel=[{client_id:U(9),client_label:'Alpha',firm_id:U(4)},{client_id:U(8),client_label:'Beta',firm_id:''}];
 const p=buildPayload({operation:'ENGAGEMENT',...eng,selected:sel});
 assert.equal(p.rows.length,2);assert.equal(p.rows[0].firm_id,U(4));assert.ok(!('firm_id' in p.rows[1]),'no firm means the server uses the only linked firm or says which is needed');
 const pr=buildPayload({operation:'PAYROLL_RETURNS',return_codes:['NSSF'],effective_from:'2026-01-01',note:'',selected:sel});assert.deepEqual(Object.keys(pr),['operation','return_codes','effective_from','note','rows']);
 assert.notEqual(payloadKey(p),payloadKey({...p,scope:'Changed scope entirely here.'}),'a changed choice makes the preview stale');
 const opts={note:'Each client is checked on its own.',max_rows:200,operations:[{code:'ENGAGEMENT',label:'Service'},{code:'PAYROLL_RETURNS',label:'Returns'}],templates:[{template_id:U(1),name:'<b>Tax</b>',version:2,services:[{service_code:'TAX-COMP',service_name:'Tax'}]}],staff:[{staff_id:U(2),full_name:'A "Q" <i>',category_code:'MANAGER'},{staff_id:U(2),full_name:'A "Q" <i>',category_code:'MANAGER'}],returns:[{return_code:'NSSF',label:'NSSF monthly return'}],clients:[{client_id:U(9),company_name:'Alpha <script>',firms:[{firm_id:U(4),legal_name:'F1'},{firm_id:U(5),legal_name:'F2'}]},{client_id:U(8),company_name:'Beta',firms:[]}]};
 const html=optionsHtml(opts);assert.doesNotMatch(html,/<script>|<b>Tax<\/b>|<i>/);assert.match(html,/&lt;script&gt;/);assert.equal((html.match(/value="00000000-0000-4000-8000-000000000002"/g)||[]).length,2,'a person listed twice is offered once in each list');
 assert.match(html,/data-bulk-firm="00000000-0000-4000-8000-000000000009"/,'a client with two firms asks which');assert.match(html,/Not linked/);assert.match(html,/Up to 200 clients/);
 assert.match(clientRows(opts.clients,{search:'beta'}),/Beta/);assert.doesNotMatch(clientRows(opts.clients,{search:'beta'}),/Alpha/);assert.match(clientRows(opts.clients,{search:'zzz'}),/No client matches/);
 const res={applied:false,results:[{row_no:1,client_label:'Alpha',item:'NSSF',outcome:'Ready',note:'Would be chosen'},{row_no:2,client_label:'Be<ta>',item:'NSSF',outcome:'Skipped',reason:'Already chosen <x>'}],summary:{total:2,ready:1,skipped:1}};
 const out=resultsHtml(res);assert.match(out,/id="bulkReady"/);assert.match(out,/id="bulkExceptions"/);assert.match(out,/Nothing has been changed yet/);assert.doesNotMatch(out,/<ta>|<x>/);
 assert.ok(out.indexOf('bulkReady')<out.indexOf('bulkExceptions'),'what passed comes first, the exceptions are their own list');
 const done=resultsHtml({...res,applied:true,results:[{...res.results[0],outcome:'Applied'},res.results[1]]});assert.match(done,/audit trail/);assert.match(done,/Nothing was approved or posted/);
 assert.match(resultsHtml({applied:false,results:[res.results[1]],summary:{total:1,ready:0,skipped:1}}),/not ready/);assert.doesNotMatch(resultsHtml({applied:false,results:[res.results[1]],summary:{total:1,ready:0,skipped:1}}),/id="bulkReady"/);
 assert.match(runsHtml({runs:[]}),/No bulk run/);assert.match(runsHtml({runs:[{run_id:U(1),created_at:'2026-11-16T10:00:00Z',operation_label:'Returns',created_by_name:'M',applied_count:3,skipped_count:1}]}),/data-bulk="run"/);
 assert.match(runHtml({run:{operation_label:'Returns',created_at:'2026-11-16T10:00:00Z',created_by_name:'M'},rows:[{row_no:1,client_label:'A',item:'NSSF',outcome:'Applied',record_ref:U(1)},{row_no:2,client_label:'B',item:'NSSF',outcome:'Skipped',reason:'Why'}],summary:{total:2,applied:1,skipped:1}}),/Record 00000000/);
});

test('wiring: action routed, leaders only, one audit record per row, insert-only tables, button for leaders, build label',()=>{
 const idx=rd(fx+'index.ts');assert.match(idx,/import \{bulkSetupAction\} from '\.\/bulk-setup-actions\.ts'/);assert.match(idx,/const bulkSetup=await bulkSetupAction\(tx,a,p\);if\(bulkSetup!==undefined\)return bulkSetup;/);
 assert.match(rd(fx+'staff-access-control.mjs'),/client_setup_\|bulk_setup_\|/,'the actions belong to the Clients area');
 const act=rd(fx+'bulk-setup-actions.ts');assert.match(act,/LEADERS=\['PARTNER','MANAGER'\]/);assert.match(act,/A Manager or Partner sets up several clients at once/);
 assert.match(act,/savepoint/,'each row is its own savepoint');assert.match(act,/class Rollback/,'the preview rolls back the same work');
 assert.match(act,/clientChoicesAction\(t,a,\{action:'client_setup_returns_choose'/);assert.match(act,/serviceTemplateAction\(t,a,\{action:'engagement_setup_apply'/);
 assert.doesNotMatch(act.replace(/\/\/[^\n]*/g,''),/update erp_private\.|delete from|_approve|_decide|_publish/i,'a bulk run approves nothing and edits nothing');
 const m=rd('supabase/migrations/20261118100000_bulk_setup.sql');
 assert.match(m,/GRANT SELECT,INSERT ON erp_private\.bulk_setup_runs TO erp_api/);assert.match(m,/GRANT SELECT,INSERT ON erp_private\.bulk_setup_rows TO erp_api/);assert.doesNotMatch(m,/GRANT[^;]*UPDATE/);
 assert.match(m,/FORCE ROW LEVEL SECURITY/);assert.equal((m.match(/EXECUTE FUNCTION erp_private\.bulk_setup_immutable\(\)/g)||[]).length,2);assert.equal((m.match(/EXECUTE FUNCTION erp_private\.log_change/g)||[]).length,2);
 const imp=rd('staff-improvements.mjs'),pilot=rd('staff-pilot.mjs');
 assert.match(imp,/staff-bulk-setup\.mjs\?v=20261116-dates-v1/);assert.match(imp,/if\(a==='bulk-setup'\)await bulk\.open\(\)/);assert.match(pilot,/staff-improvements\.mjs\?v=20261122-loc-v1/);
 const btn=pilot.match(/isLeader\(\)\?'<div class="actions">'[^\n]*data-v3="bulk-setup"/);assert.ok(btn,'the button is in the leaders\' action row');
 const ui=rd('staff-bulk-setup.mjs');assert.match(ui,/bulk_setup_preview/);assert.match(ui,/bulk_setup_apply/);assert.match(ui,/confirm:true/);assert.match(ui,/I have checked this list/);
 assert.match(rd(fx+'release.json'),/2026-11-18\.2886/);assert.match(rd('staff-pilot.html'),/data-build="2026-11-18\.2886"/);
 // The latent project-creation defect found by this build stays fixed: no `returning` on the project insert.
 assert.doesNotMatch(rd(fx+'service-template-actions.ts'),/insert into erp_private\.projects[^`]*returning project_id/);
});
