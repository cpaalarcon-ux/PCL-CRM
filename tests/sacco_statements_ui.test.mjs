// Audit build S4: the SACCO statements screen, the action validators, the home model and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {saccoFsView,createSaccoUI,mapChoices,money,checkTone,supportTone,MOVE_KINDS,ROLE_LABELS} from '../staff-audit-sacco.mjs';
import {saccoStatementAction,STATEMENTS,KINDS,ROLES,MOVE_KINDS as SERVER_MOVE_KINDS} from '../supabase/functions/staff-workspace-v12/sacco-statement-actions.ts';
import {homeModel,sectionTabs,SECTIONS} from '../staff-audit-home.mjs';
import {createReportsUI} from '../staff-audit-reports.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const U1='11111111-1111-4111-8111-111111111111',U2='22222222-2222-4222-8222-222222222222',U3='33333333-3333-4333-8333-333333333333';
const L=(code,o={})=>({layout_id:'L1',line_code:code,statement:'Financial position',section:'Assets',caption:code,detail:'',kind:'Line',side:'Debit',total_of:[],roles:[],unit:null,auto_key:null,sort_order:1,...o});
const layout=(status='Approved',extra={})=>({layout_id:'L1',version:1,status,source_note:'Draft layout <source>',approved_by_name:status==='Approved'?'Pat Partner':null,approved_at:'2026-01-05T00:00:00Z',approval_note:'Read every caption',problem:null,
 lines:[L('A.CASH',{caption:'Cash <and> bank',sort_order:1}),L('A.TOTAL',{kind:'Total',side:null,total_of:['A.CASH'],roles:['TOTAL_ASSETS'],sort_order:2}),L('E.SHARE',{section:'Equity',side:'Credit',roles:['EQUITY_COLUMN'],sort_order:3,caption:'Share capital'}),L('S.MEMBERS',{statement:'Statistical',section:'Statistics',kind:'Statistic',side:null,unit:'Count',sort_order:4,caption:'Members'}),L('C.LEGAL',{statement:'Disclosure',section:'Section 10',kind:'Check',side:null,sort_order:5,caption:'Legal framework note'})],...extra});
const preview=(o={})=>({layout:'SACCO',entity:'Fictional <Mkopo> SACCO',period_end:'2025-12-31',framework:'IFRS for SMEs',framework_status:'Approved',layout_version:1,layout_status:'Approved',comparative_available:true,
 position:[{section:'Assets',lines:[{code:'A.CASH',caption:'Cash and bank',kind:'Line',current:3000000,comparative:2500000},{code:'A.ECL',caption:'Allowance for expected credit losses',kind:'Line',current:-400000,comparative:-300000},{code:'A.TOTAL',caption:'Total assets',kind:'Total',current:2600000,comparative:2200000}]}],
 income:[{section:'Result',lines:[{code:'P.SURPLUS',caption:'Surplus for the year',kind:'Total',current:400000,comparative:250000}]}],
 soce:{comparative_available:true,columns:[{code:'E.SHARE',caption:'Share capital'},{code:'E.RETAINED',caption:'Retained earnings'}],rows:[{key:'opening',label:'Balance at start of year',values:{'E.SHARE':1800000,'E.RETAINED':950000},total:2750000},{key:'surplus',label:'Surplus for the year',values:{'E.SHARE':0,'E.RETAINED':400000},total:400000},{key:'move',label:'Dividend on shares',values:{'E.SHARE':0,'E.RETAINED':-50000},total:-50000},{key:'closing',label:'Balance at end of year (trial balance)',values:{'E.SHARE':1800000,'E.RETAINED':1300000},total:3100000},{key:'difference',label:'Unexplained difference',values:{'E.SHARE':0,'E.RETAINED':0},total:0}]},
 statistics:[{code:'S.MEMBERS',caption:'Number of members at year end',unit:'Count',value:1250,source_note:'Members register',entered_by_name:'Sam'},{code:'S.NPL',caption:'Non-performing loans (gross amount)',unit:'KES',value:null}],
 ratios:[{label:'Fictional core capital to assets',comparator:'At least',threshold:'8',measure:'Percentage',value:'9.5',state:'Met'}],
 checks:[{code:'C.LEGAL',caption:'Legal framework note',detail:'A note naming the laws',status:'Open',applicable:true,note:'',support:null},{code:'C.DIVRES',caption:'Dividends and reserves',detail:'Agreed to the resolution',status:'Prepared',applicable:true,note:'Agreed to the minutes of the AGM',prepared_by:'a1',prepared_by_name:'Alex',support:{state:'attention',text:'Unexplained difference in a reserve: 5000.00; transfers net 0.00.'}},{code:'C.ECL',caption:'ECL against prudential',detail:'',status:'Reviewed',applicable:false,note:'Not a lender this year',prepared_by:'a1',reviewer_name:'Mia',review_note:'Agreed',support:{state:'ok',text:'Agree at 400000.00.'}}],
 totals:{difference:0},balances:true,blocking:[],warnings:[],note:'Draft prepared from the adjusted trial balance.',...o});
