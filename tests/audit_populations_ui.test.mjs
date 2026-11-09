// Audit build S5: screen, home model and wiring for populations.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {collectPopulation,suggestNature,stateTone,createPopulationsUI,POPULATION_AREAS,BALANCE_NATURES} from '../staff-audit-populations.mjs';
import {homeModel,sectionOf} from '../staff-audit-home.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pop=(o={})=>({population_id:'p1',pop_ref:'POP-001',audit_area:'Trade payables',title:'Supplier <ledger>',source_system:'ERP',report_name:'Balances',parameters:'All suppliers',as_at:'2025-12-31',report_run_on:'2026-01-20',row_count:1400,control_total:'1000000',balance_nature:'Credit',reconciling_amount:'0',reconciling_note:'',ipe_check:'Re-performed totals',evidence_file_name:null,status:'Draft',prepared_by:'a1',prepared_by_name:'Asha',review_note:'',gl_balance:'1000000',residual:'0',state:'Ties',...o});
const lead=(area,adj,active=true)=>({audit_area:area,active,adjusted_net:adj,lead:null});
const snap=(o={})=>({file:{audit_file_id:'f1',project_id:'pr',file_status:'Prepared',ends_on:'2025-12-31'},populations:[],population_policy:{areas:[],confirmed:false},lead_schedule:[lead('Trade payables','-1000000'),lead('Cash and bank','2000000')],...o});
const ui=(me,s)=>createPopulationsUI({esc,field:(n)=>`<input name="${n}">`,select:(n)=>`<select name="${n}"></select>`,form:x=>x,modal(){},request(){},notice(){},shortDate:v=>String(v||'').slice(0,10),data:()=>({me,documents:[]}),snapshot:()=>s,refresh(){}});

test('helpers',()=>{
 assert.deepEqual(BALANCE_NATURES,['Debit','Credit']);
 assert.equal(suggestNature('-5'),'Credit');assert.equal(suggestNature('5'),'Debit');assert.equal(suggestNature('0'),'Debit');
 assert.equal(stateTone('Ties'),'ok');assert.equal(stateTone('Difference'),'warn');assert.equal(stateTone('Needs note'),'warn');assert.equal(stateTone('Reconciled with note'),'');
 const c=collectPopulation({audit_area:' Trade payables ',title:' T ',row_count:'10',control_total:'1,000',evidence_document_id:''});
 assert.equal(c.audit_area,'Trade payables');assert.equal(c.title,'T');assert.equal(c.evidence_document_id,null);assert.equal(c.reconciling_amount,'');
});

test('screen by role',()=>{
 const s=snap({populations:[pop(),pop({population_id:'p2',pop_ref:'POP-002',audit_area:'Cash and bank',status:'Submitted',prepared_by:'a2',state:'Reconciled with note',reconciling_amount:'-100',reconciling_note:'Cheques not yet presented at year end'}),pop({population_id:'p3',pop_ref:'POP-003',status:'Withdrawn',state:'Withdrawn',review_note:'Wrong report used'})]});
 let html=ui({staff_id:'a1',category_code:'ASSISTANT'},s).panel(s.file,s);
 assert.match(html,/data-audit-pop-new="f1"/);assert.match(html,/data-audit-pop-edit="p1"/);assert.match(html,/data-audit-pop-submit="p1"/);assert.match(html,/data-audit-pop-withdraw="p1"/);
 assert.doesNotMatch(html,/data-audit-pop-review/);assert.doesNotMatch(html,/data-audit-pop-edit="p2"/);assert.match(html,/Supplier &lt;ledger&gt;/);assert.match(html,/Withdrawn · 1/);assert.match(html,/Wrong report used/);
 assert.doesNotMatch(html,/data-audit-pop-policy/);assert.match(html,/Default — not yet confirmed by a Partner/);assert.match(html,/No area is required/);
 html=ui({staff_id:'m1',category_code:'MANAGER'},s).panel(s.file,s);
 assert.match(html,/data-audit-pop-review="p2"/);assert.match(html,/data-audit-pop-edit="p1"/,'a Manager can edit anyone\'s draft');
 html=ui({staff_id:'a2',category_code:'MANAGER'},s).panel(s.file,s);assert.doesNotMatch(html,/data-audit-pop-review="p2"/,'not the preparer');
 html=ui({staff_id:'p1',category_code:'PARTNER'},s).panel(s.file,s);assert.match(html,/data-audit-pop-policy/);
 html=ui({staff_id:'i1',category_code:'INTERN'},s).panel(s.file,s);assert.doesNotMatch(html,/data-audit-pop-new/);
 const closed=snap({populations:[pop({status:'Approved',reviewer_name:'M'})],file:{audit_file_id:'f1',project_id:'pr',file_status:'Approved',ends_on:'2025-12-31'}});
 html=ui({staff_id:'m1',category_code:'MANAGER'},closed).panel(closed.file,closed);assert.doesNotMatch(html,/data-audit-pop-reopen|data-audit-pop-new/);
 const approved=snap({populations:[pop({status:'Approved'})]});
 html=ui({staff_id:'m1',category_code:'MANAGER'},approved).panel(approved.file,approved);assert.match(html,/data-audit-pop-reopen="p1"/);
});

