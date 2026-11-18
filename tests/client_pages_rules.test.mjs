import test from 'node:test';import assert from 'node:assert/strict';
const M=await import('../supabase/functions/staff-workspace-v12/annual-pack-client-pages.mjs');
const period={starts_on:'2026-01-01',ends_on:'2026-12-31'};
const row=(kind,label,current,prior=null,code=null)=>({kind,label,code,current,prior});
const statements={presentation:{unit_label:'KES'},
 profit_or_loss:{rows:[row('heading','Revenue'),row('line','Sales',1000000,800000,'PL.REVENUE'),row('line','Services',500000,200000,'PL.SERVICES'),row('subtotal','Gross profit',600000,400000),row('total','Profit for the year',150000,90000)]},
 financial_position:{rows:[row('line','Cash',90000,50000,'SFP.CASH'),row('total','Total assets',700000,500000)]}};
const facts={company_name:'Fictional Mlima Traders',registration_number:'CPR/2020/000001',incorporation_date:'2020-03-02',registered_address:'Fictional House, Nairobi',po_box:'123',postal_code:'00100',postal_town:'Nairobi'};
const directors=[{full_name:'Fictional Amani',appointed_on:'2020-03-02',ceased_on:null},{full_name:'Fictional Zawadi',appointed_on:'2026-05-01',ceased_on:null},{full_name:'Fictional Old',appointed_on:'2020-03-02',ceased_on:'2025-12-31'}];
const approved={ENTITY_INFO:{approved:{state:'Declared',fields:{bankers:'Fictional Bank',auditors:'Fictional Auditors',secretary:'Fictional Secretaries',advocates:'Fictional Advocates'}}},
 REPORT:{approved:{state:'Declared',fields:{review:'Fictional review of a steady year of trading.',dividends:'None declared.'}}},
 RESPONSIBILITIES:{approved:{state:'Declared',fields:{statement:'x'.repeat(60),approved_on:'2027-02-01',signatories:['Fictional Amani']}}}};
const base={form:'Company',entity:'Fictional Mlima Traders',period,facts,directors,partners:[],officers:[],records:approved,principalActivity:'Trading in building materials.',statements,reporting:{}};