const work=(o={})=>({layout:layout(),draft:null,versions:[{layout_id:'L1',version:1,status:'Approved',approved_by_name:'Pat Partner',approval_note:'ok'}],accounts:[{audit_account_id:U1,account_code:'1000',account_name:'Cash at bank',audit_area:'Cash and bank',cur_net:3000000,cmp_net:2500000,line_code:'A.CASH',map_status:'Approved'},{audit_account_id:U2,account_code:'9000',account_name:'Suspense <x>',audit_area:'Cash and bank',cur_net:1000,cmp_net:null,line_code:null,map_status:null},{audit_account_id:U3,account_code:'1100',account_name:'Loans',audit_area:'Trade receivables',cur_net:8000000,cmp_net:7000000,line_code:'A.CASH',map_status:'Proposed',proposed_by_name:'Mo'}],
 moves:[{move_id:'m1',line_code:'E.RETAINED',kind:'Dividend on shares',amount:-50000,note:'AGM minute 4',status:'Active',entered_by:'a1',entered_by_name:'Alex'},{move_id:'m2',line_code:'E.SHARE',kind:'Other',amount:5000,note:'Mistake',status:'Withdrawn',withdraw_note:'Wrong reserve',entered_by:'a1'}],preview:preview(),...o});
const snap=(o={})=>({file:{audit_file_id:'f1',project_id:'pr',file_status:'Prepared',ends_on:'2025-12-31',reporting_framework:'IFRS for SMEs'},sacco:work(),...o});
const calls=[];
const ui=(me,s,extra={})=>createSaccoUI({esc,field:(n,l,v)=>`<input name="${n}" value="${esc(v)}">`,select:(n,l,o)=>`<select name="${n}">${(o||[]).map(x=>`<option>${Array.isArray(x)?x[0]:x}</option>`).join('')}</select>`,form:x=>x,modal:(...a)=>{calls.push({modal:a});},request:async a=>{calls.push({request:a});return {ok:true,saved:a.items?.length,status:'Proposed'};},notice:(m,bad)=>calls.push({notice:m,bad}),shortDate:v=>String(v||'').slice(0,10),data:()=>({me,documents:[]}),snapshot:()=>s,refresh:async()=>{},...extra});
const btn=(attrs)=>({dataset:Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),hasAttribute:n=>n in attrs});

test('helpers and the shared option lists',()=>{
 assert.equal(money(-1234.5),'(1,234.50)');assert.equal(money(0),'0.00');assert.equal(money(null),'—');assert.equal(money(''),'—');
 assert.equal(checkTone({status:'Reviewed'}),'ok');assert.equal(checkTone({status:'Prepared'}),'');assert.equal(checkTone({status:'Open'}),'warn');
 assert.equal(supportTone({state:'ok'}),'ok');assert.equal(supportTone({state:'attention'}),'warn');assert.equal(supportTone(null),'warn');
 const g=mapChoices(layout());assert.deepEqual(g.map(x=>x.section),['Assets','Equity']);assert.ok(!g.flatMap(x=>x.lines).some(l=>l.kind!=='Line'),'only lines can be mapped to');
 assert.deepEqual(MOVE_KINDS,SERVER_MOVE_KINDS,'screen and server list the same movement kinds');
 assert.deepEqual(Object.keys(ROLE_LABELS).sort(),[...ROLES].sort(),'screen and server list the same line roles');
 assert.ok(STATEMENTS.includes('Disclosure')&&KINDS.includes('Check'));
});

