import {safe,wrap} from './letter-pdf.mjs';
// The MLRO confirmation as a PDF: the same wording as the form's MLRO Confirmation tab, then the schedule of clients.
// pdf-lib is passed in by the caller. The PDF carries the batch reference and a fingerprint so a signed copy can be matched to it.
export async function onboardingConfirmationPdf(t,{firm,issued_at,digest},{PDFDocument,StandardFonts,rgb}){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 doc.setTitle(safe(t.title));doc.setAuthor(safe(firm?.legal_name||'PCL Nexus'));doc.setCreator('PCL Nexus');doc.setProducer('PCL Nexus');
 const when=new Date(issued_at);doc.setCreationDate(when);doc.setModificationDate(when);
 const W=595.28,H=841.89,M=42,green=rgb(0.05,0.25,0.18),grey=rgb(0.35,0.35,0.35),width=W-2*M;
 let page=doc.addPage([W,H]),y=H-M,no=1;
 const footer=()=>page.drawText(safe(`${t.subtitle.split('   |')[0]} · Fingerprint ${String(digest).slice(0,16)} · Page ${no}`),{x:M,y:20,size:7.5,font,color:grey});
 const header=()=>{page.drawText(safe(firm?.legal_name||'').toUpperCase(),{x:M,y:H-M,size:13,font:bold,color:green});page.drawLine({start:{x:M,y:H-M-8},end:{x:W-M,y:H-M-8},thickness:1,color:green});y=H-M-28;};
 const need=h=>{if(y-h<M+16){footer();page=doc.addPage([W,H]);no++;header();}};
 const para=(s,size=9.5,f=font,gap=5,color=undefined)=>{for(const ln of wrap(f,size,s,width)){need(size+3);page.drawText(ln,{x:M,y,size,font:f,color});y-=size+3;}y-=gap;};
 const head=s=>{need(30);y-=4;page.drawRectangle({x:M-2,y:y-4,width:width+4,height:16,color:rgb(0.9,0.94,0.92)});page.drawText(safe(s),{x:M+2,y,size:10.5,font:bold,color:green});y-=20;};
 const table=(cols,rows,size=8.5)=>{
  const draw=(cells,f)=>{const lines=cells.map((c,i)=>wrap(f,size,String(c??''),cols[i]-6)),n=Math.max(1,...lines.map(l=>l.length));need(n*(size+2)+4);
   let x=M;cells.forEach((c,i)=>{lines[i].forEach((ln,j)=>page.drawText(ln,{x:x+2,y:y-j*(size+2),size,font:f}));x+=cols[i];});y-=n*(size+2)+4;};
  return {head:cells=>{draw(cells,bold);page.drawLine({start:{x:M,y:y+2},end:{x:W-M,y:y+2},thickness:0.5,color:grey});},row:cells=>draw(cells,font)};
 };
 header();para(t.title,14,bold,2,green);para(t.subtitle,9.5,font,8,grey);
 for(const s of t.sections){
  head(s.h);for(const p of s.p)para(p);
  if(s.table){const tb=table([150,90,170,width-410],s.table);tb.head(['Check','Carried out on','By / against','Result']);for(const r of s.table)tb.row([r.label,r.on,r.by,r.result]);y-=4;}
  for(const p of s.after||[])para(p);
 }
 need(80);y-=8;for(const l of t.signature)para(l,10,l.startsWith('Signature')?bold:font,6);
 footer();page=doc.addPage([W,H]);no++;header();head('Schedule of clients');
 const tb=table([22,150,68,120,44,width-404],t.schedule);tb.head(['#','Client','KRA PIN','Activity','Rating','Condition of acceptance']);
 for(const r of t.schedule)tb.row([r.n,r.name,r.pin,r.activity,r.rating,r.condition]);
 footer();
 return await doc.save();
}
