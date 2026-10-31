import qrcode from './vendor/qrcode-generator-2.0.4.mjs';
export function communicationUrl(opaque,origin){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opaque||''))throw Error('Communication reference is missing. Refresh and reopen the record.');
 const url=new URL('/staff-pilot',origin);if(url.protocol!=='https:'&&url.hostname!=='localhost')throw Error('Use the secure ERP address.');url.hash='communication='+opaque;return url.toString();
}
export function communicationQr(opaque,origin){const url=communicationUrl(opaque,origin),qr=qrcode(0,'M');qr.addData(url);qr.make();return {url,svg:qr.createSvgTag({cellSize:4,margin:16,scalable:true})};}