test('the statements view shows both years, brackets for negatives, the reserves and what blocks submission',()=>{
 const html=saccoFsView(preview({blocking:['2 accounts with balances are not mapped to a statement line: 1900 <Suspense>'],warnings:['No comparative trial balance.']}));
 assert.match(html,/Fictional &lt;Mkopo&gt; SACCO/);assert.match(html,/SACCO layout version 1 \(Approved\)/);assert.match(html,/Prior year/);
 assert.match(html,/\(400,000\.00\)/);assert.match(html,/<b>2,600,000\.00<\/b>/);
 assert.match(html,/Statement of changes in equity/);assert.match(html,/<th>Share capital<\/th><th>Retained earnings<\/th><th>Total<\/th>/);assert.match(html,/\(50,000\.00\)/);assert.match(html,/Unexplained difference/);
 assert.match(html,/What stops these statements being submitted/);assert.match(html,/1900 &lt;Suspense&gt;/);assert.doesNotMatch(html,/<Suspense>/);assert.match(html,/No comparative trial balance/);
 assert.match(html,/1,250/);assert.match(html,/not entered/);assert.match(html,/Prudential ratios/);assert.match(html,/Fictional core capital to assets/);assert.match(html,/Met/);
 assert.doesNotMatch(html,/does not balance/);
 const nocmp=saccoFsView(preview({comparative_available:false,soce:{...preview().soce,comparative_available:false}}));assert.doesNotMatch(nocmp,/<th>Prior year<\/th>/);assert.match(nocmp,/Opening balances need the comparative trial balance/);
 assert.match(saccoFsView(preview({balances:false})),/does not balance/);
 assert.match(saccoFsView(preview({ratios:[]})),/No prudential ratio is confirmed/);
 assert.equal(saccoFsView(null),'');
});