test('titles follow the legal form',()=>{
 assert.equal(M.pageTitle('REPORT','Company'),'Report of the directors');assert.equal(M.pageTitle('REPORT','Partnership'),'Report of the partners');
 assert.match(M.pageTitle('RESPONSIBILITIES','Sole proprietor'),/proprietor/);assert.equal(M.pageTitle('STATISTICS','Company'),'Key figures');
});
test('fields: a company needs a secretary unless one is on record; a proprietor has no advocates or secretary',()=>{
 const keys=(c,f,o)=>M.fieldsFor(c,f,o).map(x=>x.key);
 assert.deepEqual(keys('ENTITY_INFO','Company'),['bankers','auditors','secretary','advocates']);
 assert.deepEqual(keys('ENTITY_INFO','Company',{secretaryOnRecord:true}),['bankers','auditors','advocates']);
 assert.deepEqual(keys('ENTITY_INFO','Partnership'),['bankers','auditors','advocates']);
 assert.deepEqual(keys('ENTITY_INFO','Sole proprietor'),['bankers','auditors']);
 assert.ok(keys('REPORT','Company').includes('audit_info'));assert.ok(!keys('REPORT','Partnership').includes('audit_info'));
});
test('declaration checks: blanks are not read as none, dates, signatories from the record',()=>{
 const v=x=>M.validateDeclaration({code:'ENTITY_INFO',form:'Company',state:'Declared',period,fields:{bankers:'Fictional Bank',auditors:'Fictional Auditors',secretary:'Sec Co',advocates:'Adv Co'},...x});
 assert.ok(v({}).fields);
 assert.match(v({fields:{bankers:'Fictional Bank',auditors:'Fictional Auditors',secretary:'Sec Co'}}).error,/advocates/);
 assert.match(v({fields:{bankers:'Fictional Bank',auditors:'',secretary:'Sec Co',advocates:'Adv Co'}}).error,/Write "None"/);
 assert.match(v({state:'Not applicable',reason:'Not needed here at all.'}).error,/always applies/);
 assert.match(M.validateDeclaration({code:'REPORT',form:'Company',state:'Not applicable',reason:'short'}).error,/at least 10/);
 assert.equal(M.validateDeclaration({code:'REPORT',form:'Company',state:'Not applicable',reason:'The firm does not report for this client.'}).reason,'The firm does not report for this client.');
 const r=x=>M.validateDeclaration({code:'RESPONSIBILITIES',form:'Company',state:'Declared',period,candidates:['Fictional Amani','Fictional Zawadi'],fields:{statement:'y'.repeat(60),approved_on:'2027-02-01',signatories:['Fictional Amani'],...x}});
 assert.ok(r({}).fields);assert.match(r({approved_on:'2026-06-30'}).error,/before the end of the year/);assert.match(r({approved_on:'2027-13-01'}).error,/date/);
 assert.match(r({signatories:['Someone Else']}).error,/not on the client/);assert.match(r({signatories:[]}).error,/one to three/);
 assert.match(r({signatories:['Fictional Amani','fictional  amani']}).error,/once/);
 assert.match(r({statement:'too short'}).error,/at least 50/);
});
test('a complete company set builds every page',()=>{
 const b=M.buildClientPages(base);assert.equal(b.complete,true,b.problems.join(' '));
 assert.deepEqual(b.pages.map(p=>p.code),M.PAGE_ORDER);
 const ent=b.pages.find(p=>p.code==='ENTITY_INFO').blocks[0].lines;
 assert.ok(ent.some(l=>l[0]==='Directors'&&/Fictional Amani; Fictional Zawadi \(appointed 1 May 2026\)/.test(l[1])&&!/Old/.test(l[1])),'only directors who served in the year');
 assert.ok(ent.some(l=>l[0]==='Postal address'&&l[1]==='P.O. Box 123-00100, Nairobi'));assert.ok(ent.some(l=>l[0]==='Date of incorporation'&&l[1]==='2 March 2020'));
 const cover=b.pages[0].blocks;assert.equal(cover[0].text,'Fictional Mlima Traders');assert.ok(cover.some(x=>x.text==='For the year ended 31 December 2026'));
 const stat=b.pages.find(p=>p.code==='STATISTICS').blocks[0].rows;
 assert.deepEqual(stat.map(r=>r.label),['Revenue','Gross profit','Profit for the year','Total assets','Cash and cash equivalents','Gross profit margin (%)','Net profit margin (%)']);
 assert.equal(stat[0].current,1500000);assert.equal(stat[0].prior,1000000);assert.equal(stat[5].current,40);assert.equal(stat[6].current,10);assert.equal(stat[6].prior,9);
 const rep=b.pages.find(p=>p.code==='REPORT').blocks;assert.ok(rep.some(x=>/profit for the year was KES 150,000 \(prior year: KES 90,000\)/.test(x.text||'')));
 assert.ok(rep.some(x=>x.text==='Trading in building materials.'));
 const resp=b.pages.find(p=>p.code==='RESPONSIBILITIES').blocks;assert.ok(resp.some(x=>/approved on 1 February 2027/.test(x.text||'')));assert.deepEqual(resp.find(x=>x.type==='signatures').names,['Fictional Amani']);
 assert.equal(M.pagesCheck(b).status,'Pass');
});
test('nothing is guessed: an unverified fact, an undeclared page or a missing principal activity blocks the pack and names the gap',()=>{
 let b=M.buildClientPages({...base,facts:{...facts,registration_number:undefined}});assert.equal(b.complete,false);assert.match(b.problems.join(' '),/Registration number is not verified/);assert.deepEqual(b.pages.find(p=>p.code==='COVER').blocks,[]);
 b=M.buildClientPages({...base,records:{...approved,REPORT:{draft:{}}}});assert.match(b.problems.join(' '),/is waiting for approval/);
 b=M.buildClientPages({...base,records:{...approved,REPORT:{returned:{}}}});assert.match(b.problems.join(' '),/returned for changes/);
 b=M.buildClientPages({...base,records:{...approved,RESPONSIBILITIES:{}}});assert.match(b.problems.join(' '),/not declared yet/);
 b=M.buildClientPages({...base,principalActivity:null});assert.match(b.problems.join(' '),/principal activity is not approved/);
 b=M.buildClientPages({...base,directors:[]});assert.match(b.problems.join(' '),/No director is recorded/);
 b=M.buildClientPages({...base,statements:null});assert.match(b.problems.join(' '),/statements are not available/);
 b=M.buildClientPages({...base,facts:{...facts,po_box:'None'}});assert.equal(b.complete,true);assert.ok(!b.pages[1].blocks[0].lines.some(l=>l[0]==='Postal address'),'no box, no postal line');
 const chk=M.pagesCheck(M.buildClientPages({...base,principalActivity:null}));assert.equal(chk.status,'Blocked');assert.match(chk.detail,/Report of the directors/);
 assert.equal(M.pagesCheck(null).status,'Info');
});
test('not applicable pages print their reason and count as ready; an officer who is the secretary replaces the declared secretary',()=>{
 const b=M.buildClientPages({...base,records:{...approved,REPORT:{approved:{state:'Not applicable',reason:'No report is produced for this client.'}}},officers:[{holder_name:'Fictional Sec Person',holder_position:'Company Secretary',kind:'Officer'}]});
 assert.equal(b.complete,true,b.problems.join(' '));const rep=b.pages.find(p=>p.code==='REPORT');assert.equal(rep.state,'Not applicable');assert.match(rep.blocks[0].text,/No report is produced/);
 const lines=b.pages.find(p=>p.code==='ENTITY_INFO').blocks[0].lines;assert.equal(lines.filter(l=>l[0]==='Company secretary').length,1);assert.equal(lines.find(l=>l[0]==='Company secretary')[1],'Fictional Sec Person');
});
test('partnership and proprietor pages use their own words and people',()=>{
 const b=M.buildClientPages({...base,form:'Partnership',partners:['Fictional Partner A','Fictional Partner B'],facts:{company_name:'Fictional Bahari Partners',registered_address:'Fictional Road, Mombasa'},
  records:{ENTITY_INFO:{approved:{state:'Declared',fields:{bankers:'Fictional Bank',auditors:'Fictional Auditors',advocates:'Fictional Advocates'}}},REPORT:approved.REPORT,RESPONSIBILITIES:approved.RESPONSIBILITIES}});
 assert.equal(b.complete,true,b.problems.join(' '));assert.equal(b.pages.find(p=>p.code==='REPORT').title,'Report of the partners');
 assert.ok(b.pages.find(p=>p.code==='ENTITY_INFO').blocks[0].lines.some(l=>l[0]==='Partners'&&l[1]==='Fictional Partner A; Fictional Partner B'));
 const sp=M.buildClientPages({...base,form:'Sole proprietor',facts:{company_name:'Fictional Duka',registered_address:'Fictional Street, Kisumu'},records:{ENTITY_INFO:{approved:{state:'Declared',fields:{bankers:'Fictional Bank',auditors:'None'}}},REPORT:approved.REPORT,RESPONSIBILITIES:approved.RESPONSIBILITIES}});
 assert.equal(sp.complete,true,sp.problems.join(' '));assert.equal(sp.pages[0].blocks[1].text,'Financial statements');
 assert.equal(M.buildClientPages({...base,form:'Partnership',partners:[],facts:{company_name:'X Partners',registered_address:'Fictional Road'}}).complete,false);
});
test('draft statement: a starting text only, in the right words for the form and the framework',()=>{
 const t=M.draftStatement({form:'Company',entity:'Fictional Mlima Traders',yearEnd:'31 December 2026',framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)'});
 assert.match(t,/Companies Act, 2015/);assert.match(t,/Fictional Mlima Traders \(the Company\)/);assert.match(t,/IFRS for SMEs Accounting Standard \(Third Edition \(2025\)\)/);
 assert.match(M.draftStatement({form:'Partnership',entity:'Fictional Bahari'}),/The partners are responsible/);assert.match(M.draftStatement({form:'Sole proprietor',entity:'Fictional Duka'}),/proprietor/);
 assert.ok(M.draftStatement({form:'Other',entity:'Fictional Chama'}).length>50);
});
test('the forms named here match the legal-form module',async()=>{
 const {FORMS}=await import('../supabase/functions/staff-workspace-v12/annual-pack-legal-form.mjs');
 for(const f of Object.values(FORMS))assert.ok(M.pageTitle('REPORT',f)!=='REPORT');
 assert.equal(M.pageTitle('REPORT',FORMS.COMPANY),'Report of the directors');assert.equal(M.pageTitle('REPORT',FORMS.PARTNERSHIP),'Report of the partners');assert.equal(M.pageTitle('REPORT',FORMS.PROPRIETOR),'Report of the proprietor');
});
