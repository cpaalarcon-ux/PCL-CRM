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

test('notes are numbered in the order the lines appear on the statements, profit or loss first, and the number is written on the face',()=>{
 const {s,n}=build();
 assert.deepEqual(n.notes.map(x=>x.ref),['REVENUE','INV','STAFF','OPEX','FINANCE','TAX','PPE','REC','CASH','EQUITY','PAY']);
 assert.deepEqual(n.notes.map(x=>x.number),[1,2,3,4,5,6,7,8,9,10,11]);
 applyFaceRefs(s,n.face_refs);
 const r=(st,c)=>s[st].rows.find(x=>x.code===c);
 assert.equal(r('profit_or_loss','PL.REVENUE').note,1);assert.equal(r('financial_position','SFP.PPE').note,7);
 assert.equal(r('financial_position','SFP.RETAINED').note,undefined,'a line with no note family carries no reference');
});
test('a note analyses its caption by account and ties to the statements; two accounts on one line are both listed',()=>{
 const {n}=build(),o=n.notes.find(x=>x.ref==='OPEX').sections[0];
 assert.deepEqual(o.accounts.map(a=>[a.code,a.amount]),[['60100',-60000],['60110',-40000]],'costs carry the same negative sign as the face');
 assert.equal(o.total,-100000);assert.equal(o.face,-100000);
 assert.ok(n.notes.every(x=>x.ties));assert.deepEqual(n.problems,[]);
 const pay=n.notes.find(x=>x.ref==='PAY').sections[0];assert.equal(pay.total,130000,'a credit balance is shown positive on the face and in the note');
});
test('the note total uses the same sign as the face for costs',()=>{
 const {s,n}=build(),staff=n.notes.find(x=>x.ref==='STAFF').sections[0],face=s.profit_or_loss.rows.find(x=>x.code==='PL.STAFF');
 assert.equal(staff.total,face.current);assert.equal(staff.ties,true);
});
test('in thousands, each account is rounded and any difference to the caption is shown as a Rounding row, not hidden',()=>{
 const t=tb();t.push(pl('60110',0,0));t[t.findIndex(x=>x.code==='60100')]=pl('60100',60400,0);t[t.findIndex(x=>x.code==='60110')]=pl('60110',40400,0);
 const {n}=build({tb:t,st:{rounding:'Thousands'},nb:{rounding:'Thousands'}});
 assert.equal(n.unit_label,'KES thousands');
 const o=n.notes.find(x=>x.ref==='OPEX').sections[0];
 assert.deepEqual(o.accounts.map(a=>a.amount),[-60,-40]);assert.equal(o.total,-101);assert.equal(o.rounding,-1);assert.equal(o.ties,true);
});
test('a figure that differs from the face is reported as a problem and does not tie',()=>{
 const t=tb(),s=buildStatements({...base,tb:t});
 s.financial_position.rows.find(x=>x.code==='SFP.CASH').current+=5;
 const n=buildNotes({statements:s,lineDefs,tb:t,maps,asOf:'2026-12-31'});
 assert.equal(n.notes.find(x=>x.ref==='CASH').ties,false);assert.match(n.problems[0],/Cash and cash equivalents is 500,000 in the note and 500,005 on the statements/);
});
test('the equity note is titled for the legal form',()=>{
 assert.equal(noteTitle('EQUITY','Company'),noteTitle('EQUITY','Company'));
 assert.notEqual(noteTitle('EQUITY','Partnership'),noteTitle('EQUITY','Company'));
 assert.equal(noteTitle('UNRESOLVED'),null);
});
test('the digest content changes with any figure, account or number and not with wording elsewhere',()=>{
 const a=JSON.stringify(canonicalNotes(build().n.notes));
 const t=tb();t[0]=bs('10000',500001);
 assert.notEqual(a,JSON.stringify(canonicalNotes(build({tb:t}).n.notes)));
 assert.equal(a,JSON.stringify(canonicalNotes(build().n.notes)));
 assert.equal(NOTES_VERSION,'system-notes-v1');
});
test('the notes state compares an approval with the figures now',()=>{
 const ap={digest:'a'},dr={digest:'b'};
 assert.equal(notesState({approved:ap,draft:null,digestNow:'a'}).status,'approved');
 assert.equal(notesState({approved:ap,draft:dr,digestNow:'b'}).status,'draft','a new draft that matches the figures is what is waiting');
 assert.equal(notesState({approved:ap,draft:null,digestNow:'c'}).status,'stale');
 assert.equal(notesState({approved:null,draft:dr,digestNow:'c'}).status,'stale');
 assert.equal(notesState({approved:null,draft:null,digestNow:'c'}).status,'none');
});
test('the notes check passes only when the notes are approved, tie, and exist',()=>{
 assert.equal(notesCheck({state:{status:'approved'},count:3,problems:[]}).status,'Pass');
 for(const s of ['draft','stale','none'])assert.equal(notesCheck({state:{status:s},count:3,problems:[]}).status,'Blocked');
 assert.equal(notesCheck({state:{status:'approved'},count:0,problems:[]}).status,'Blocked');
 assert.match(notesCheck({state:{status:'approved'},count:3,problems:['Note 1 x']}).detail,/does not agree/);
});
test('the pack readiness carries the notes check only when notes are supplied, and the gate treats it as a final-stage step',()=>{
 const period={starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'};
 const run=notes=>packReadiness({period,reporting:{},tb:tb(),maps,lines:lineDefs,issues:[],prior:{source:'Approved comparatives'},priorPeriodExists:true,asOf:'2026-12-31',notes});
 assert.equal(run(null).checks.find(c=>c.code==='NOTES_APPROVED'),undefined);
 const c=run({state:{status:'draft'},count:11,problems:[]}).checks.find(x=>x.code==='NOTES_APPROVED');
 assert.equal(c.status,'Blocked');
 assert.equal(run({state:{status:'approved'},count:11,problems:[]}).checks.find(x=>x.code==='NOTES_APPROVED').status,'Pass');
 assert.equal(typeof annualGate,'function');
});