test('screen by role',()=>{
 const s=snap();
 let html=ui({staff_id:'a1',category_code:'ASSISTANT'},s).panel(s.file,s);
 assert.match(html,/data-sacco-map-save/);assert.match(html,/data-sacco-move-new/);assert.match(html,/data-sacco-move-withdraw="m1"/,'the enterer can withdraw');assert.doesNotMatch(html,/data-sacco-move-withdraw="m2"/,'a withdrawn movement has no button');
 assert.match(html,/data-sacco-stat="S.MEMBERS"/);assert.match(html,/data-sacco-check-prepare="C.LEGAL"/);assert.doesNotMatch(html,/data-sacco-check-review/,'an assistant never reviews');
 assert.doesNotMatch(html,/data-sacco-layout-copy|data-sacco-layout-approve|data-sacco-map-approve|data-sacco-line-new/);
 assert.match(html,/Waiting for another reviewer/);assert.match(html,/Suspense &lt;x&gt;/);assert.match(html,/Not mapped/);assert.match(html,/1 account with a balance is not mapped/);assert.match(html,/Proposed by Mo/);assert.match(html,/Not applicable/);
 assert.match(html,/Approved by Pat Partner/);assert.match(html,/Draft layout &lt;source&gt;/);
 html=ui({staff_id:'m1',category_code:'MANAGER'},s).panel(s.file,s);
 assert.match(html,/data-sacco-layout-copy/);assert.match(html,/data-sacco-check-review="C.DIVRES"/);assert.doesNotMatch(html,/data-sacco-map-approve|data-sacco-layout-approve/);
 html=ui({staff_id:'a1',category_code:'MANAGER'},s).panel(s.file,s);assert.doesNotMatch(html,/data-sacco-check-review/,'not the preparer');
 html=ui({staff_id:'p1',category_code:'PARTNER'},s).panel(s.file,s);assert.match(html,/data-sacco-map-approve/);assert.match(html,/Approve proposed \(1\)/);assert.doesNotMatch(html,/data-sacco-layout-approve/,'nothing to approve while the layout is approved and no draft exists');
 const d=snap({sacco:work({layout:layout('Draft'),draft:null})});
 html=ui({staff_id:'p1',category_code:'PARTNER'},d).panel(d.file,d);assert.match(html,/data-sacco-layout-approve="L1"/);assert.match(html,/data-sacco-line-edit="A.CASH"/);assert.match(html,/data-sacco-line-new="L1"/);assert.doesNotMatch(html,/data-sacco-layout-copy/);assert.match(html,/Not yet approved by a Partner/);
 html=ui({staff_id:'m1',category_code:'MANAGER'},d).panel(d.file,d);assert.match(html,/data-sacco-line-edit/);assert.doesNotMatch(html,/data-sacco-layout-approve/);assert.match(html,/A Partner approves it/);
 const withDraft=snap({sacco:work({draft:{...layout('Draft'),layout_id:'L2',version:2,problem:'Total X refers to a line that does not exist'}})});
 html=ui({staff_id:'p1',category_code:'PARTNER'},withDraft).panel(withDraft.file,withDraft);assert.match(html,/data-sacco-layout-approve="L2"/);assert.match(html,/Total X refers to a line that does not exist/);assert.doesNotMatch(html,/data-sacco-layout-copy/);
 const closed=snap({file:{...snap().file,file_status:'Approved'}});
 html=ui({staff_id:'a1',category_code:'ASSISTANT'},closed).panel(closed.file,closed);assert.doesNotMatch(html,/data-sacco-map-save|data-sacco-move-new|data-sacco-stat=|data-sacco-check-prepare/,'a closed file takes no changes');
 const none={file:snap().file,sacco:null};assert.match(ui({staff_id:'a1',category_code:'ASSISTANT'},none).panel(none.file,none),/This tab is for SACCO audit files/);
});

