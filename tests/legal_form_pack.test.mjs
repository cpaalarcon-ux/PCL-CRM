// Build 2870: the annual statements follow the client's legal form. Fictional figures only. Three structures on one account list:
// a limited company, a partnership and a sole proprietor.
import test from 'node:test';import assert from 'node:assert/strict';
const LF=await import('../supabase/functions/staff-workspace-v12/annual-pack-legal-form.mjs');
const {buildStatements}=await import('../supabase/functions/staff-workspace-v12/annual-pack-statements.mjs');
const {buildEquityStatement,buildCashFlow}=await import('../supabase/functions/staff-workspace-v12/annual-pack-flows.mjs');
const R=await import('../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs');
const {annualGate}=await import('../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs');
const {reportGate,sourceChecks,totalsTie,signOffCheck,monthsBetween}=await import('../supabase/functions/staff-workspace-v12/report-gate-rules.mjs');

const L=(line_code,statement,section,label,sort_order,normal_side,cash_flow_class='None')=>({line_code,statement,section,label,sort_order,normal_side,cash_flow_class});
const lineDefs=[
 L('SFP.PPE','Financial position','Non-current assets','Property, plant and equipment',100,'Debit','Investing'),
 L('SFP.CASH','Financial position','Current assets','Cash and cash equivalents',270,'Debit','Cash'),
 L('SFP.SHARE_CAP','Financial position','Equity','Share capital',300,'Credit','Equity'),
 L('SFP.OWNER_CAP','Financial position','Equity','Owner or partner capital',320,'Credit','Equity'),
 L('SFP.OWNER_CUR','Financial position','Equity','Partner current accounts',330,'Credit','Equity'),
 L('SFP.DRAWINGS','Financial position','Equity','Drawings',340,'Debit','Equity'),
 L('SFP.RETAINED','Financial position','Equity','Retained earnings',370,'Credit','Equity'),
 L('SFP.TRADE_PAY','Financial position','Current liabilities','Trade payables',500,'Credit','Operating'),
 L('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit','Operating'),
 L('PL.COST_SALES','Profit or loss','Cost of sales','Cost of sales',1100,'Debit','Operating'),
 L('PL.OTHER_OPEX','Profit or loss','Operating costs','Other operating expenses',1330,'Debit','Operating'),
 L('PL.TAX','Profit or loss','Tax','Income tax expense',1500,'Debit','Operating'),
 L('PL.UNRESOLVED','Profit or loss','Unresolved','Unresolved review items',1900,'Debit')
];
const ap=(account_code,line_code)=>({account_code,line_code,effective_from:'2020-01-01',effective_to:null,status:'Approved'});
const maps=[ap('10000','SFP.CASH'),ap('15005','SFP.PPE'),ap('20000','SFP.TRADE_PAY'),ap('30000','SFP.SHARE_CAP'),ap('31000','SFP.RETAINED'),ap('35000','SFP.OWNER_CAP'),ap('36010','SFP.OWNER_CUR'),ap('36020','SFP.DRAWINGS'),
 ap('40000','PL.REVENUE'),ap('50000','PL.COST_SALES'),ap('60100','PL.OTHER_OPEX'),ap('80000','PL.TAX')];
const bs=(code,net)=>({code,name:'A'+code,opening:net,movement_debit:0,movement_credit:0,net});
const pl=(code,debit,credit)=>({code,name:'A'+code,opening:0,movement_debit:debit,movement_credit:credit,net:debit-credit});
// Each structure balances: assets 800,000 = capital + liabilities + profit 300,000 (revenue 1,000,000 less cost 600,000 less expenses 100,000).
const TB={
 company:[bs('10000',500000),bs('15005',300000),bs('20000',-100000),bs('30000',-100000),bs('31000',-400000),pl('40000',0,1000000),pl('50000',600000,0),pl('60100',100000,0)],
 partnership:[bs('10000',500000),bs('15005',300000),bs('20000',-100000),bs('35000',-300000),bs('36010',-100000),pl('40000',0,1000000),pl('50000',600000,0),pl('60100',100000,0)],
 proprietor:[bs('10000',500000),bs('15005',300000),bs('20000',-100000),bs('35000',-400000),pl('40000',0,1000000),pl('50000',600000,0),pl('60100',100000,0)]
};
const build=(tb)=>{const base={lineDefs,maps,tb,asOf:'2026-12-31'};const st=buildStatements({...base,startsOn:'2026-01-01',endsOn:'2026-12-31'});st.changes_in_equity=buildEquityStatement(base);st.cash_flow=buildCashFlow(base);return st;};
const label=(st,code)=>st.financial_position.rows.find(r=>r.code===code)?.label;

