// The PDF of the assembled annual pack (build 2885). pdf-lib is passed in by the caller. The same model and fingerprint give the same pages.
// Every page of the pack carries the status word and, unless the pack is Audited, a diagonal watermark. The signed auditor's report, when there is one, is added exactly as signed: it is not stamped.
import {safe,wrap} from './letter-pdf.mjs';
import {formatMoney} from './annual-pack-assembly.mjs';
const W=595.28,H=841.89,M=40,TEXT=W-2*M;
export async function packPdf(model,{PDFDocument,StandardFonts,rgb,degrees},{attachmentBytes=null,fingerprint='',issuedAt=null}={}){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 doc.setTitle(safe(`${model.client.name} annual financial statements, year ended ${model.year_end}`));doc.setAuthor('PCL Nexus');doc.setCreator('PCL Nexus');doc.setProducer('PCL Nexus');
 doc.setSubject(safe(`${model.status.word}. Fingerprint ${String(fingerprint).slice(0,16)}`));
 if(issuedAt){const d=new Date(issuedAt);doc.setCreationDate(d);doc.setModificationDate(d);}
 const green=rgb(0.05,0.25,0.18),grey=rgb(0.35,0.35,0.35),red=rgb(0.7,0.1,0.1),light=rgb(0.9,0.94,0.92);
 const own=[];let page=null,y=0,cover=false;
 const num=v=>typeof v==='number'?formatMoney(v):safe(v===null||v===undefined?'':String(v));
 const newPage=()=>{page=doc.addPage([W,H]);own.push(page);y=H-M-14;
  page.drawText(safe(model.client.name),{x:M,y:H-M+4,size:8,font:bold,color:green});
  page.drawText(safe(model.status.word.toUpperCase()),{x:W-M-bold.widthOfTextAtSize(safe(model.status.word.toUpperCase()),8),y:H-M+4,size:8,font:bold,color:model.status.word==='Audited'?green:red});
  page.drawLine({start:{x:M,y:H-M},end:{x:W-M,y:H-M},thickness:0.6,color:green});};
 const need=h=>{if(y-h<M+24)newPage();};
 const draw=(t,x,size,f,color)=>page.drawText(safe(t),{x,y,size,font:f,color});
 const para=(t,{size=9.5,f=font,gap=4,color=undefined,indent=0,center=false}={})=>{for(const ln of wrap(f,size,t,TEXT-indent)){need(size+3);const x=center?M+(TEXT-f.widthOfTextAtSize(ln,size))/2:M+indent;page.drawText(ln,{x,y,size,font:f,color});y-=size+3;}y-=gap;};
 const right=(t,xr,size,f)=>{const s=num(t);page.drawText(s,{x:xr-f.widthOfTextAtSize(s,size),y,size,font:f});};
 const block=b=>{
  switch(b.type){
   case 'title':if(cover)y=H-300;para(b.text,{size:22,f:bold,gap:8,center:cover,color:green});break;
   case 'subtitle':para(b.text,{size:14,f:bold,gap:6,center:cover});break;
   case 'heading':need(24);y-=4;para(b.text,{size:b.minor?10:11.5,f:bold,gap:3,color:green});break;
   case 'text':para(b.text,{center:cover,gap:6});break;
   case 'note':para(b.text,{size:8,color:grey});break;
   case 'lines':for(const [l,v] of b.lines){const vw=TEXT-170,ls=wrap(bold,9,l,160),vs=wrap(font,9,v,vw),n=Math.max(ls.length,vs.length);need(n*12+4);for(let i=0;i<n;i++){if(ls[i])page.drawText(ls[i],{x:M,y:y-i*12,size:9,font:bold});if(vs[i])page.drawText(vs[i],{x:M+170,y:y-i*12,size:9,font});}y-=n*12+3;}break;
   case 'signatures':for(const n of b.names){need(44);y-=26;page.drawLine({start:{x:M,y},end:{x:M+230,y},thickness:0.6,color:grey});y-=11;draw(n,M,9,font);y-=8;}break;
   case 'figures':{para(b.unit,{size:8,color:grey,gap:1});need(16);draw('',M,9,bold);page.drawText('Current year',{x:W-M-170-bold.widthOfTextAtSize('Current year',8.5)+80,y,size:8.5,font:bold});page.drawText('Prior year',{x:W-M-bold.widthOfTextAtSize('Prior year',8.5),y,size:8.5,font:bold});y-=14;
    for(const r of b.rows){need(14);draw(r.label,M,9,font);right(r.current_text,W-M-100,9,font);right(r.prior_text,W-M,9,font);y-=13;}y-=4;break;}
   case 'statement':{
    const noteX=M+TEXT-2*96-30,cur=M+TEXT-96,pri=M+TEXT;
    need(18);for(const [i,c] of b.columns.entries())page.drawText(safe(c),{x:(i?pri:cur)-bold.widthOfTextAtSize(safe(c),8.5),y,size:8.5,font:bold});page.drawText('Note',{x:noteX-bold.widthOfTextAtSize('Note',8.5)/2,y,size:8.5,font:bold});y-=6;page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:0.5,color:grey});y-=11;
    for(const r of b.rows){
     const strong=['subtotal','total','heading'].includes(r.kind),f=strong?bold:font,lab=wrap(f,9,r.label,noteX-M-24),h=Math.max(lab.length,1)*11+2;need(h+4);
     if(r.kind==='heading'){y-=3;}
     if(r.kind==='total'||r.kind==='subtotal')page.drawLine({start:{x:cur-90,y:y+9},end:{x:pri,y:y+9},thickness:r.kind==='total'?0.8:0.4,color:grey});
     lab.forEach((ln,i)=>page.drawText(ln,{x:M+(r.kind==='line'?8:0),y:y-i*11,size:9,font:f}));
     if(r.note)page.drawText(String(r.note),{x:noteX-font.widthOfTextAtSize(String(r.note),8.5)/2,y,size:8.5,font});
     if(r.kind!=='heading'){right(r.current,cur,9,f);if(b.has_prior)right(r.prior??'Not available',pri,9,f);}
     y-=h;
    }
    y-=6;break;}
   case 'matrix':{
    if(b.caption){para(b.caption,{size:9,f:bold,gap:1});}
    const cols=b.columns.length,lw=Math.min(210,TEXT-cols*70),cw=(TEXT-lw)/cols;
    need(18);b.columns.forEach((c,i)=>{const s=wrap(bold,8,String(c),cw-4)[0]||'';page.drawText(s,{x:M+lw+(i+1)*cw-bold.widthOfTextAtSize(s,8),y,size:8,font:bold});});y-=5;page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:0.4,color:grey});y-=10;
    for(const r of b.rows){const f=r.total?bold:font,lab=wrap(f,8.5,r.label,lw-6),h=Math.max(lab.length,1)*10.5+2;need(h+3);
     if(r.total)page.drawLine({start:{x:M+lw,y:y+9},end:{x:W-M,y:y+9},thickness:0.5,color:grey});
     lab.forEach((ln,i)=>page.drawText(ln,{x:M,y:y-i*10.5,size:8.5,font:f}));
     r.cells.forEach((v,i)=>{const s=num(v);page.drawText(s,{x:M+lw+(i+1)*cw-f.widthOfTextAtSize(s,8.5),y,size:8.5,font:f});});y-=h;}
    y-=6;break;}
   case 'schedule':{
    const cols=[['opening_cost','Opening cost'],['additions','Additions'],['disposals','Disposals'],['closing_cost','Closing cost'],['opening_acc','Opening dep.'],['charge','Charge'],['released','Released'],['closing_acc','Closing dep.'],['nbv','Net book value']],lw=76,cw=(TEXT-lw)/cols.length;
    para('Property, plant and equipment: movement schedule',{size:9,f:bold,gap:1});
    need(18);cols.forEach(([k,l],i)=>page.drawText(l,{x:M+lw+(i+1)*cw-bold.widthOfTextAtSize(l,6.2),y,size:6.2,font:bold}));y-=5;page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:0.4,color:grey});y-=9;
    const row=(label,g,f)=>{need(12);page.drawText(safe(String(label)).slice(0,18),{x:M,y,size:6.8,font:f});cols.forEach(([k],i)=>{const s=num(g[k]);page.drawText(s,{x:M+lw+(i+1)*cw-f.widthOfTextAtSize(s,6.8),y,size:6.8,font:f});});y-=10;};
    for(const g of b.schedule.classes)row(g.name?`${g.account} ${g.name}`:g.account,g,font);row('Total',b.schedule.totals,bold);y-=4;
    if(b.schedule.policy)para(typeof b.schedule.policy==='string'?b.schedule.policy:'',{size:7.5,color:grey});break;}
  }
 };
 for(const s of model.sections){
  cover=s.code==='COVER'&&s.ready;newPage();
  if(!cover){page.drawRectangle({x:M-2,y:y-4,width:TEXT+4,height:18,color:light});draw(s.title,M+2,12,bold,green);y-=24;}
  if(!s.ready){para(s.blocks.map(b=>b.text).join(' '),{color:red});}
  else for(const b of s.blocks)block(b);
  cover=false;
  if(s.attachment&&attachmentBytes){
   const src=await PDFDocument.load(attachmentBytes,{ignoreEncryption:false}),pages=await doc.copyPages(src,src.getPageIndices());for(const p of pages)doc.addPage(p);
  }
 }
 // The status word as a watermark and the footer, on the pack's own pages only (never on the signed report).
 const total=own.length;
 own.forEach((p,i)=>{
  if(model.status.watermark){const t=safe(model.status.watermark),size=t.length>10?54:72,w=bold.widthOfTextAtSize(t,size);
   p.drawText(t,{x:W/2-(w/2)*Math.cos(Math.PI/4)+size*0.18,y:H/2-(w/2)*Math.sin(Math.PI/4),size,font:bold,color:rgb(0.85,0.85,0.85),rotate:degrees(45),opacity:0.5});}
  p.drawText(safe(`${model.client.name} · ${model.status.word} · Fingerprint ${String(fingerprint).slice(0,16)} · Page ${i+1} of ${total}`),{x:M,y:18,size:7,font,color:grey});
 });
 return await doc.save();
}