test('buttons call the right actions with the right input',async()=>{
 const s=snap(),file=s.file,me={staff_id:'m1',category_code:'MANAGER'};
 const run=async(attrs,m=me)=>{calls.length=0;const u=ui(m,s);const handled=await u.handle(btn(attrs),file);return {handled,call:calls[0]};};
 const fd=o=>{const f=new FormData();for(const [k,v] of Object.entries(o))Array.isArray(v)?v.forEach(x=>f.append(k,x)):f.append(k,v);return f;};
 let r=await run({'data-sacco-move-new':''});assert.equal(r.handled,true);assert.match(r.call.modal[0],/Record a movement in equity/);
 await r.call.modal[2](fd({line_code:'E.SHARE',kind:'Shares issued or redeemed',amount:'200000',note:'Share register'}));
 assert.deepEqual(calls.at(-1).request,{action:'audit_sacco_move_save',audit_file_id:'f1',line_code:'E.SHARE',kind:'Shares issued or redeemed',amount:'200000',note:'Share register'});
 r=await run({'data-sacco-stat':'S.MEMBERS'});await r.call.modal[2](fd({amount:'1260',note:'Register'}));
 assert.deepEqual(calls.at(-1).request,{action:'audit_sacco_value_save',audit_file_id:'f1',line_code:'S.MEMBERS',amount:'1260',note:'Register'});
 r=await run({'data-sacco-check-prepare':'C.LEGAL'});await r.call.modal[2](fd({applicable:'false',note:'Not required for this SACCO'}));
 assert.deepEqual(calls.at(-1).request,{action:'audit_sacco_check_prepare',audit_file_id:'f1',line_code:'C.LEGAL',applicable:false,note:'Not required for this SACCO'});
 r=await run({'data-sacco-check-review':'C.DIVRES'});await r.call.modal[2](fd({decision:'Return',note:'Add the AGM minute'}));
 assert.deepEqual(calls.at(-1).request,{action:'audit_sacco_check_review',audit_file_id:'f1',line_code:'C.DIVRES',decision:'Return',note:'Add the AGM minute'});
 r=await run({'data-sacco-move-withdraw':'m1'});await r.call.modal[2](fd({note:'Wrong reserve'}));assert.deepEqual(calls.at(-1).request,{action:'audit_sacco_move_withdraw',move_id:'m1',note:'Wrong reserve'});
 r=await run({'data-sacco-layout-approve':'L1'},{staff_id:'p1',category_code:'PARTNER'});await r.call.modal[2](fd({note:'Read every caption and total'}));assert.deepEqual(calls.at(-1).request,{action:'audit_sacco_layout_approve',layout_id:'L1',note:'Read every caption and total'});
 // Editing a draft line sends the whole line, with the totals split into codes and the roles collected.
 const d=snap({sacco:work({layout:layout('Draft')})});calls.length=0;const u=ui(me,d);
 await u.handle(btn({'data-sacco-line-edit':'A.TOTAL'}),d.file);
 await calls[0].modal[2](fd({line_code:'A.TOTAL',statement:'Financial position',section:'Assets',caption:'Total assets',detail:'',kind:'Total',side:'Debit',total_of:'A.CASH, A.PPE , -X.OTHER',unit:'KES',auto_key:'',sort_order:'2',role:['TOTAL_ASSETS']}));
 const sent=calls.at(-1).request;assert.equal(sent.action,'audit_sacco_layout_line_save');assert.equal(sent.layout_id,'L1');
 assert.deepEqual(sent.line,{line_code:'A.TOTAL',statement:'Financial position',section:'Assets',caption:'Total assets',detail:'',kind:'Total',side:null,total_of:['A.CASH','A.PPE','-X.OTHER'],roles:['TOTAL_ASSETS'],unit:null,auto_key:null,sort_order:'2'});
 // A button that is not ours is left alone.
 calls.length=0;assert.equal(await ui(me,s).handle(btn({'data-audit-pop-new':'f1'}),file),false);
 assert.equal(await ui(me,{file,sacco:null}).handle(btn({'data-sacco-move-new':''}),file),false);
});

