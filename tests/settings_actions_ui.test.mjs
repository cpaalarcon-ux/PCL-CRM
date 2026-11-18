import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fx='../supabase/functions/staff-workspace-v12/';
const R=await import(fx+'statement-review-rules.mjs');
const O=await import(fx+'settings-owner-rules.mjs');
const H=await import('../staff-settings-hub-rules.mjs');
const HV=await import('../staff-settings-hub.mjs');
const SR=await import('../staff-statement-review.mjs');
const OM=await import('../staff-owner-matrix.mjs');
const MA=await import('../staff-my-approvals.mjs');
const AF=await import('../staff-approvals-filter.mjs');
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');

const row=(o={})=>({map_id:'m1',account_code:'40100',account_name:'Fictional sales',account_statement:'Profit or loss',account_status:'Active',is_legacy:false,line_code:'PL.REV',line_label:'Revenue',line_statement:'Profit or loss',effective_from:'2026-01-01',proposed_by:null,open_line_code:null,open_from:null,drafts:1,...o});

test('statement review rules: consistent, unchanged and exceptions come only from the data',()=>{
 assert.equal(R.kindOf(row()),'consistent');
 assert.equal(R.kindOf(row({account_statement:'Statement of financial position',line_statement:'Financial position'})),'consistent');
 assert.equal(R.kindOf(row({account_statement:'Statement of financial position'})),'exception','a financial position account on a profit or loss line');
 assert.deepEqual(R.reasonsFor(row({account_statement:'Statement of financial position'})),['statement_mismatch']);
 assert.deepEqual(R.reasonsFor(row({is_legacy:true,account_statement:'Statement of financial position',line_statement:'Excluded'})),['legacy'],'a legacy account on an excluded line is one reason, not two');
 assert.deepEqual(R.reasonsFor(row({account_statement:'Statement of financial position',line_statement:'Excluded'})),['statement_mismatch']);
 assert.deepEqual(R.reasonsFor(row({account_status:'Draft'})),['account_draft']);
 assert.deepEqual(R.reasonsFor(row({drafts:2})),['several_drafts']);
 assert.deepEqual(R.reasonsFor(row({account_statement:null})),['statement_unknown'],'nothing is guessed for an account with no statement type');
 assert.deepEqual(R.reasonsFor(row({open_line_code:'PL.OTHER',open_from:'2025-01-01'})),['replaces_open']);
 assert.equal(R.kindOf(row({open_line_code:'PL.REV',open_from:'2025-01-01'})),'unchanged');
 const c=R.classify(row({account_status:'Draft'}));assert.equal(c.blocked,true);assert.equal(c.reasons[0].blocks,true);
 assert.equal(R.classify(row({is_legacy:true,account_statement:'Statement of financial position',line_statement:'Excluded'})).blocked,false);
});

test('statement review: groups by line, group checks, exception checks',()=>{
 const rows=[row({map_id:'a',line_code:'PL.REV'}),row({map_id:'b',account_code:'40200',line_code:'PL.REV'}),row({map_id:'c',account_code:'50100',line_code:'PL.COS',line_label:'Cost of sales'}),
  row({map_id:'d',is_legacy:true,account_statement:'Statement of financial position',line_statement:'Excluded',line_code:'EXC',line_label:'Excluded'}),row({map_id:'e',open_line_code:'PL.REV'}),row({map_id:'f',account_status:'Draft'})];
 const r=R.buildReview(rows);
 assert.deepEqual(r.summary,{total:6,consistent:3,unchanged:1,exceptions:2,blocked:1});
 assert.deepEqual(r.groups.map(g=>[g.line_code,g.count]),[['PL.REV',2],['PL.COS',1]]);
 assert.equal(R.checkGroupIds(['a','b'],rows).ok,true);
 assert.match(R.checkGroupIds(['a','d'],rows).message,/no longer in the consistent group/);
 assert.match(R.checkGroupIds(['zz'],rows).message,/no longer waiting/);assert.match(R.checkGroupIds([],rows).message,/at least one/);assert.match(R.checkGroupIds(['a','a'],rows).message,/more than once/);
 assert.match(R.checkGroupIds(Array.from({length:501},(_,i)=>'x'+i),rows).message,/at most 500/);
 assert.match(R.checkException(rows[3],'').message,/Say why/);assert.equal(R.checkException(rows[3],'A reason of some length').ok,true);
 assert.match(R.checkException(rows[5],'A reason of some length').message,/draft in the chart/,'a blocking reason cannot be approved');
 assert.equal(R.checkException(rows[0],'').ok,true,'a consistent mapping needs no reason');
});