test('differences and required areas are named plainly',()=>{
 const s=snap({population_policy:{areas:['Cash and bank','Trade payables'],confirmed:true,confirmed_by_name:'Pat',note:'Firm decision'},populations:[pop({state:'Difference',residual:'-5000'})]});
 const html=ui({staff_id:'m1',category_code:'MANAGER'},s).panel(s.file,s);
 assert.match(html,/Difference \(5,000\.00\)/);assert.match(html,/Confirmed by Pat: Firm decision/);
 assert.match(html,/Areas with a balance and no population/);assert.match(html,/Cash and bank<small> · adjusted balance 2,000,000\.00/);assert.match(html,/Required/);
});

test('home model: required, unreconciled, draft and submitted populations block with a plain message',()=>{
 const base={file:{file_status:'In Review',reporting_framework:'IFRS',ends_on:'2025-12-31'},readiness:{framework_approved:true,current_tb_confirmed:true,current_tb_balanced:true,all_lines_mapped:true,workpapers_resolved:true,completion_total:1,completion_reviewed:1},planning_gate:{materiality_approved:true,risks_open:1,fraud_risk_recorded:true,uncovered:[]},workpapers:[{status:'Approved'}],completion:[{status:'Reviewed'}],lead_schedule:[lead('Trade payables','-1'),lead('Cash and bank','1')]};
 let m=homeModel({...base,population_policy:{areas:['Trade payables']},populations:[]},{category_code:'PARTNER',staff_id:'p'});
 let b=m.blockers.filter(x=>x.kind==='population');
 assert.equal(b.length,1);assert.match(b[0].action,/Record the trade payables population/);assert.equal(b[0].tab,'Populations');
 assert.equal(m.sections.find(s=>s.key==='papers').items.find(i=>i.key==='populations').state,'todo');
 m=homeModel({...base,populations:[pop({state:'Difference',residual:'-5000',status:'Approved'})]},{category_code:'PARTNER',staff_id:'p'});
 b=m.blockers.filter(x=>x.kind==='population');
 assert.match(b[0].action,/Reconcile population POP-001/);assert.match(b[0].detail,/differs from the adjusted trial balance by -5000/);
 assert.equal(m.sections.find(s=>s.key==='papers').items.find(i=>i.key==='populations').state,'blocked');
 m=homeModel({...base,populations:[pop(),pop({population_id:'p2',pop_ref:'POP-002',audit_area:'Cash and bank',status:'Submitted'})]},{category_code:'MANAGER',staff_id:'m1'});
 assert.deepEqual(m.blockers.filter(x=>x.kind==='population').map(x=>x.action),['Submit or withdraw population POP-001','Review population POP-002']);
 assert.ok(m.focus.rows.some(r=>/Review population POP-002/.test(r.text)));
 m=homeModel({...base,populations:[pop()]},{category_code:'ASSISTANT',staff_id:'a1'});
 assert.ok(m.focus.rows.some(r=>/POP-001 · draft, not submitted/.test(r.text)));
 m=homeModel({...base,population_policy:{areas:['Trade payables']},populations:[pop({status:'Approved'})]},{category_code:'PARTNER',staff_id:'p'});
 assert.equal(m.blockers.filter(x=>x.kind==='population').length,0);assert.equal(m.sections.find(s=>s.key==='papers').items.find(i=>i.key==='populations').state,'done');
 m=homeModel({...base,populations:[pop({status:'Withdrawn',state:'Withdrawn'})]},{category_code:'PARTNER',staff_id:'p'});
 assert.equal(m.blockers.filter(x=>x.kind==='population').length,0,'withdrawn populations are ignored');
 assert.equal(sectionOf('Populations'),'papers');
});

test('wiring: actions, snapshot, areas and migration agree',()=>{
 const ts=rd(fx+'audit-actions.ts'),sql=rd('supabase/migrations/20261109253000_audit_populations.sql');
 for(const a of ['audit_population_save','audit_population_submit','audit_population_review','audit_population_withdraw','audit_population_reopen','audit_population_policy_save'])assert.match(ts,new RegExp(a));
 assert.match(ts,/populations,population_policy/);assert.match(ts,/populations:\[\],population_policy:null/);
 assert.match(ts,/Only a Partner can set which audit areas need a population/);
 const m=[...ts.match(/POPULATION_AREAS=\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
 assert.deepEqual(m,POPULATION_AREAS,'the server list and the screen list match');
 for(const a of POPULATION_AREAS)assert.ok(sql.includes(`'${a}'`),a+' is in the migration list');
 const au=rd('staff-audit.mjs');assert.match(au,/populations\.handle\(b/);assert.match(au,/activeTab==='Populations'/);
 for(const f of ['audit_population_save','audit_population_submit','audit_population_review','audit_population_withdraw','audit_population_reopen','audit_population_policy_save'])assert.match(sql,new RegExp('GRANT EXECUTE ON FUNCTION[^;]*'+f));
});