test('the server validates every SACCO action before it reaches the database',async()=>{
 const sql=[];const tx=(parts,...v)=>{sql.push({text:parts.join('?'),v});return Promise.resolve([{r:{ok:true},id:'new-layout'}]);};tx.json=x=>JSON.stringify(x);
 const act=(role,p)=>saccoStatementAction(tx,{category_code:role},p);
 assert.equal(await act('MANAGER',{action:'audit_other'}),undefined,'other actions pass through');
 await assert.rejects(()=>act('ASSISTANT',{action:'audit_sacco_layout_copy'}),/Only a Manager or Partner/);
 assert.deepEqual(await act('MANAGER',{action:'audit_sacco_layout_copy'}),{ok:true,layout_id:'new-layout'});
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_layout_approve',layout_id:U1,note:'x'}),/Only a Partner/);
 await act('PARTNER',{action:'audit_sacco_layout_approve',layout_id:U1,note:'Checked'});
 await assert.rejects(()=>act('PARTNER',{action:'audit_sacco_layout_approve',layout_id:'nope'}),/Invalid record reference/);
 const line={line_code:'a.cash',statement:'Financial position',section:'Assets',caption:'Cash',kind:'Line',side:'Debit',sort_order:'10'};
 sql.length=0;await act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line});
 const saved=JSON.parse(sql[0].v[1]);assert.equal(saved.line_code,'A.CASH');assert.equal(saved.side,'Debit');assert.deepEqual(saved.total_of,[]);assert.equal(saved.sort_order,10);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line:{...line,kind:'Line',side:''}}),/Choose a valid option/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line:{...line,line_code:'cash'}}),/line code looks like/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line:{...line,roles:['MADE_UP']}}),/roles has an invalid entry/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line:{...line,kind:'Total',side:null,total_of:['A.CASH; drop table']}}),/total has an invalid entry/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line:{...line,sort_order:'1.5'}}),/whole number/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'audit_sacco_layout_line_save',layout_id:U1,line}),/Only a Manager or Partner/);
 sql.length=0;await act('MANAGER',{action:'audit_sacco_layout_line_save',layout_id:U1,line:{line_code:'S.MEMBERS',statement:'Statistical',section:'Statistics',caption:'Members',kind:'Statistic',unit:'Count',sort_order:5,side:'Debit',total_of:['X.Y']}});
 const stat=JSON.parse(sql[0].v[1]);assert.equal(stat.side,null,'a statistic has no side');assert.deepEqual(stat.total_of,[],'a statistic has no total');assert.equal(stat.unit,'Count');
 await assert.rejects(()=>act('ASSISTANT',{action:'audit_sacco_map_save',items:[]}),/between 1 and 300/);
 await assert.rejects(()=>act('ASSISTANT',{action:'audit_sacco_map_save',items:[{audit_account_id:'bad',line_code:'A.CASH'}]}),/Invalid record reference/);
 sql.length=0;await act('ASSISTANT',{action:'audit_sacco_map_save',items:[{audit_account_id:U1,line_code:'A.CASH'}]});assert.deepEqual(JSON.parse(sql[0].v[0]),[{audit_account_id:U1,line_code:'A.CASH'}]);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_map_approve',accounts:[U1]}),/Only a Partner/);
 sql.length=0;await act('PARTNER',{action:'audit_sacco_map_approve',accounts:[U1,U2]});assert.deepEqual(sql[0].v[0],[U1,U2]);
 sql.length=0;await act('MANAGER',{action:'audit_sacco_value_save',audit_file_id:U1,line_code:'S.NPL',amount:'1,250,000.50',note:'Loan ageing report'});assert.equal(sql[0].v[2],'1250000.50');
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_value_save',audit_file_id:U1,line_code:'S.NPL',amount:'-5',note:'n'}),/zero or more/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_value_save',audit_file_id:U1,line_code:'S.NPL',amount:'1e9',note:'n'}),/number of zero or more/);
 sql.length=0;await act('MANAGER',{action:'audit_sacco_move_save',audit_file_id:U1,line_code:'E.RETAINED',kind:'Dividend on shares',amount:'-50000',note:'AGM minute'});assert.equal(sql[0].v[3],'-50000');
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_move_save',audit_file_id:U1,line_code:'E.RETAINED',kind:'Bonus',amount:'5',note:'n'}),/Choose a valid option/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_move_save',audit_file_id:U1,line_code:'E.RETAINED',kind:'Other',amount:'5.123',note:'n'}),/at most two decimals/);
 sql.length=0;await act('ASSISTANT',{action:'audit_sacco_check_prepare',audit_file_id:U1,line_code:'C.AML',applicable:'false',note:'Not applicable here'});assert.equal(sql[0].v[2],false);
 sql.length=0;await act('ASSISTANT',{action:'audit_sacco_check_prepare',audit_file_id:U1,line_code:'C.AML',note:'Done and filed'});assert.equal(sql[0].v[2],true);
 await assert.rejects(()=>act('ASSISTANT',{action:'audit_sacco_check_review',audit_file_id:U1,line_code:'C.AML',decision:'Accept'}),/Only a Manager or Partner/);
 sql.length=0;await act('MANAGER',{action:'audit_sacco_check_review',audit_file_id:U1,line_code:'C.AML',decision:'Accept',note:''});assert.equal(sql[0].v[2],true);
 sql.length=0;await act('MANAGER',{action:'audit_sacco_check_review',audit_file_id:U1,line_code:'C.AML',decision:'Return',note:'Add evidence'});assert.equal(sql[0].v[2],false);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_check_review',audit_file_id:U1,line_code:'C.AML',decision:'Maybe'}),/Choose a valid option/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_sacco_nothing'}),/Unknown SACCO statements action/);
});

