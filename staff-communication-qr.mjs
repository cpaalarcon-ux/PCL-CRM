import qrcode from './vendor/qrcode-generator-2.0.4.mjs';
export function communicationUrl(opaque,origin){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opaque||''))throw Error('Communication reference is missing. Refresh and reopen the record.');
 const url=new URL('/staff-pilot',origin);if(url.protocol!=='https:'&&url.hostname!=='localhost')throw Error('Use the secure ERP address.');url.hash='communication='+opaque;return url.toString();
}
export function communicationQr(opaque,origin){const url=communicationUrl(opaque,origin),qr=qrcode(0,'M');qr.addData(url);qr.make();return {url,svg:qr.createSvgTag({cellSize:4,margin:16,scalable:true})};}
// Letter details QR: scanning shows the letter's identifying details as plain text (no link), in the
// same order as the firm's dispatch QR: reference, subject, issuing firm, addressee, signatory, dates.
// It carries only what is printed on the letter itself, never client figures or ERP links.
const line=v=>String(v??'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
export function letterDetails({reference,subject,issuedBy,addressedTo,attention,signatory,letterDate,generatedOn}){
 if(!line(reference)||!line(issuedBy)||!line(addressedTo)||!line(signatory))throw Error('The letter needs a reference, issuing firm, addressee and signatory before its QR can be created.');
 const rows=[['REF',reference],['RE',subject],['ISSUED BY',issuedBy],['ADDRESSED TO',addressedTo],...(line(attention)?[['ATTENTION',attention]]:[]),['AUTHORIZED SIGNATORY',signatory],['LETTER DATE',letterDate],['GENERATION DATE',generatedOn]];
 let text=rows.map(([k,v])=>`${k}: ${line(v)}`).join('\n');
 if(text.length>700){const over=text.length-700,re=line(subject);text=text.replace(`RE: ${re}`,`RE: ${re.slice(0,Math.max(10,re.length-over-3))}...`);}
 if(text.length>700)throw Error('The letter details are too long for one QR. Shorten the subject.');
 return text;
}
const utf8=v=>Array.from(new TextEncoder().encode(v),b=>String.fromCharCode(b)).join('');
export function letterDetailsQr(details){const qr=qrcode(0,'M');qr.addData(utf8(details),'Byte');qr.make();return {text:details,svg:qr.createSvgTag({cellSize:4,margin:16,scalable:true})};}