test('statement review view: every account listed, approval needs a ticked acknowledgement, escaping, read-only for Managers',()=>{
 const r=R.buildReview([row({map_id:'a',account_name:'<b>x</b>'}),row({map_id:'d',is_legacy:true,account_statement:'Statement of financial position',line_statement:'Excluded',line_code:'EXC',line_label:'Excluded'})]);
 const v=SR.reviewView(r,{canApprove:true});
 assert.match(v,/data-stmt-ack="PL\.REV"/);assert.match(v,/data-suite="stmt-review-group"/);assert.match(v,/&lt;b&gt;x&lt;\/b&gt;/);assert.doesNotMatch(v,/<b>x<\/b>/);
 assert.match(v,/Legacy account/);assert.match(v,/data-stmt-note="d"/);assert.match(v,/id="stmtAckAll"/);
 const ro=SR.reviewView(r,{canApprove:false});assert.doesNotMatch(ro,/stmt-review-group|stmt-review-all|stmt-review-one/);assert.match(ro,/A Partner approves/);
 const big=SR.reviewView({...r,max_batch:1,groups:[{...r.groups[0],count:2,accounts:[r.groups[0].accounts[0],r.groups[0].accounts[0]]}]},{canApprove:true});assert.match(big,/id="stmtAckAll" disabled/);
});

test('statement review UI: nothing is sent until the reviewer ticks, and the payload is exactly the listed ids',async()=>{
 const sent=[],notes=[],checked={'[data-stmt-ack="PL.REV"]':false};
 globalThis.document={querySelector:s=>s in checked?{checked:checked[s]}:s.startsWith('[data-stmt-note')?{value:'Fictional reason for this one'}:s==='#stmtGroupNote'?{value:''}:null};
 const rv=R.buildReview([row({map_id:'a'}),row({map_id:'b',account_code:'40200'})]);
 const ui=SR.createStatementReviewUI({request:async p=>{sent.push(p);return p.action==='ledger_statement_map_review_read'?rv:{reviewed:2,status:'Approved'};},modal(){},notice:(m,e)=>notes.push([m,!!e]),data:()=>({me:{category_code:'PARTNER'}})});
 await ui.handle('stmt-review-open');sent.length=0;
 await ui.handle('stmt-review-group','PL.REV');assert.equal(sent.length,0,'no request without the tick');assert.equal(notes.at(-1)[1],true);
 checked['[data-stmt-ack="PL.REV"]']=true;
 await ui.handle('stmt-review-group','PL.REV');assert.deepEqual(sent[0],{action:'ledger_statement_map_review_approve',scope:'group',map_ids:['a','b'],review_note:''});
 assert.equal(await ui.handle('something-else'),false);
 delete globalThis.document;
});

