// Dispatch note / return slip for a physical file returned to its client. Laid out by the ERP, with a signature block for the person who receives the file.
// The same record gives the same bytes. Nothing here is a tax document; it is an office record.
import {safe,wrap} from './letter-pdf.mjs';
import {formatDay} from './suite-rules.mjs';

export const DISPATCH_METHODS=['Hand delivery','Courier','Post','Collected by client'];

export async function dispatchNotePdf(d,{PDFDocument,StandardFonts,rgb}){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const when=new Date(d.movement.moved_at);doc.setTitle(safe(`Dispatch note ${d.movement.dispatch_note_no}`));doc.setAuthor(safe(d.firm.legal_name));doc.setCreator('PCL Nexus');doc.setProducer('PCL Nexus');doc.setCreationDate(when);doc.setModificationDate(when);
 const W=595.28,H=841.89,M=48,CW=W-2*M,grey=rgb(.35,.35,.35),light=rgb(.8,.8,.8),ink=rgb(0,0,0);
 const page=doc.addPage([W,H]);let y=H-M;
 const centre=(t,size,f,yy,c=ink)=>{const s=safe(t);page.drawText(s,{x:(W-f.widthOfTextAtSize(s,size))/2,y:yy,size,font:f,color:c});};
 centre(String(d.firm.legal_name).toUpperCase(),14,bold,y-12);y-=28;
 const contact=[d.firm.physical_address,d.firm.kra_pin?'PIN: '+d.firm.kra_pin:'',d.firm.phone?'Tel: '+d.firm.phone:'',d.firm.email].filter(Boolean).join(' | ');
 if(contact){centre(contact,7.5,font,y,grey);y-=12;}
 page.drawLine({start:{x:M,y:y-2},end:{x:W-M,y:y-2},thickness:.8,color:ink});y-=24;
 centre('D I S P A T C H   N O T E   /   R E T U R N   S L I P',11,bold,y);y-=26;
 const row=(k,v)=>{page.drawText(safe(k),{x:M,y,size:10,font:bold});const lines=wrap(font,10,String(v||'-'),CW-150);lines.forEach((l,i)=>page.drawText(l,{x:M+150,y:y-i*13,size:10,font}));y-=Math.max(1,lines.length)*13+6;};
 row('Dispatch note no.',d.movement.dispatch_note_no);
 row('Physical file ref.',d.file.file_ref);
 row('Date and time',formatDay(when.toISOString())+' '+new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Africa/Nairobi'}).format(when)+' (Nairobi)');
 row('Client',d.client.name+(d.client.pin?' · PIN '+d.client.pin:''));
 row('Contents',d.file.description);
 if(d.file.ticket_number)row('Support ticket','CST-'+d.file.ticket_number);
 row('Received in the office',formatDay(d.file.received_on)+(d.file.received_from?' from '+d.file.received_from:''));
 row('Returned to',d.movement.dispatch_recipient);
 row('Method',d.movement.dispatch_method);
 row('Tracking / signature ref.',d.movement.dispatch_reference);
 row('Scanned copy kept',d.file.digital_name?d.file.digital_name:('None: '+(d.file.no_scan_reason||'')));
 row('Released by',d.movement.moved_by_name);
 if(d.movement.note)row('Note',d.movement.note);
 y-=14;
 page.drawText('Please check the contents and sign below to confirm you have received this file.',{x:M,y,size:9,font,color:grey});y-=44;
 for(const [label,x] of [['Received by (name)',M],['Signature',M+CW*.38],['Date',M+CW*.74]]){
  page.drawLine({start:{x,y},end:{x:x+CW*.32,y},thickness:.7,color:ink});page.drawText(label,{x,y:y-12,size:8.5,font,color:grey});
 }
 y-=50;
 page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.5,color:light});
 page.drawText('Keep a signed copy with the ticket before it is closed.',{x:M,y:y-14,size:8,font,color:grey});
 return await doc.save();
}
