// Issued letters: the ERP lays the approved letter on the firm letterhead, adds the letter-details QR
// and fixes the PDF metadata to the issue time, so the same record always produces the same bytes.
// The SHA-256 of the issued PDF is stored; a later download is checked against it.
import qrcode from './vendor/qrcode-generator-2.0.4.mjs';

const line=v=>String(v??'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
// Same text as the on-screen letter QR (staff-communication-qr.mjs): date, ref, from, to, purpose, signatory.
export function letterDetails({reference,subject,issuedBy,addressedTo,attention,signatory,letterDate}){
 if(!line(reference)||!line(issuedBy)||!line(addressedTo)||!line(signatory))throw Error('The letter needs a reference, issuing firm, addressee and signatory before its QR can be created.');
 const rows=[['DATE',letterDate],['REF',reference],['FROM',issuedBy],['TO',line(attention)?`${line(addressedTo)} (Attn: ${line(attention)})`:addressedTo],['PURPOSE',subject],['SIGNATORY',signatory]];
 let text=rows.map(([k,v])=>`${k}: ${line(v)}`).join('\n');
 if(text.length>700){const over=text.length-700,re=line(subject);text=text.replace(`PURPOSE: ${re}`,`PURPOSE: ${re.slice(0,Math.max(10,re.length-over-3))}...`);}
 if(text.length>700)throw Error('The letter details are too long for one QR. Shorten the subject.');
 return text;
}
const utf8=v=>Array.from(new TextEncoder().encode(v),b=>String.fromCharCode(b)).join('');
export function qrMatrix(text){const qr=qrcode(0,'M');qr.addData(utf8(text),'Byte');qr.make();const n=qr.getModuleCount();return Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>qr.isDark(r,c)));}
// Standard PDF fonts cover Windows-1252 only; anything else is replaced rather than failing the letter.
const WIN=new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
export const safe=v=>String(v??'').replace(/\t/g,'  ').split('').map(ch=>{const c=ch.charCodeAt(0);return c===10||c>=32&&c<=126||c>=160&&c<=255||WIN.has(ch)?ch:'?';}).join('');

export function wrap(font,size,text,width){
 const out=[];for(const para of safe(text).split('\n')){let cur='';for(const word of para.split(' ')){const next=cur?cur+' '+word:word;if(font.widthOfTextAtSize(next,size)<=width){cur=next;continue;}if(cur)out.push(cur);let w=word;while(font.widthOfTextAtSize(w,size)>width){let i=w.length;while(i>1&&font.widthOfTextAtSize(w.slice(0,i),size)>width)i--;out.push(w.slice(0,i));w=w.slice(i);}cur=w;}out.push(cur);}
 return out;
}

// pdf-lib is passed in by the caller (the server imports it; tests load the pinned copy).
export async function letterPdf(l,{PDFDocument,StandardFonts,rgb}){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const when=new Date(l.issued_at);doc.setTitle(safe(`${l.reference} · ${l.subject}`));doc.setAuthor(safe(l.firm.legal_name));doc.setCreator('PCL Practice Management System');doc.setProducer('PCL Practice Management System');doc.setCreationDate(when);doc.setModificationDate(when);
 const W=595.28,H=841.89,M=56,green=rgb(0.05,0.25,0.18),grey=rgb(0.35,0.35,0.35),text=W-2*M;
 let page=doc.addPage([W,H]),y=H-M,pageNo=1;
 const header=()=>{page.drawText(safe(l.firm.legal_name).toUpperCase(),{x:M,y:H-M,size:15,font:bold,color:green});
  const meta=[l.firm.physical_address,[l.firm.phone,l.firm.email].filter(Boolean).join(' · '),l.firm.kra_pin?'KRA PIN: '+l.firm.kra_pin:''].filter(Boolean);
  let hy=H-M-16;for(const m of meta){page.drawText(safe(m),{x:M,y:hy,size:8.5,font,color:grey});hy-=11;}
  page.drawLine({start:{x:M,y:hy-2},end:{x:W-M,y:hy-2},thickness:1,color:green});y=hy-24;};
 const footer=()=>{page.drawText(safe(`${l.reference} · Issued ${l.issued_on} from PCL Practice Management System · Page ${pageNo}`),{x:M,y:28,size:7.5,font,color:grey});};
 const need=h=>{if(y-h<M+90){footer();page=doc.addPage([W,H]);pageNo++;header();}};
 const para=(t,size=10.5,f=font,gap=4)=>{for(const ln of wrap(f,size,t,text)){need(size+3);page.drawText(ln,{x:M,y,size,font:f});y-=size+3;}y-=gap;};
 header();
 para(`Reference: ${l.reference}`,10.5,bold,0);para(`Date: ${l.letter_date_text}`,10.5,font,10);
 para(`To: ${l.addressed_to}`,10.5,bold,0);if(l.attention)para(`Attention: ${l.attention}`,10.5,font,0);y-=10;
 para(l.subject,12.5,bold,6);para(`Purpose: ${l.purpose}`,10.5,font,8);
 for(const p of String(l.details||'').split(/\n{2,}/))para(p,10.5,font,8);
 need(110);y-=14;para(l.signatory_name,10.5,bold,0);if(l.signatory_role)para(l.signatory_role,10,font,0);para(l.firm.legal_name,10,font,0);
 // Letter-details QR, bottom right of the last page.
 const m=qrMatrix(l.qr_text),cell=2.2,size=m.length*cell,qx=W-M-size,qy=M+10;
 page.drawRectangle({x:qx-6,y:qy-6,width:size+12,height:size+12,color:rgb(1,1,1)});
 m.forEach((row,r)=>row.forEach((dark,c)=>{if(dark)page.drawRectangle({x:qx+c*cell,y:qy+size-(r+1)*cell,width:cell,height:cell,color:rgb(0,0,0)});}));
 page.drawText('Scan for letter details',{x:qx,y:qy-16,size:7,font,color:grey});
 footer();
 return await doc.save({useObjectStreams:false});
}