test('the home model: a SACCO tab with its own progress, blockers and role queue; other files are untouched',()=>{
 const base={file:{file_status:'Prepared',reporting_framework:'IFRS for SMEs'},readiness:{framework_approved:true,current_tb_confirmed:true,current_tb_balanced:true,all_lines_mapped:true,workpapers_resolved:true,completion_total:1,completion_reviewed:1},planning_gate:{materiality_approved:true,risks_open:1,fraud_risk_recorded:true,uncovered:[]}};
 const plain=homeModel(base,{category_code:'MANAGER',staff_id:'m1'});
 assert.ok(!plain.sections.flatMap(x=>x.tabs).includes('SACCO statements'),'no SACCO tab on an ordinary file');assert.ok(!plain.sections.flatMap(x=>x.items).some(i=>i.key==='sacco'||i.key==='sec10'));
 assert.ok(sectionTabs('papers',true).includes('SACCO statements'));assert.ok(!sectionTabs('papers',false).includes('SACCO statements'));
 const pv=preview({blocking:['The SACCO statement layout (version 1) is still a draft. A Partner must approve it.','3 mapped accounts are waiting for Partner approval of the mapping.','The statement of financial position does not balance. Total assets less total liabilities and equity is 5.'],
  checks:preview().checks});
 const s={...base,sasra:{eligible:true,ratios:[],issues:['The SACCO statement layout is not approved by a Partner.','Section 10 item not reviewed: Legal framework note.','Section 10 item not reviewed: Dividends and reserves.'],eqcr:{required:false},assembly:{anchor:'REPORT_DATE',days:60}},sacco:work({preview:pv})};
 const m=homeModel(s,{category_code:'PARTNER',staff_id:'p1'});
 const papers=m.sections.find(x=>x.key==='papers'),comp=m.sections.find(x=>x.key==='completion');
 assert.ok(papers.tabs.includes('SACCO statements'));assert.equal(papers.items.find(i=>i.key==='sacco').state,'todo');assert.match(papers.items.find(i=>i.key==='sacco').detail,/still a draft/);
 assert.equal(comp.items.find(i=>i.key==='sec10').state,'todo');assert.match(comp.items.find(i=>i.key==='sec10').detail,/1 of 3 reviewed/);
 const kinds=m.blockers.map(b=>b.kind);assert.ok(kinds.includes('sacco')&&kinds.includes('sacco10'));assert.ok(!kinds.includes('ratio'),'the layout and section-10 server issues are not mistaken for ratio problems');
 assert.equal(m.blockers.find(b=>b.kind==='sacco').action,'Approve the SACCO statement layout');assert.equal(m.blockers.find(b=>b.kind==='sacco').tab,'SACCO statements');
 assert.ok(m.blockers.some(b=>b.action==='Approve the proposed account mappings'));assert.ok(m.blockers.some(b=>b.action==='Fix the SACCO statements'&&/does not balance/.test(b.detail)));
 assert.equal(m.blockers.find(b=>b.kind==='sacco10').detail,'2 of 3 not yet reviewed.');
 assert.ok(m.focus.rows.some(r=>r.text==='Approve the proposed account mappings'&&r.tab==='SACCO statements'));
 const mgr=homeModel(s,{category_code:'MANAGER',staff_id:'m1'});assert.ok(mgr.focus.rows.some(r=>/Review section 10: Dividends and reserves/.test(r.text)));
 const own=homeModel(s,{category_code:'MANAGER',staff_id:'a1'});assert.ok(!own.focus.rows.some(r=>/Review section 10/.test(r.text)),'not your own item');
 const ready=homeModel({...s,sasra:{...s.sasra,issues:[]},sacco:work({preview:preview({checks:preview().checks.map(c=>({...c,status:'Reviewed'}))})})},{category_code:'PARTNER',staff_id:'p1'});
 assert.equal(ready.sections.find(x=>x.key==='papers').items.find(i=>i.key==='sacco').state,'done');assert.equal(ready.sections.find(x=>x.key==='completion').items.find(i=>i.key==='sec10').state,'done');
 assert.ok(SECTIONS.find(x=>x.key==='papers').tabs.includes('SACCO statements'));
});