test('owner rules: roles, sections, one pass, no guessed owners',()=>{
 assert.equal(O.SECTION_KEYS.length,21);assert.deepEqual(O.OWNER_ROLES.map(r=>r[0]),['PARTNER','TAX_LEAD','MANAGER','FINANCE','HR','SYSADMIN']);
 assert.equal(O.checkItems([{section_key:'approve_chart',owner_role:'PARTNER'}]).ok,true);
 for(const bad of [null,[],[{section_key:'x',owner_role:'PARTNER'}],[{section_key:'approve_chart',owner_role:'X'}],[{section_key:'approve_chart',owner_role:'PARTNER'},{section_key:'approve_chart',owner_role:'HR'}],[{section_key:'approve_chart',owner_role:'PARTNER',note:'a'}]])assert.equal(O.checkItems(bad).ok,false);
 assert.equal(O.checkItems([{section_key:'approve_chart',owner_role:'PARTNER',staff_id:'s1'}],()=>false).ok,false);
 assert.equal(O.checkItems(Array.from({length:31},()=>({section_key:'approve_chart',owner_role:'PARTNER'}))).ok,false);
 const m=O.ownerMatrix([{section_key:'approve_chart',owner_role:'MANAGER',confirmed_at:'2026-11-17T01:00:00Z'}]);
 assert.equal(m.find(r=>r.key==='approve_chart').confirmed.role_label,'Manager');assert.equal(m.find(r=>r.key==='approve_policies').confirmed,null);
 assert.equal(m.find(r=>r.key==='routing_maps').suggested_role,null);
 assert.equal(H.buildHub([]).note,H.OWNER_NOTE);
 assert.match(H.buildHub([],[{section_key:'approve_chart',owner_role:'PARTNER'}]).note,/1 of 16 sections/);
 assert.match(H.buildHub([],H.SECTIONS.map(s=>({section_key:s.key,owner_role:'PARTNER'}))).note,/every section/);
});

test('needs my action: waiting, mine to decide, and not prepared by me',()=>{
 const rec=(o={})=>({area:'routing_map',state:'Draft',native_status:'Draft',prepared_by:'Fictional MANAGER',...o});
 assert.equal(O.recordNeedsMe(rec(),'PARTNER','Fictional PARTNER',false),true);
 assert.equal(O.recordNeedsMe(rec(),'MANAGER','Fictional MANAGER',false),false,'a Manager does not approve a routing mapping');
 assert.equal(O.recordNeedsMe(rec({area:'service_template'}),'MANAGER','Fictional MANAGER',false),false,'never the person who prepared it');
 assert.equal(O.recordNeedsMe(rec({area:'service_template'}),'MANAGER','Fictional MGR2',false),true);
 assert.equal(O.recordNeedsMe(rec({state:'Active'}),'PARTNER','x',false),false);
 assert.equal(O.recordNeedsMe(rec({area:'tax_rate',prepared_by:null}),'MANAGER','x',false),false,'a Manager without the tax-rule right');
 assert.equal(O.recordNeedsMe(rec({area:'tax_rate',prepared_by:null}),'MANAGER','x',true),true);
 assert.equal(O.recordNeedsMe(rec({area:'tax_rate',native_status:'Rejected'}),'PARTNER','x',true),false);
 assert.equal(O.recordNeedsMe(rec(),'SUPERVISOR','x',true),false);
 assert.equal(O.queueNeedsMe('approve_statement_lines','MANAGER',false),false);assert.equal(O.queueNeedsMe('approve_statement_lines','PARTNER',false),true);
 assert.equal(O.queueNeedsMe('approve_tax_rates','MANAGER',true),true);assert.equal(O.queueNeedsMe('approve_tax_rates','PARTNER',false),false);
 assert.equal(O.queueNeedsMe('due_date_backlog','MANAGER',false),true);
});

