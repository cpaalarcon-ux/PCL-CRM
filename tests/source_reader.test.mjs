import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),JSZip=require('../supabase/functions/staff-workspace-v6/node_modules/jszip'),ExcelJS=require('../supabase/functions/staff-workspace-v6/node_modules/exceljs');
const {parseCSV,sourceEntries,readSourceSheet}=await import('../supabase/functions/staff-workspace-v6/source-reader.mjs');
const {fileType}=await import('../supabase/functions/staff-workspace-v6/validation.mjs');
const bytes=s=>new TextEncoder().encode(s);
test('CSV preserves quoted newlines, UTF8 BOM, identifiers, first row and literal formula text',()=>{
 const rows=parseCSV(bytes('\uFEFFPIN,Reference,Narration\r\n P123456789A,|00001234567890,"Line one\nLine two, quoted ""text"""\r\nP123456789A,0002,=2+2\r\n'));
 assert.equal(rows.length,3);assert.equal(rows[1][1],'|00001234567890');assert.equal(rows[1][2],'Line one\nLine two, quoted "text"');assert.equal(rows[2][2],'=2+2');assert.throws(()=>parseCSV(bytes('"unfinished')));assert.throws(()=>parseCSV(bytes('a,"b"c')));
});
test('headerless source adapter counts every KRA row and supports separate archive members',async()=>{
 const inner=new JSZip();inner.file('SEC_F_WITH_VAT_PIN1.CSV','PIN,INV001,100\nPIN,INV002,200\n');inner.file('SEC_H_WITH_VAT_PIN1.CSV','PIN,INV003,300\n');
 const middle=new JSZip();middle.file('csv.zip',await inner.generateAsync({type:'uint8array'}));const outer=new JSZip();outer.file('VAT.zip',await middle.generateAsync({type:'uint8array'}));outer.file('Readme.pdf','%PDF-Source reference');
 const data=await outer.generateAsync({type:'uint8array'}),entries=await sourceEntries(data,'UPDATE5.zip');assert.equal(entries.length,3);assert.equal(entries.filter(x=>x.format==='CSV').reduce((n,x)=>n+x.rows,0),3);assert.equal(entries.find(x=>x.format==='Unsupported').format,'Unsupported');
 const out=await readSourceSheet(data,'UPDATE5.zip');assert(out.headerless);assert.equal(out.sheet.getRow(1).getCell(2).value,'INV001');assert.equal(out.sheet.rowCount,2);
});
test('unsafe archives and excessive nesting are rejected before processing',async()=>{
 const zip=new JSZip();zip.file('../escape.csv','a,b\n1,2');await assert.rejects(()=>sourceEntries(zip.generateAsync({type:'uint8array'}),'bad.zip'));
 const script=new JSZip();script.file('run.js','alert(1)');await assert.rejects(()=>script.generateAsync({type:'uint8array'}).then(x=>sourceEntries(x,'bad.zip')),/executable/);
 let data=bytes('a,b\n1,2');let name='data.csv';for(let i=0;i<4;i++){const z=new JSZip();z.file(name,data);data=await z.generateAsync({type:'uint8array'});name='nested.zip';}await assert.rejects(()=>sourceEntries(data,name),/three ZIP/);
});
test('formatting through XFD does not become business columns or employee rows',async()=>{
 const w=new ExcelJS.Workbook(),s=w.addWorksheet('Payroll');s.addRow(['PIN','Employee','Gross']);s.addRow(['P123456789A','Fictional employee',1000]);s.getCell('XFD22').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFFFF'}};
 const out=await readSourceSheet(new Uint8Array(await w.xlsx.writeBuffer()),'payroll.xlsx');assert.equal(out.sheet.rowCount,2);assert.equal(out.sheet.columnCount,3);
 s.getCell('XFD22').value='Unexpected real data';await assert.rejects(()=>w.xlsx.writeBuffer().then(b=>readSourceSheet(new Uint8Array(b),'payroll.xlsx')),/Business data/);
});
test('CSV and ZIP pass upload validation without changing evidence formats',async()=>{assert.equal(fileType('source.csv',bytes('date,amount\n2026-10-01,100')),'text/csv');assert.equal(fileType('evidence.pdf',bytes('%PDF-test')),'application/pdf');const zip=new JSZip();zip.file('data.csv','a,b\n1,2');assert.equal(fileType('source.zip',await zip.generateAsync({type:'uint8array'})),'application/zip');assert.throws(()=>fileType('source.csv',bytes('<html>,bad')));});
