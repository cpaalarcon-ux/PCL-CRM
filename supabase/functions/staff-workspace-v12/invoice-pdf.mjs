// Invoice PDF: laid out by the ERP, not printed from the browser. Header with the firm's logo, name and contact line; invoice number
// and date; Bill To; a lines table; a totals block (net, VAT, this invoice, paid, balance brought forward, total due); payment
// instructions; and, once recorded, the eTIMS number and QR. A draft carries a DRAFT watermark. The same record gives the same bytes.
import {qrMatrix,safe,wrap} from './letter-pdf.mjs';
import {formatDay} from './suite-rules.mjs';
const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const THANKS='Thank you for your continued trust and partnership. We truly appreciate your business.';
export function invoiceTotals(i){
 const net=Number(i.net_amount),vat=Number(i.vat_amount),total=Math.round((net+vat+Number.EPSILON)*100)/100,paid=Number(i.paid_amount||0),bf=Number(i.brought_forward||0);
 return {net,vat,total,paid,brought_forward:bf,due:Math.round((total-paid+bf+Number.EPSILON)*100)/100};
}
export async function invoicePdf(d,{PDFDocument,StandardFonts,rgb}){
 const i=d.invoice,t=invoiceTotals(i),draft=i.status==='Draft',doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),italic=await doc.embedFont(StandardFonts.HelveticaBoldOblique);
 const when=new Date(String(i.invoice_date).slice(0,10)+'T00:00:00Z');doc.setTitle(safe(`Invoice ${i.invoice_number||'DRAFT'}`));doc.setAuthor(safe(d.firm.legal_name));doc.setCreator('PCL Nexus');doc.setProducer('PCL Nexus');doc.setCreationDate(when);doc.setModificationDate(when);
 const W=595.28,H=841.89,M=36,CW=W-2*M,grey=rgb(.35,.35,.35),light=rgb(.85,.85,.85),pale=rgb(.94,.94,.94),blue=rgb(.12,.3,.5),ink=rgb(0,0,0);
 let logo=null;if(d.logo?.bytes?.length){try{logo=d.logo.mime_type==='image/png'?await doc.embedPng(d.logo.bytes):await doc.embedJpg(d.logo.bytes);}catch{logo=null;}}
 let page=doc.addPage([W,H]),y=H-M,pageNo=1;
 const centre=(txt,size,f,yy,color=ink)=>{const s=safe(txt);page.drawText(s,{x:(W-f.widthOfTextAtSize(s,size))/2,y:yy,size,font:f,color});};
 const right=(txt,size,f,xr,yy,color=ink)=>{const s=safe(txt);page.drawText(s,{x:xr-f.widthOfTextAtSize(s,size),y:yy,size,font:f,color});};
 const watermark=()=>{if(!draft)return;const s='DRAFT — NOT ISSUED';page.drawText(safe(s),{x:95,y:290,size:44,font:bold,color:rgb(.88,.88,.88),rotate:{type:'degrees',angle:35}});};
 const header=first=>{
  if(!first){page.drawText(safe(`${d.firm.legal_name} · Invoice ${i.invoice_number||'DRAFT'} (continued)`),{x:M,y:H-M,size:9,font:bold,color:grey});y=H-M-24;return;}
  if(logo){const sc=Math.min(170/logo.width,56/logo.height,1),w=logo.width*sc,h=logo.height*sc;page.drawImage(logo,{x:(W-w)/2,y:y-h,width:w,height:h});y-=h+6;}
  centre(String(d.firm.legal_name).toUpperCase(),14,bold,y-12);y-=28;
  const contact=[d.firm.physical_address,d.firm.kra_pin?'PIN: '+d.firm.kra_pin:'',d.firm.phone?'Tel: '+d.firm.phone:'',d.firm.email].filter(Boolean).join(' | ');
  if(contact){centre(contact,7.5,font,y,grey);y-=12;}
  page.drawLine({start:{x:M,y:y-2},end:{x:W-M,y:y-2},thickness:.8,color:ink});y-=18;
  const word='I N V O I C E';centre(word,10.5,bold,y);y-=14;
 };
 const footer=()=>{};
 const newPage=()=>{footer();page=doc.addPage([W,H]);pageNo++;header(false);watermark();};
 watermark();header(true);
 // Number and date box
 page.drawRectangle({x:M,y:y-38,width:CW,height:38,borderColor:light,borderWidth:.8});
 page.drawText('Invoice Number:',{x:M+10,y:y-15,size:11.5,font:bold});page.drawText(safe(i.invoice_number||'DRAFT — NOT ISSUED'),{x:M+CW*.47,y:y-15,size:11.5,font:bold,color:blue});
 page.drawText('Invoice Date:',{x:M+10,y:y-31,size:11.5,font:bold});page.drawText(formatDay(i.invoice_date),{x:M+CW*.47,y:y-31,size:11.5,font});
 if(i.due_date)right('Due: '+formatDay(i.due_date),9,font,W-M-8,y-31,grey);
 y-=50;
 // Bill to
 const bill=[d.client.name,d.client.attention,d.client.address,d.client.country||'Kenya',d.client.pin?'Tax ID: '+d.client.pin:''].filter(Boolean),bh=12+bill.length*10.5;
 page.drawRectangle({x:M,y:y-bh,width:CW,height:bh,borderColor:light,borderWidth:.8});
 page.drawText('Bill To:',{x:M+8,y:y-11,size:8.5,font:bold});
 bill.forEach((l,n)=>page.drawText(safe(l),{x:M+8,y:y-22-n*10.5,size:n===0?9.5:8.5,font:n===0?bold:font}));
 y-=bh+10;
 // Lines
 const colNo=M+4,colDesc=M+34,colAmt=W-M-6,descW=colAmt-colDesc-100;
 const divX=colDesc-6,vline=(y0,y1)=>page.drawLine({start:{x:divX,y:y0},end:{x:divX,y:y1},thickness:.5,color:light});
 const head=()=>{page.drawRectangle({x:M,y:y-20,width:CW,height:20,color:light});vline(y,y-20);page.drawText('#',{x:colNo+8,y:y-14,size:11,font:bold});centre('Description',11,bold,y-14);right('Amount',11,bold,colAmt,y-14);y-=20;};
 head();
 page.drawRectangle({x:M,y:y-20,width:CW,height:20,color:pale});vline(y,y-20);page.drawText('To our professional fees:',{x:colDesc,y:y-14,size:11,font:bold});right('KShs.',11,bold,colAmt,y-14);y-=20;
 const lines=Array.isArray(i.lines)?i.lines:[];
 lines.forEach((l,n)=>{
  let text=String(l.description||'');if(l.line_type==='Disbursement')text+=' (disbursement, no VAT)';if(Number(l.quantity)!==1)text+=` (${l.quantity} × ${money(l.unit_price)}${l.includes_vat?' incl. VAT':''})`;
  if(l.milestone)text+=` · ${l.milestone}`;
  const wrapped=wrap(font,9.5,text,descW),h=Math.max(20,wrapped.length*12+8);
  if(y-h<M+230){newPage();head();}
  page.drawLine({start:{x:M,y:y-h},end:{x:W-M,y:y-h},thickness:.5,color:light});vline(y,y-h);page.drawLine({start:{x:M,y},end:{x:M,y:y-h},thickness:.5,color:light});page.drawLine({start:{x:W-M,y},end:{x:W-M,y:y-h},thickness:.5,color:light});
  page.drawText(String(n+1)+'.',{x:colNo+4,y:y-14,size:10,font:bold});wrapped.forEach((ln,k)=>page.drawText(ln,{x:colDesc,y:y-14-k*12,size:9.5,font}));
  right(money(l.total)+' KSh',9.5,font,colAmt,y-14);y-=h;
 });
 // Narration only when it adds to the lines
 const narr=String(i.description||'').trim();if(narr&&!lines.some(l=>String(l.description||'').trim()===narr)&&!narr.includes('·')){const w=wrap(italic,8.5,narr,CW);for(const ln of w){if(y<M+215)newPage();page.drawText(ln,{x:M,y:y-12,size:8.5,font,color:grey});y-=11;}y-=6;}
 // Totals
 if(y-170<M)newPage();
 y-=6;const tx=W-M-225,rows=[['Net Amount',t.net,false],['VAT',t.vat,false],['Current Invoice Amount',t.total,true],['Amount Paid',t.paid,false],['Balance Brought Forward',t.brought_forward,false],['Total Amount Due',t.due,true]];
 rows.forEach(([label,v,strong],n)=>{const last=n===rows.length-1;if(last)page.drawRectangle({x:tx-4,y:y-17,width:CW-(tx-M)+4,height:18,color:pale});page.drawLine({start:{x:tx-4,y:y+1},end:{x:W-M,y:y+1},thickness:.4,color:light});page.drawText(label,{x:tx,y:y-12,size:10.5,font:bold});right(money(v)+' KSh',10.5,strong?bold:font,W-M-4,y-12);page.drawLine({start:{x:tx-4,y:y+1},end:{x:tx-4,y:y-17},thickness:.5,color:light});y-=18;});
 page.drawLine({start:{x:tx-4,y:y+1},end:{x:W-M,y:y+1},thickness:.4,color:light});
 y-=14;
 // Payment instructions and eTIMS
 const pay=String(d.firm.payment_instructions||'').trim();
 if(pay){page.drawText('Payment instructions',{x:M,y,size:9,font:bold});y-=12;for(const ln of wrap(font,8.5,pay,CW*.6)){if(y<M+60)newPage();page.drawText(ln,{x:M,y,size:8.5,font});y-=11;}y-=4;}
 if(d.etims?.etims_invoice_no){const label=`eTIMS invoice no: ${d.etims.etims_invoice_no}${d.etims.etims_issued_on?' · '+formatDay(d.etims.etims_issued_on):''}`;page.drawText(safe(label),{x:M,y,size:8.5,font});y-=12;
  if(d.etims.qr_url){const m=qrMatrix(d.etims.qr_url),cell=Math.min(2.2,70/m.length),size=m.length*cell;if(y-size<M+30)newPage();m.forEach((row,r)=>row.forEach((dark,c)=>{if(dark)page.drawRectangle({x:W-M-size+c*cell,y:y-size+(m.length-1-r)*cell,width:cell,height:cell,color:ink});}));y-=size+4;}}
 // The thank-you line follows the content, as on the sample invoice, not the foot of the page.
 y-=6;if(y<M+30)newPage();
 page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.4,color:light});
 centre(THANKS,7.5,italic,y-13);
 // Page numbers only when the invoice runs to more than one page, as on the firm's sample invoice.
 if(doc.getPageCount()>1)doc.getPages().forEach((pg,n)=>pg.drawText(safe(`Page ${n+1} of ${doc.getPageCount()}`),{x:W-M-52,y:22,size:7.5,font,color:grey}));
 return doc.save({useObjectStreams:false});
}
