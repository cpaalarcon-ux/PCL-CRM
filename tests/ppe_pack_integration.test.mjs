import test from 'node:test';import assert from 'node:assert/strict';
import {buildStatements} from '../supabase/functions/staff-workspace-v12/annual-pack-statements.mjs';
import {buildNotes,applyFaceRefs,canonicalNotes,notesState,notesCheck,noteTitle,NOTES_VERSION} from '../supabase/functions/staff-workspace-v12/annual-pack-notes.mjs';
import {packReadiness} from '../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs';
import {annualGate} from '../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs';
// Fictional figures only.
const L=(line_code,statement,section,label,sort_order,normal_side,note_ref=null)=>({line_code,statement,section,label,sort_order,normal_side,note_ref});
const lineDefs=[
 L('SFP.PPE','Financial position','Non-current assets','Property, plant and equipment',100,'Debit','PPE'),
 L('SFP.TRADE_REC','Financial position','Current assets','Trade receivables',220,'Debit','REC'),
 L('SFP.CASH','Financial position','Current assets','Cash and cash equivalents',270,'Debit','CASH'),
 L('SFP.SHARE_CAP','Financial position','Equity','Share capital',300,'Credit','EQUITY'),
 L('SFP.RETAINED','Financial position','Equity','Retained earnings',370,'Credit',null),
 L('SFP.TRADE_PAY','Financial position','Current liabilities','Trade payables',500,'Credit','PAY'),
 L('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit','REVENUE'),
 L('PL.COST_SALES','Profit or loss','Cost of sales','Cost of sales',1100,'Debit','INV'),
 L('PL.STAFF','Profit or loss','Operating costs','Staff costs',1300,'Debit','STAFF'),
 L('PL.OTHER_OPEX','Profit or loss','Operating costs','Other operating expenses',1330,'Debit','OPEX'),
 L('PL.FIN_COSTS','Profit or loss','Finance','Finance costs',1410,'Debit','FINANCE'),
 L('PL.TAX','Profit or loss','Tax','Income tax expense',1500,'Debit','TAX'),
 L('PL.UNRESOLVED','Profit or loss','Unresolved','Unresolved review items',1900,'Debit','UNRESOLVED')
];
const map=(account_code,line_code)=>({account_code,line_code,effective_from:'2020-01-01',effective_to:null,status:'Approved'});
const maps=[map('10000','SFP.CASH'),map('10060','SFP.TRADE_REC'),map('15005','SFP.PPE'),map('20000','SFP.TRADE_PAY'),map('30000','SFP.SHARE_CAP'),map('31000','SFP.RETAINED'),
 map('40000','PL.REVENUE'),map('50000','PL.COST_SALES'),map('60000','PL.STAFF'),map('60100','PL.OTHER_OPEX'),map('60110','PL.OTHER_OPEX'),map('70000','PL.FIN_COSTS'),map('80000','PL.TAX')];
const bs=(code,net)=>({code,name:'A'+code,opening:net,movement_debit:0,movement_credit:0,net});
const pl=(code,debit,credit)=>({code,name:'A'+code,opening:0,movement_debit:debit,movement_credit:credit,net:debit-credit});
const tb=()=>[bs('10000',500000),bs('10060',300000),bs('15005',700000),bs('20000',-130000),bs('30000',-100000),bs('31000',-1020000),
 pl('40000',0,1000000),pl('50000',400000,0),pl('60000',150000,0),pl('60100',60000,0),pl('60110',40000,0),pl('70000',20000,0),pl('80000',80000,0)];
const base={lineDefs,maps,startsOn:'2026-01-01',endsOn:'2026-12-31'};
const build=(over={})=>{const t=over.tb||tb(),s=buildStatements({...base,tb:t,...(over.st||{})});return {s,n:buildNotes({statements:s,lineDefs,tb:t,maps,asOf:'2026-12-31',...(over.nb||{})})};};

const sched={classes:[{account:'15005',name:'Motor vehicles',opening_cost:0,additions:700000,disposals:0,closing_cost:700000,opening_acc:0,charge:0,released:0,closing_acc:0,nbv:700000}],totals:{nbv:700000},policy:[],version:'ppe-register-v1'};
test('build 2881: the movement schedule sits under the property, plant and equipment note only, and an approved note is tied to it',()=>{
 const {n}=build({nb:{ppeSchedule:sched}});
 assert.deepEqual(n.notes.filter(x=>x.schedule).map(x=>x.ref),['PPE']);assert.equal(n.notes.find(x=>x.ref==='PPE').schedule.totals.nbv,700000);
 const plain=canonicalNotes(build().n.notes),withSched=canonicalNotes(n.notes);
 assert.notDeepEqual(plain,withSched,'the digest sees the schedule');assert.equal(withSched.find(x=>x.ref==='PPE').sc[0][0],'15005');
 const moved=canonicalNotes(build({nb:{ppeSchedule:{...sched,classes:[{...sched.classes[0],charge:5,closing_acc:5,nbv:699995}]}}}).n.notes);
 assert.notDeepEqual(withSched,moved,'a change in the register makes an approved note stale');
 assert.deepEqual(plain.find(x=>x.ref==='PPE').sc,undefined);
});
test('build 2881: the pack check for the register is left out when the year has no PPE, passes when ready, and blocks before review when not',()=>{
 const period={starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'};
 const run=ppe=>packReadiness({period,reporting:{},tb:tb(),maps,lines:lineDefs,issues:[],prior:{source:'Approved comparatives'},priorPeriodExists:true,asOf:'2026-12-31',ppe});
 assert.equal(run(null).checks.find(c=>c.code==='PPE_REGISTER'),undefined);
 assert.equal(run({relevant:false,ok:true,problems:[]}).checks.find(c=>c.code==='PPE_REGISTER'),undefined);
 assert.equal(run({relevant:true,ok:true,problems:[]}).checks.find(c=>c.code==='PPE_REGISTER').status,'Pass');
 const bad=run({relevant:true,ok:false,problems:['The register is out by the amounts shown against the trial balance on 1 line.']}).checks.find(c=>c.code==='PPE_REGISTER');
 assert.equal(bad.status,'Blocked');assert.match(bad.detail,/out by/);
 const gate=annualGate({gate:{checks:[]},pack:run({relevant:true,ok:false,problems:['x']}),statementProblems:[]});
 const g=gate.checks.find(c=>c.code==='A_PPE_REGISTER');assert.equal(g.ok,false);assert.equal(gate.failing.includes('A_PPE_REGISTER'),true);assert.equal(gate.ready_for_review,false,'a register that does not agree blocks review, not only the final step');
});
