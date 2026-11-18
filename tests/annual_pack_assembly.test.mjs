import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';import os from 'node:os';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),PDFLib=require(path.join(root,'supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd(),root]}));
const A=await import('../supabase/functions/staff-workspace-v12/annual-pack-assembly.mjs');
const {packPdf}=await import('../supabase/functions/staff-workspace-v12/annual-pack-pdf.mjs');
const {packWorkbook}=await import('../supabase/functions/staff-workspace-v12/annual-pack-workbook.mjs');

const gate=(o={})=>({ready:false,ready_for_review:true,checks:[],...o});
test('status word: Draft, Management draft, Subject to audit, Audited',()=>{
 assert.equal(A.statusWord({gate:gate({ready_for_review:false}),audit:{required:true,locked:false}}),'Draft');
 assert.equal(A.statusWord({gate:null,audit:null}),'Draft');
 assert.equal(A.statusWord({gate:gate(),audit:{required:false,locked:false}}),'Management draft');
 assert.equal(A.statusWord({gate:gate(),audit:{required:true,locked:false}}),'Subject to audit');
 assert.equal(A.statusWord({gate:gate({ready:true}),audit:{required:true,locked:true,stale:false}}),'Audited');
 assert.equal(A.statusWord({gate:gate({ready:true}),audit:{required:true,locked:true,stale:true}}),'Management draft','a stale lock is never "Audited"');
 assert.equal(A.statusWord({gate:gate({ready:false}),audit:{required:true,locked:true,stale:false}}),'Management draft','locked but another check is open: the audit is done, the pack is not final');
 assert.deepEqual(A.STATUS_WORDS,['Draft','Management draft','Subject to audit','Audited']);
 assert.equal(A.watermarkFor('Audited'),null);assert.equal(A.watermarkFor('Subject to audit'),'SUBJECT TO AUDIT');
});
const sys=[{number:1,title:'Revenue',sections:[{label:'Sales',accounts:[{code:'4000',name:'Sales',amount:1000}],rounding:0,total:1000,prior:800}]},{number:2,title:'Property, plant and equipment',sections:[{label:'Cost',accounts:[{code:'1000',name:'Equipment',amount:500}],rounding:0,total:500,prior:null}]}];
const ws=[{key:'REPORTING_ENTITY',group:'General information',title:'Reporting entity',text:'Fictional Co is a company.'},{key:'BASIS_OF_PREPARATION',group:'Basis of preparation',title:'Basis of preparation',text:'IFRS for SMEs.'},{key:'FUNCTIONAL_CURRENCY',group:'Basis of preparation',title:'Functional currency',text:'KES.'},
 {key:'POLICY_REVENUE',group:'Accounting policies',title:'Revenue',text:'Recognised on delivery.'},{key:'GOING_CONCERN',group:'Other disclosures',title:'Going concern',text:'Fictional continuing.'},{key:'EVENTS_AFTER',group:'Other disclosures',title:'Events after the reporting period',text:'Nothing to report.'}];