test('wiring: migration, server, snapshot, tabs, report view and cache busters',()=>{
 const mig=rd('supabase/migrations/20261109254000_sacco_statements.sql');
 assert.match(mig,/ALTER FUNCTION erp_private\.audit_fs_calc\(uuid\) RENAME TO audit_fs_calc_standard/);assert.match(mig,/ALTER FUNCTION erp_private\.audit_report_basis\(uuid,text\) RENAME TO audit_report_basis_standard/);
 assert.match(mig,/CREATE TRIGGER sacco_report_guard BEFORE UPDATE OF status ON erp_private\.audit_reports/);assert.match(mig,/CREATE OR REPLACE FUNCTION erp_private\.sasra_signoff_issues/);
 assert.doesNotMatch(mig,/\b(\d{1,2}(\.\d+)?)\s*%\s*(of|capital)/i,'no regulatory percentage is written into the migration');
 const act=rd(fx+'audit-actions.ts');
 assert.match(act,/saccoStatementAction\(tx,a,p\)/);assert.match(act,/const sacco=await saccoWorkspace\(tx,file\.audit_file_id\)/);assert.match(act,/return \{sasra,sacco,pack,assembly,populations/);assert.match(act,/if\(!file\)return \{sacco:null,/);
 const aud=rd('staff-audit.mjs');
 assert.match(aud,/import \{createSaccoUI\} from '\.\/staff-audit-sacco\.mjs\?v=/);assert.match(aud,/activeTab==='SACCO statements'\?saccoStatements\.panel\(file,s\)/);assert.match(aud,/await saccoStatements\.handle\(b,selectedFile\(\)\)/);
 const rep=rd('staff-audit-reports.mjs');assert.match(rep,/import \{saccoFsView\} from '\.\/staff-audit-sacco\.mjs\?v=/);assert.match(rep,/if\(b\.layout==='SACCO'\)return saccoFsView\(b\)/);
 const rel=JSON.parse(rd(fx+'release.json')),buster=rd('staff-audit.mjs').match(/staff-audit-sacco\.mjs\?v=([\w-]+)/)[1];
 for(const f of ['staff-pilot.html','staff-pilot.mjs','staff-improvements.mjs','staff-pilot-auth.js','staff-audit.mjs','staff-audit-reports.mjs'])assert.ok(!/20261109-pop-v1/.test(rd(f)),f+' still has the old cache buster');
 assert.match(buster,/^20261109-assembly-v2$/);assert.match(rel.build||rel.label||JSON.stringify(rel),/2026-11-09\.1650/);
});

test('the Reports tab shows a SACCO version with the SACCO layout and a general version with the general one',()=>{
 const ctx={esc,field:(n)=>`<input name="${n}">`,select:(n)=>`<select name="${n}"></select>`,form:x=>x,modal(){},request(){},notice(){},shortDate:v=>String(v||'').slice(0,10),data:()=>({me:{staff_id:'p1',category_code:'PARTNER'}}),snapshot:()=>null,refresh(){}};
 const ui=createReportsUI(ctx),file={audit_file_id:'f1',file_status:'Prepared'};
 const rep=(body)=>({report_id:'r1',kind:'Financial statements',version_number:1,status:'Draft',prepared_by:'a1',prepared_by_name:'Alex',body,current:true});
 let html=ui.panel(file,{reports:[rep(preview())],report_status:[{kind:'Financial statements',required:true}],mgmt_points:[]});
 assert.match(html,/Statement of changes in equity/);assert.match(html,/SACCO layout version 1/);assert.match(html,/Share capital/);
 html=ui.panel(file,{reports:[rep({entity:'Ordinary Ltd',period_end:'2025-12-31',framework:'IFRS for SMEs',framework_status:'Approved',sections:[],totals:{},balances:true,note:'x'})],report_status:[{kind:'Financial statements',required:true}],mgmt_points:[]});
 assert.doesNotMatch(html,/Statement of changes in equity/);assert.match(html,/Ordinary Ltd/);
});