test('My Approvals filters and views',()=>{
 const items=[
  {label:'Rule A',area_label:'Tax rules',state:'Draft',scope:'Firm-wide',owner_role:'TAX_LEAD',effective_from:'2026-01-01',needs_my_action:true,prepared_by:'Ann'},
  {label:'Map B',area_label:'Routing',state:'Draft',scope:'Fictional Client Ltd',owner_role:'PARTNER',effective_from:'2026-06-01',needs_my_action:false,prepared_by:'Bob'},
  {label:'Tpl C',area_label:'Templates',state:'Active',scope:'Firm-wide',owner_role:'PARTNER',effective_from:'2025-01-01',needs_my_action:false,prepared_by:null}];
 const n=f=>AF.filterApprovals(items,f).map(i=>i.label).join();
 assert.equal(n({}),'Rule A,Map B,Tpl C');assert.equal(n({mine:true}),'Rule A');assert.equal(n({state:'Active'}),'Tpl C');assert.equal(n({owner:'PARTNER'}),'Map B,Tpl C');
 assert.equal(n({scope:'firm'}),'Rule A,Tpl C');assert.equal(n({scope:'Fictional Client Ltd'}),'Map B');assert.equal(n({from:'2026-01-01'}),'Rule A,Map B');assert.equal(n({to:'2025-12-31'}),'Tpl C');assert.equal(n({q:'bob'}),'Map B');
 assert.equal(AF.visibleRecords(items,{}).length,2,'waiting records only by default');assert.equal(AF.visibleRecords(items,{state:'Active'}).length,1);assert.equal(AF.visibleRecords(items,{owner:'PARTNER'}).length,2);
 const data={note:'N',actionGroups:[{key:'approve_chart',waiting_count:3,actionable_count:2,blocked_count:1}],queues:[{key:'approve_policies',title:'<i>Policies</i>',count:1,owner_label:'',where:'Settings',needs_my_action:false}],records:items,scopes:['Fictional Client Ltd'],roles:[{code:'PARTNER',label:'Engagement Partner'}]};
 const v=MA.approvalsView(data,{...MA.FILTER_DEFAULT});
 assert.match(v,/id="apFilters"/);assert.match(v,/Chart of Accounts/);assert.match(v,/data-suite="ap-review" data-id="approve_chart"/);assert.match(v,/data-suite="ap-bulk-open"[^>]*disabled/);assert.doesNotMatch(v,/Policies/,'other approval queues stay collapsed under Other approval tasks');
 const all=MA.approvalsView(data,{...MA.FILTER_DEFAULT,mine:false});assert.match(all,/Policies/);assert.match(all,/&lt;i&gt;Policies/);
 assert.match(MA.recordsView([],{}),/No records match/);
});

test('Quick review drawer shows item details and requires an explicit review confirmation',()=>{
 const groups=[{key:'approve_tax_rates',items:[{id:'rate-1',revision:4,label:'VAT standard',code:'KE_VAT_STANDARD',kind:'VAT',effective_from:'2026-01-01',legal_citation:'Value Added Tax Act',source_url:'https://example.test/law',eligible:true}]}];
 const selected=new Map([['approve_tax_rates',new Set(['rate-1'])]]);
 const v=MA.drawerView(groups,selected);
 assert.match(v,/data-ap-selectall/);assert.match(v,/data-ap-item="approve_tax_rates\|rate-1" checked/);assert.match(v,/data-ap-confirm/);
 assert.match(v,/I confirm that I completed each applicable review above/);assert.match(v,/statutory basis, eligibility conditions and effective dates/);
 assert.match(v,/Value Added Tax Act/);assert.match(v,/Open official source/);
});

test('Owner Matrix view and diff: only changed rows are sent; Managers cannot confirm',()=>{
 const rows=O.ownerMatrix([{section_key:'approve_chart',owner_role:'PARTNER',confirmed_by_name:'Fictional P',confirmed_at:'2026-11-17T01:00:00Z'}]);
 const m={roles:O.OWNER_ROLES.map(([code,label])=>({code,label})),rows,confirmed:1,can_confirm:true,staff:[{staff_id:'s1',name:'<Staff>',category:'MANAGER'}]};
 const v=OM.matrixView(m);assert.match(v,/data-owner-role="approve_chart"/);assert.match(v,/Suggestion/);assert.match(v,/&lt;Staff&gt;/);assert.match(v,/data-suite="owners-confirm"/);assert.match(v,/1<\/b> of 21 sections/);
 assert.match(v,/<option value="TAX_LEAD" selected>/,'a suggested role is preselected but nothing is confirmed until the button');
 assert.doesNotMatch(OM.matrixView({...m,can_confirm:false}),/owners-confirm|data-owner-role/);
 assert.deepEqual(OM.ownerItems(rows,{approve_chart:{role:'PARTNER',staff_id:''},approve_policies:{role:'PARTNER',staff_id:''},kra_checks:{role:'',staff_id:''}}).map(i=>i.section_key),['approve_policies'],'unchanged and blank rows are not sent');
 assert.deepEqual(OM.ownerItems(rows,{approve_chart:{role:'MANAGER',staff_id:'s1'}}),[{section_key:'approve_chart',owner_role:'MANAGER',staff_id:'s1'}]);
});

