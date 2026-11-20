// The workbook of the assembled annual pack (build 2885): the same model as the PDF, one sheet per section. ExcelJS is passed in by the caller.
// Every sheet carries the status word in its first row and its printed header; a pack that is not Audited has a red tab. A workbook cannot hold the signed auditor's report, so the contents sheet names it
// and its fingerprint; the PDF carries it.
const FMT='#,##0;(#,##0);-',F=(o={})=>({name:'Arial',size:9,...o});
export function packWorkbook(model,ExcelJS,{fingerprint=''}={}){
 const book=new ExcelJS.Workbook();book.creator='PCL Nexus';book.title=`${model.client.name} annual financial statements, year ended ${model.year_end}`;
 const draft=model.status.word!=='Audited',names=new Set();
 const sheet=(base,title)=>{let n=String(base).replace(/[\\/?*[\]:]/g,' ').slice(0,28),k=2;while(names.has(n.toLowerCase())){n=n.slice(0,25)+' '+k++;}names.add(n.toLowerCase());
  const w=book.addWorksheet(n);
  w.addRow([`${model.status.word.toUpperCase()}${model.status.banner&&draft?' — '+model.status.banner.replace(/^[A-Z ]+\.\s*/,''):''}`]).font=F({bold:true,size:10,color:{argb:draft?'FFC00000':'FF0D5C3A'}});
  if(draft){w.properties.tabColor={argb:'FFC00000'};w.headerFooter.oddHeader=`&C&B&K00C00000${model.status.word.toUpperCase()}`;}
  w.headerFooter.oddFooter=`&L${model.client.name}&CFingerprint ${String(fingerprint).slice(0,16)}&RPage &P of &N`;
  w.addRow([`${model.client.name} · ${title}`]).font=F({bold:true,size:12});
  w.addRow([`${model.reporting.framework||''}${model.reporting.edition?', '+model.reporting.edition:''}; as of ${model.as_of}`]).font=F({italic:true});w.addRow([]);return w;};
 const num=(c)=>{if(typeof c.value==='number')c.numFmt=FMT;};
 const blocks=(w,list)=>{
  for(const b of list){
   switch(b.type){
    case 'title':w.addRow([b.text]).font=F({bold:true,size:16});break;
    case 'subtitle':w.addRow([b.text]).font=F({bold:true,size:12});break;
    case 'heading':w.addRow([b.text]).font=F({bold:true,size:b.minor?9.5:11});break;
    case 'text':{const r=w.addRow([b.text]);r.font=F();r.getCell(1).alignment={wrapText:true,vertical:'top'};r.height=Math.max(14,Math.ceil(String(b.text).length/95)*13);break;}
    case 'note':w.addRow([b.text]).font=F({italic:true,size:8});break;
    case 'lines':for(const [l,v] of b.lines){const r=w.addRow([l,v]);r.getCell(1).font=F({bold:true});r.getCell(2).font=F();r.getCell(2).alignment={wrapText:true,vertical:'top'};}break;
    case 'signatures':for(const n of b.names){w.addRow([]);w.addRow(['______________________________']);w.addRow([n]).font=F();}break;
    case 'figures':w.addRow([b.unit,'Current year','Prior year']).font=F({bold:true});for(const r of b.rows){const x=w.addRow([r.label,r.current,r.prior]);x.font=F();x.eachCell(num);}break;
    case 'statement':{w.addRow(['','Note',...b.columns]).font=F({bold:true});for(const r of b.rows){const x=w.addRow([r.label,r.note||null,r.kind==='heading'?null:r.current,...(b.has_prior?[r.kind==='heading'?null:r.prior??'Not available']:[])]);x.font=F({bold:['heading','subtotal','total'].includes(r.kind)});x.eachCell(num);}break;}
    case 'matrix':if(b.caption)w.addRow([b.caption]).font=F({bold:true});w.addRow(['',...b.columns]).font=F({bold:true});for(const r of b.rows){const x=w.addRow([r.label,...r.cells]);x.font=F({bold:!!r.total});x.eachCell(num);}w.addRow([]);break;
    case 'schedule':{const cols=[['opening_cost','Opening cost'],['additions','Additions'],['disposals','Disposals'],['closing_cost','Closing cost'],['opening_acc','Opening depreciation'],['charge','Charge'],['released','Released'],['closing_acc','Closing depreciation'],['nbv','Net book value']];
     w.addRow(['Property, plant and equipment: movement schedule']).font=F({bold:true});w.addRow(['Class',...cols.map(c=>c[1])]).font=F({bold:true});
     for(const g of b.schedule.classes){const x=w.addRow([g.name?`${g.account} ${g.name}`:g.account,...cols.map(([k])=>g[k])]);x.font=F();x.eachCell(num);}
     const t=w.addRow(['Total',...cols.map(([k])=>b.schedule.totals[k])]);t.font=F({bold:true});t.eachCell(num);w.addRow([]);break;}
   }
  }
  w.columns.forEach((c,i)=>{c.width=i===0?58:20;});
 };
 // contents first: status, open checks, numbering, attachments
 const c=sheet('Contents','Contents and status');
 c.addRow(['Status',model.status.word]).font=F({bold:true});
 if(model.status.open_checks.length){c.addRow(['Open checks']).font=F({bold:true});for(const x of model.status.open_checks)c.addRow(['  '+x]).font=F();}
 c.addRow([]);c.addRow(['Contents']).font=F({bold:true});for(const s of model.sections)c.addRow([`${s.title}${s.ready?'':' (not ready)'}`]).font=F();
 c.addRow([]);c.addRow(['Notes']).font=F({bold:true});for(const n of model.note_index)c.addRow([`${n.number}. ${n.title}`]).font=F();
 if(model.numbering.note)c.addRow([model.numbering.note]).font=F({italic:true,size:8});
 if(model.attachments.length){c.addRow([]);c.addRow(['Attached in the PDF']).font=F({bold:true});for(const a of model.attachments)c.addRow([`Signed auditor's report: ${a.file_name}`,`SHA-256 ${a.sha256}`]).font=F();}
 c.columns.forEach((x,i)=>{x.width=i===0?70:70;});
 for(const s of model.sections){const w=sheet(s.code==='NOTES'?'Notes':s.title,s.title);blocks(w,s.blocks);}
 return book;
}