test('one numbered sequence: leading wording notes, then the system notes shifted by that count, then each other disclosure',()=>{
 const q=A.buildNoteSequence({wordingSections:ws,systemNotes:sys});
 assert.equal(q.offset,3);assert.deepEqual(q.items.map(i=>[i.number,i.kind,i.title]),[[1,'wording','General information'],[2,'wording','Basis of preparation'],[3,'wording','Significant accounting policies'],[4,'system','Revenue'],[5,'system','Property, plant and equipment'],[6,'disclosure','Going concern'],[7,'disclosure','Events after the reporting period']]);
 assert.deepEqual(q.items.filter(i=>i.kind==='system').map(i=>i.system_number),[1,2],'the approved numbers are kept as the system numbers');
 assert.deepEqual(q.items[1].sections.map(s=>s.title),['Basis of preparation','Functional currency']);
 const none=A.buildNoteSequence({wordingSections:[],systemNotes:sys});assert.equal(none.offset,0);assert.deepEqual(none.items.map(i=>i.number),[1,2]);
 assert.match(A.buildNoteSequence({wordingSections:[{key:'X',group:'Odd group',title:'Odd',text:'x'}],systemNotes:[]}).problems[0],/no place in the notes/);
});
const pageBlocks=[{type:'title',text:'Fictional Mlima Traders'},{type:'text',text:'For the year ended 31 December 2026'}];
const pages=o=>({pages:[{code:'COVER',title:'Cover',state:'Ready',blocks:pageBlocks,problems:[]},{code:'ENTITY_INFO',title:'Entity information',state:'Ready',blocks:[{type:'lines',lines:[['Registered office','Fictional House, Nairobi'],['Directors','Fictional Amani']]}],problems:[]},
 {code:'REPORT',title:'Report of the directors',state:o?.reportNotReady?'Not ready':'Ready',blocks:[{type:'heading',text:'Principal activity'},{type:'text',text:'Trading.'}],problems:o?.reportNotReady?['The report is not declared yet.']:[]},
 {code:'RESPONSIBILITIES',title:'Statement of directors’ responsibilities',state:'Ready',blocks:[{type:'text',text:'The directors are responsible.'},{type:'signatures',names:['Fictional Amani']}],problems:[]},
 {code:'STATISTICS',title:'Key figures',state:'Ready',blocks:[{type:'figures',unit:'KES',rows:[{label:'Revenue',current_text:'1,000',prior_text:'800'}]}],problems:[]}]});
const statements=()=>({period:{ends_on:'2026-12-31'},presentation:{unit_label:'KES'},
 profit_or_loss:{title:'Statement of profit or loss',has_prior:true,rows:[{kind:'heading',label:'Revenue'},{kind:'line',label:'Sales',code:'PL.REVENUE',note:1,current:1000,prior:800},{kind:'total',label:'Profit for the year',current:150,prior:90}]},
 financial_position:{title:'Statement of financial position',has_prior:true,rows:[{kind:'line',label:'Equipment',code:'SFP.PPE',note:2,current:500,prior:400},{kind:'total',label:'Total assets',current:500,prior:400}]},
 changes_in_equity:{title:'Statement of changes in equity',current:{columns:[{code:'A',label:'Share capital'}],rows:[{label:'Opening',cells:{A:100},total:100}]},prior:null},
 cash_flow:{title:'Statement of cash flows',has_prior:false,rows:[{kind:'line',label:'Net cash',current:90,prior:null}]},
 notes:{title:'Notes to the financial statements',items:sys},audit:{required:true,locked:false}});
const input=(o={})=>({client:{name:'Fictional Mlima Traders',kra_pin:'P000000000Z',legal_form:'Company'},reporting:{framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)'},statements:statements(),wording:{sections:ws},pages:pages(o),
 gate:gate({checks:[{ok:false,label:'Audit complete and pack locked'}],...(o.gate||{})}),audit:o.audit||{required:true,locked:false,label:'Not started'},lock:o.lock||null,asOf:'2026-12-31',attachment:o.attachment||null});