test('hub rows: Open button, owner shown as confirmed or suggested, areas named',()=>{
 const h=H.buildHub([{section_key:'approve_statement_lines',pending:321,total:365}],[{section_key:'approve_chart',owner_role:'PARTNER',staff_name:null}]);
 const t=HV.tableView(h.sections);
 assert.match(t,/data-suite="hub-open" data-id="approve_statement_lines"/);assert.match(t,/\(suggested\)/);assert.match(t,/Go to the area/);
 assert.equal((t.match(/data-suite="hub-open"/g)||[]).length,16);
 assert.match(HV.waitingView(h),/data-suite="hub-open" data-id="approve_statement_lines"/);
 assert.equal(HV.ownerText(h.sections.find(s=>s.key==='approve_chart')),'Engagement Partner (confirmed)');
 const open=Object.fromEntries(H.SECTIONS.map(s=>[s.key,s.go]));
 assert.deepEqual(open.approve_statement_lines,{review:'statement'});assert.deepEqual(open.approve_tax_rates,{tab:'accounting'});assert.deepEqual(open.incoming_review,{view:'documents'});
});

test('wiring: suite handlers and cards, ledger screen, tokens, rights, access control, server wiring',()=>{
 const suite=rd('staff-suite.mjs');
 assert.match(suite,/staff-statement-review\.mjs\?v=20261118-approval-board-v1/);assert.match(suite,/staff-owner-matrix\.mjs\?v=20261117-actions-v1/);assert.match(suite,/staff-my-approvals\.mjs\?v=20261118-approval-board-v1/);
 assert.match(suite,/myApprovalsCard:myApprovals\.card\(\)/);assert.match(suite,/ownerMatrixCard:ownerMatrix\.card\(\)/);
 assert.match(suite,/settingsHub\.handle\(action,id\)/);assert.match(suite,/myApprovals\.handle\(action,id\)/);assert.match(suite,/ownerMatrix\.handle\(action,id\)/);assert.match(suite,/stmtReview\.handle\(action,id\)/);
 const layout=rd('staff-settings-layout.mjs');assert.match(layout,/myApprovalsCard:'overview'/);assert.match(layout,/ownerMatrixCard:'access'/);
 const ledger=rd('staff-ledger.mjs');assert.match(ledger,/data-suite=\\"stmt-review-open\\"|data-suite="stmt-review-open"/);assert.doesNotMatch(ledger,/btn\('statement-map-approve'/);
 assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261118-activate-v1/);assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261201-rnotes-v1/);
 for(const f of ['staff-rights-catalog.mjs',fx.slice(3)+'staff-rights-catalog.mjs'])assert.match(rd(f),/ledger_statement_map_review_read','ledger_statement_map_review_approve'/);
 assert.match(rd(fx.slice(3)+'staff-access-control.mjs'),/settings_owners_\|settings_approval\(\?:s\)\?_/);
 const idx=rd(fx.slice(3)+'index.ts');assert.match(idx,/settingsOwnerAction\(tx,a,p\)/);
 const ap=rd(fx.slice(3)+'annual-pack.ts');assert.match(ap,/ledger_statement_map_review_approve/);assert.match(ap,/decideMaps\(tx,a,ids,approve,note\)/);
 const mig=rd('supabase/migrations/20261117200000_settings_owners.sql');assert.match(mig,/FORCE ROW LEVEL SECURITY/);assert.match(mig,/no_delete/);assert.match(mig,/never edited/);assert.match(mig,/GRANT EXECUTE ON FUNCTION erp_private\.settings_register\(\) TO erp_api/);
 assert.equal(rd('staff-settings-hub-rules.mjs'),rd(fx.slice(3)+'settings-hub-rules.mjs'));
});