test('the form comes from the client record; non-profit and other entities keep the general captions',()=>{
 assert.equal(LF.formOf('Limited company'),'Company');assert.equal(LF.formOf('Partnership'),'Partnership');assert.equal(LF.formOf('Sole proprietor'),'Sole proprietor');
 assert.equal(LF.formOf('Non-profit organisation'),'Other');assert.equal(LF.formOf('Other legal entity'),'Other');assert.equal(LF.formOf(null),'Other');assert.equal(LF.formOf(''),'Other');
});
test('company: company captions, and a partner or owner account on a company is reported',()=>{
 const st=LF.applyCaptions(build(TB.company),'Company');
 assert.equal(st.changes_in_equity.title,'Statement of changes in equity');assert.equal(label(st,'SFP.SHARE_CAP'),'Share capital');assert.equal(label(st,'SFP.RETAINED'),'Retained earnings');
 assert.equal(st.changes_in_equity.current.rows.find(r=>r.move==='DIVIDENDS_DRAWINGS').label,'Dividends declared');
 const used=LF.usedLineCodes({tb:TB.company,maps,asOf:'2026-12-31'});assert.deepEqual(LF.misfits('Company',used),[]);
 const bad=LF.usedLineCodes({tb:[...TB.company,bs('36020',1000)],maps,asOf:'2026-12-31'});
 assert.equal(LF.misfits('Company',bad,c=>c)[0].code,'SFP.DRAWINGS');assert.match(LF.misfits('Company',bad)[0].reason,/does not belong on a company/);
});
test('partnership: partners\' captions throughout, and company accounts are reported',()=>{
 const st=LF.applyCaptions(build(TB.partnership),'Partnership');
 assert.equal(st.changes_in_equity.title,"Statement of changes in partners' equity");assert.equal(label(st,'SFP.OWNER_CAP'),"Partners' capital accounts");assert.equal(label(st,'SFP.OWNER_CUR'),"Partners' current accounts");
 assert.equal(label(st,'SFP.CURRENT_PROFIT'),'Profit for the year, to be allocated to partners');
 const total=st.profit_or_loss.rows.at(-1);assert.equal(total.label,'Profit for the year available to partners');assert.equal(total.current,300000);
 const cols=st.changes_in_equity.current.columns.map(c=>c.label);assert(cols.includes("Partners' capital accounts")&&cols.includes("Partners' current accounts"));
 assert.equal(st.changes_in_equity.current.rows.find(r=>r.move==='DIVIDENDS_DRAWINGS').label,'Drawings by partners');
 assert.equal(st.legal_form,'Partnership');
 // figures are never touched by captions
 assert.equal(st.financial_position.assets.current,800000);assert.equal(st.checks.balanced,true);
 const used=LF.usedLineCodes({tb:TB.company,maps,asOf:'2026-12-31'}),bad=LF.misfits('Partnership',used);
 assert.deepEqual(bad.map(b=>b.code),['PL.TAX'].filter(()=>false).concat(['SFP.RETAINED','SFP.SHARE_CAP']));
 assert(bad.every(b=>/company account/.test(b.reason)));
 const tax=LF.misfits('Partnership',new Set(['PL.TAX']));assert.match(tax[0].reason,/not taxed on its own account/);
});
test('sole proprietor: owner captions, no directors or share capital wording',()=>{
 const st=LF.applyCaptions(build(TB.proprietor),'Sole proprietor');
 assert.equal(st.changes_in_equity.title,"Statement of changes in owner's equity");assert.equal(label(st,'SFP.OWNER_CAP'),"Owner's capital");assert.equal(label(st,'SFP.CURRENT_PROFIT'),'Profit for the year attributable to the owner');
 assert.equal(st.changes_in_equity.current.rows.find(r=>r.move==='DIVIDENDS_DRAWINGS').label,'Drawings by the owner');
 assert.equal(st.profit_or_loss.rows.at(-1).label,'Profit for the year attributable to the owner');
 const text=[...JSON.stringify(st).matchAll(/"(?:label|title)":"([^"]*)"/g)].map(m=>m[1]).join(' | ');assert.doesNotMatch(text,/Share capital|Retained earnings|Dividend|director|Partner/i);
 assert.match(LF.misfits('Sole proprietor',new Set(['PL.TAX']))[0].reason,/owner's tax is personal/);
});
test('other forms keep the general captions and are not blocked',()=>{
 const st=LF.applyCaptions(build(TB.company),'Other');assert.equal(st.legal_form,undefined);assert.equal(st.changes_in_equity.title,'Statement of changes in equity');
 assert.equal(LF.legalFormCheck({form:'Other',legalEntityType:'Non-profit organisation',used:new Set()}).status,'Info');
});

const lines=lineDefs.map(d=>({line_code:d.line_code,statement:d.statement}));
const reporting=R.defaultReporting('2026-01-01');
const ready=(legalEntityType,tb,shares={status:'none'})=>R.packReadiness({period:{starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'},reporting,tb,maps,lines,issues:[],prior:{source:'Prior-year ledger'},priorPeriodExists:true,asOf:'2026-12-31',legal:{legalEntityType,shares}});
const code=(g,c)=>g.checks.find(x=>x.code===c);
test('readiness: legal-form check passes, blocks a misfit, blocks a missing structure; a partnership needs its profit shares',()=>{
 assert.equal(code(ready('Limited company',TB.company),'LEGAL_FORM').status,'Pass');assert.equal(code(ready('Limited company',TB.company),'PARTNER_SHARES'),undefined);
 const wrong=ready('Partnership',TB.company);assert.equal(code(wrong,'LEGAL_FORM').status,'Blocked');assert.match(code(wrong,'LEGAL_FORM').detail,/company account/);
 assert.equal(code(ready(null,TB.company),'LEGAL_FORM').status,'Blocked');assert.match(code(ready(null,TB.company),'LEGAL_FORM').detail,/no legal structure/);
 const p=ready('Partnership',TB.partnership);assert.equal(code(p,'LEGAL_FORM').status,'Pass');assert.equal(code(p,'PARTNER_SHARES').status,'Blocked');assert.match(code(p,'PARTNER_SHARES').detail,/partnership deed/);
 assert.equal(code(ready('Partnership',TB.partnership,{status:'recorded'}),'PARTNER_SHARES').status,'Pass');
 assert.equal(code(ready('Sole proprietor',TB.proprietor),'PARTNER_SHARES'),undefined);
 // callers that give no client information are unchanged
 const old=R.packReadiness({period:{starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'},reporting,tb:TB.company,maps,lines,issues:[],prior:{source:'x'},priorPeriodExists:true,asOf:'2026-12-31'});assert.equal(code(old,'LEGAL_FORM'),undefined);
});
test('the annual gate stops the final statements on a legal-form problem, and ignores the checks when they are not reported',()=>{
 const months=monthsBetween('2026-01-01','2026-12-31');
 const facts={imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-01-01',ends_on:'2026-12-31'}],batches:[{dataset:'Purchases',period_start:'2026-01-01',period_end:'2026-12-31',rows:90,unmapped:0},{dataset:'Bank',period_start:'2026-01-01',period_end:'2026-12-31',rows:12,unmapped:0},{dataset:'Payroll',period_start:'2026-01-01',period_end:'2026-12-31',rows:12,unmapped:0}],declarations:[]};
 const g0=()=>{try{return reportGate({sources:sourceChecks({months,facts}),unmapped:{count:0},postedJournals:30,draftJournals:0,tbTotals:{debit:5000,credit:5000},reportedTotals:{sales:4000,profit_before_tax:900,profit_after_tax:900},tie:totalsTie({tb:[{code:'40000',net:-4000},{code:'51000',net:3100},{code:'10000',net:900}],reportedProfit:900,yearClosed:false}),issues:[],signOff:signOffCheck({review:{status:'Approved',prepared_by:'a',reviewed_by:'b'},digestOk:true})});}catch(e){return null;}};
 const gate=g0();assert.ok(gate,'the base gate fixture builds');
 const pack=extra=>({checks:['REPORTING_BASIS','MAP_APPROVED','NO_LEGACY','NO_UNRESOLVED','COMPARATIVES',...extra.map(e=>e[0])].map(c=>({code:c,label:c,status:(extra.find(e=>e[0]===c)||[])[1]||'Pass',detail:'x'}))});
 const base=annualGate({gate,pack:pack([]),statementProblems:[]});
 const withLegal=annualGate({gate,pack:pack([['LEGAL_FORM','Pass']]),statementProblems:[]});assert.equal(withLegal.checks.length,base.checks.length+1);
 assert(annualGate({gate,pack:pack([['LEGAL_FORM','Blocked']]),statementProblems:[]}).failing.includes('A_LEGAL_FORM'));
 assert(annualGate({gate,pack:pack([['LEGAL_FORM','Pass'],['PARTNER_SHARES','Blocked']]),statementProblems:[]}).failing.includes('A_PARTNER_SHARES'));
 assert.equal(annualGate({gate,pack:pack([['LEGAL_FORM','Info']]),statementProblems:[]}).checks.length,base.checks.length);
});