test('the model: order of sections, face note numbers follow the single sequence, a page that is not ready says so',()=>{
 const m=A.assemblePack(input());
 assert.deepEqual(m.sections.map(s=>s.code),['COVER','ENTITY_INFO','REPORT','RESPONSIBILITIES','STATISTICS','AUDITOR','PL','SFP','SCE','SCF','NOTES']);
 assert.equal(m.status.word,'Subject to audit');assert.equal(m.status.watermark,'SUBJECT TO AUDIT');assert.match(m.status.banner,/Open checks: Audit complete and pack locked/);
 const pl=m.sections.find(s=>s.code==='PL').blocks[0];assert.equal(pl.rows[1].note,4,'note 1 of the system becomes note 4');assert.equal(m.sections.find(s=>s.code==='SFP').blocks[0].rows[0].note,5);
 assert.equal(m.numbering.shift,3);assert.match(m.numbering.note,/shifted by 3/);assert.equal(m.numbering.total_notes,7);
 const notes=m.sections.find(s=>s.code==='NOTES').blocks.filter(b=>b.type==='heading'&&!b.minor).map(b=>b.text);assert.deepEqual(notes,['1. General information','2. Basis of preparation','3. Significant accounting policies','4. Revenue','5. Property, plant and equipment','6. Going concern','7. Events after the reporting period']);
 assert.equal(m.sections.find(s=>s.code==='AUDITOR').ready,false);assert.equal(m.complete,false);
 const n=A.assemblePack(input({reportNotReady:true}));const rp=n.sections.find(s=>s.code==='REPORT');assert.equal(rp.ready,false);assert.match(rp.blocks[0].text,/Not ready\. The report is not declared yet/);assert.ok(n.problems.some(p=>/Report of the directors: The report is not declared/.test(p)));
 assert.equal(m.sections.find(s=>s.code==='COVER').blocks[0].text,'Fictional Mlima Traders');
});
test('Audited: no watermark; an external lock names the report and attaches it only when it was verified',()=>{
 const lock={mode:'External audit',report_reference:'FA/2026/001',report_date:'2027-02-20',opinion:'Unmodified',auditor_name:'Fictional Auditors LLP',locked_name:'Manager One',locked_at:'2027-02-21T08:00:00Z'};
 const ok=A.assemblePack(input({gate:{ready:true,checks:[]},audit:{required:true,locked:true,stale:false},lock,attachment:{verified:true,document_id:'d1',file_name:'signed.pdf',sha256:'a'.repeat(64)}}));
 assert.equal(ok.status.word,'Audited');assert.equal(ok.status.watermark,null);assert.equal(ok.status.banner,'');
 const au=ok.sections.find(s=>s.code==='AUDITOR');assert.equal(au.ready,true);assert.equal(au.attachment.file_name,'signed.pdf');assert.ok(au.blocks[0].lines.some(l=>l[0]==='Opinion'&&l[1]==='Unmodified'));assert.match(au.blocks[1].text,/follows this page, exactly as signed/);assert.equal(ok.attachments.length,1);
 const bad=A.assemblePack(input({gate:{ready:true,checks:[]},audit:{required:true,locked:true,stale:false},lock,attachment:{verified:false,reason:'the file does not match the fingerprint recorded when the pack was locked.'}}));
 assert.match(bad.sections.find(s=>s.code==='AUDITOR').blocks[1].text,/could not be attached: the file does not match/);assert.equal(bad.attachments.length,0);assert.ok(bad.problems.some(p=>/auditor.s report could not be attached/.test(p)));assert.equal(bad.complete,false);assert.equal(bad.status.word,'Subject to audit','an unverified signed report is never shown as Audited');assert.ok(bad.status.watermark);assert.ok(bad.status.open_checks.some(x=>/could not be attached/.test(x)));
 const inh=A.assemblePack(input({gate:{ready:true,checks:[]},audit:{required:true,locked:true,stale:false},lock:{...lock,mode:'In-house audit',auditor_name:null}}));assert.match(inh.sections.find(s=>s.code==='AUDITOR').blocks[1].text,/in-house audit is recorded in the audit file/);assert.equal(inh.attachments.length,0);
});
const pdfText=async bytes=>{const f=path.join(os.tmpdir(),'pack-'+crypto.randomUUID()+'.pdf');fs.writeFileSync(f,bytes);try{return execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'});}finally{fs.unlinkSync(f);}};
test('the PDF: every page carries the status word, a watermark and the fingerprint; the signed report is added unstamped',async()=>{
 const signed=await PDFLib.PDFDocument.create();signed.addPage([300,300]).drawText('SIGNED AUDITOR REPORT BODY',{x:20,y:200,size:12});const signedBytes=await signed.save();
 const m=A.assemblePack(input({gate:{ready:true,checks:[]},audit:{required:true,locked:true,stale:false},lock:{mode:'External audit',report_reference:'FA/2026/001',report_date:'2027-02-20',opinion:'Unmodified',auditor_name:'Fictional Auditors LLP',locked_name:'Manager One',locked_at:'2027-02-21T08:00:00Z'},attachment:{verified:true,document_id:'d1',file_name:'signed.pdf',sha256:'a'.repeat(64)}}));
 const bytes=await packPdf(m,PDFLib,{attachmentBytes:signedBytes,fingerprint:'f'.repeat(64),issuedAt:'2026-12-31T00:00:00Z'});
 const again=await packPdf(m,PDFLib,{attachmentBytes:signedBytes,fingerprint:'f'.repeat(64),issuedAt:'2026-12-31T00:00:00Z'});assert.deepEqual(Buffer.from(bytes),Buffer.from(again),'the same inputs give the same bytes');
 const t=await pdfText(bytes);
 for(const s of ['Fictional Mlima Traders','Entity information','Report of the directors','Statement of directors’ responsibilities','Key figures','Report of the independent auditor','Statement of profit or loss','Statement of financial position','Notes to the financial statements','4. Revenue','SIGNED AUDITOR REPORT BODY'])assert.ok(t.includes(s),'missing '+s);
 assert.match(t,/AUDITED/);assert.match(t,/Fingerprint ffffffffffffffff/);assert.doesNotMatch(t,/SUBJECT TO AUDIT|DRAFT/);
 const d=await PDFLib.PDFDocument.load(bytes);assert.ok(d.getPageCount()>=8);
 // not audited: watermark and word on every one of the pack's own pages
 const dm=A.assemblePack(input());const db=await packPdf(dm,PDFLib,{fingerprint:'e'.repeat(64),issuedAt:'2026-12-31T00:00:00Z'});const dt=await pdfText(db);
 const pages=dt.split('\f').filter(x=>x.trim());assert.ok(pages.length>=8);for(const p of pages){assert.match(p,/SUBJECT TO AUDIT/);assert.match(p,/Page \d+ of \d+/);}
 assert.match(dt.replace(/\s+/g,' '),/Not available\. The audit is not complete and the pack is not locked/);
});
test('the workbook: contents with the status and open checks, one sheet per section, the status word on every sheet',async()=>{
 const m=A.assemblePack(input());const book=packWorkbook(m,ExcelJS,{fingerprint:'d'.repeat(64)});
 const names=book.worksheets.map(w=>w.name);assert.equal(names[0],'Contents');for(const n of ['Cover','Entity information','Report of the directors','Key figures','Statement of profit or loss','Notes'])assert.ok(names.includes(n),'sheet '+n);
 for(const w of book.worksheets)assert.match(String(w.getRow(1).getCell(1).value),/^SUBJECT TO AUDIT/);
 const c=book.getWorksheet('Contents'),all=[];c.eachRow(r=>all.push(String(r.getCell(1).value??'')));
 assert.ok(all.includes('  Audit complete and pack locked'));assert.ok(all.includes('4. Revenue'));assert.ok(all.some(x=>/shifted by 3/.test(x)));
 const pl=book.getWorksheet('Statement of profit or loss');let found=null;pl.eachRow(r=>{if(r.getCell(1).value==='Sales')found=r;});assert.equal(found.getCell(2).value,4,'the note column follows the single sequence');assert.equal(found.getCell(3).value,1000);
 const buf=await book.xlsx.writeBuffer();assert.ok(buf.byteLength>3000);
 const aud=packWorkbook(A.assemblePack(input({gate:{ready:true,checks:[]},audit:{required:true,locked:true,stale:false},lock:{mode:'External audit',report_reference:'R1',report_date:'2027-02-20',opinion:'Unmodified',auditor_name:'Fictional Auditors LLP',locked_name:'M',locked_at:'2027-02-21T08:00:00Z'},attachment:{verified:true,document_id:'d',file_name:'signed.pdf',sha256:'b'.repeat(64)}})),ExcelJS,{fingerprint:'d'.repeat(64)});
 for(const w of aud.worksheets)assert.match(String(w.getRow(1).getCell(1).value),/^AUDITED/);let att='';aud.getWorksheet('Contents').eachRow(r=>{att+=String(r.getCell(1).value??'')+'|'+String(r.getCell(2).value??'')+'\n';});assert.match(att,/Signed auditor's report: signed\.pdf\|SHA-256 b{64}/);
});
test('build 2886: an approved supporting schedule is printed under its note, in the PDF and the workbook; an unapproved one is not',async()=>{
 const support={kind:'STOCK',title:'Inventories',version:1,evidence:'Fictional count sheet',categories:[{category:'Goods for resale',lines:[{description:'Hardware',reference:'Count p1',account:'1000',amount:400},{description:'Tools',reference:'',account:'1000',amount:100}],total:500,rounding:0}],total:500,ties:true,tie:{rows:[],ties:true,differences:0}};
 const withSupport=input();withSupport.statements.notes={...withSupport.statements.notes,items:sys.map((n,i)=>i===1?{...n,support}:n)};
 const m=A.assemblePack(withSupport),blocks=m.sections.find(s=>s.code==='NOTES').blocks,sc=blocks.find(b=>b.type==='matrix'&&/Supporting schedule: Inventories/.test(b.caption||''));
 assert.ok(sc,'the schedule is a block under the note');assert.deepEqual(sc.rows.map(r=>[r.label.trim(),r.cells[0]]),[['Goods for resale',''],['Hardware (Count p1)',400],['Tools',100],['Total goods for resale',500],['Total supporting schedule',500]]);
 assert.equal(A.assemblePack(input()).sections.find(s=>s.code==='NOTES').blocks.some(b=>/Supporting schedule/.test(b.caption||'')),false,'no approved schedule, nothing printed');
 const pdf=await packPdf(m,PDFLib,{fingerprint:'abc123'});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sup-'));fs.writeFileSync(dir+'/p.pdf',pdf);
 const txt=execFileSync('pdftotext',['-layout',dir+'/p.pdf','-'],{encoding:'utf8'});assert.match(txt,/Supporting schedule: Inventories/);assert.match(txt,/Hardware \(Count p1\)/);assert.match(txt,/Total supporting schedule/);
 const wb=packWorkbook(m,ExcelJS,{fingerprint:'abc123'});const cells=[];wb.eachSheet(w=>w.eachRow(r=>cells.push(r.values.join('|'))));assert.ok(cells.some(c=>/Supporting schedule: Inventories/.test(c)));assert.ok(cells.some(c=>/Hardware \(Count p1\)\|400/.test(c)));
});
test('build 2888: the partners capital and current accounts are a section of the pack, printed after the allocation of profit, in the PDF and the workbook',async()=>{
 const matrix={columns:['Fictional Amani','Fictional Zawadi','Total'],rows:[{label:'Capital account: balance at the start of the year',cells:[600000,400000,1000000]},{label:'Total partners’ equity at the end of the year',cells:[890000,560000,1450000],total:true}]};
 const withP=input();withP.statements.partner_allocation={title:'Allocation of profit for the year to the partners',unit_label:'KES',profit:500000,rows:[{partner_name:'Fictional Amani',percent:'60%',amount:300000},{partner_name:'Fictional Zawadi',percent:'40%',amount:200000}],total:500000,version:1};
 withP.statements.partner_equity={built:true,ties:true,title:"Statement of partners' capital and current accounts",unit_label:'KES',rounding_shown:false,matrix};
 const m=A.assemblePack(withP),codes=m.sections.map(s=>s.code);assert.ok(codes.indexOf('PEQ')>codes.indexOf('ALLOC'),'after the allocation');assert.ok(codes.indexOf('PEQ')>=0);
 const peq=m.sections.find(s=>s.code==='PEQ');assert.equal(peq.title,"Statement of partners' capital and current accounts");assert.deepEqual(peq.blocks[0].columns,matrix.columns);
 assert.equal(A.assemblePack(input()).sections.some(s=>s.code==='PEQ'),false,'a company has no such page');
 withP.statements.partner_equity={...withP.statements.partner_equity,built:false};assert.equal(A.assemblePack(withP).sections.some(s=>s.code==='PEQ'),false,'nothing is printed until the record is approved');
 withP.statements.partner_equity={...withP.statements.partner_equity,built:true};
 const pdf=await packPdf(m,PDFLib,{fingerprint:'abc123'});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'peq-'));fs.writeFileSync(dir+'/p.pdf',pdf);
 const txt=execFileSync('pdftotext',['-layout',dir+'/p.pdf','-'],{encoding:'utf8'});assert.match(txt,/partners' capital and current accounts/i);assert.match(txt,/1,450,000/);assert.match(txt,/Fictional Zawadi/);
 const wb=packWorkbook(m,ExcelJS,{fingerprint:'abc123'});const cells=[];wb.eachSheet(w=>w.eachRow(r=>cells.push(r.values.join('|'))));assert.ok(cells.some(c=>/Total partners’ equity at the end of the year\|890000\|560000\|1450000/.test(c)));
});
