// The firm's invoice follows its sample invoice: centred header, number and date box, bill-to box, boxed lines table,
// totals with bold labels, the thank-you line straight after the content, and no internal notes or page number on a one-page invoice.
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import zlib from 'node:zlib';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let PDFLib;try{PDFLib=require('pdf-lib');}catch{PDFLib=require(path.resolve(import.meta.dirname,'..','supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));}
const {invoicePdf}=await import('../supabase/functions/staff-workspace-v12/invoice-pdf.mjs');
const text=bytes=>{const buf=Buffer.from(bytes),raw=buf.toString('latin1'),parts=[];let at=0;for(;;){const a=raw.indexOf('stream',at);if(a<0)break;if(raw.slice(a-3,a)==='end'){at=a+6;continue;}let st=a+6;if(raw[st]==='\r')st++;if(raw[st]==='\n')st++;const en=raw.indexOf('endstream',st);if(en<0)break;let body=buf.subarray(st,en);try{body=zlib.inflateSync(body);}catch{}parts.push(body.toString('latin1'));at=en+9;}
 return parts.flatMap(x=>[...x.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1'))).join('\n');};
const base=(over={},lines=1)=>({invoice:{status:'Posted',invoice_number:'INV/FIC/00001',invoice_date:'2026-11-01',due_date:null,net_amount:2586.21,vat_amount:413.79,paid_amount:0,brought_forward:25600,description:'',lines:Array.from({length:lines},(_,n)=>({description:'Tax Compilation And Compliance 1 Month '+n,quantity:1,unit_price:3000,total:3000}))},
 firm:{legal_name:'Fictional Consulting Ltd',kra_pin:'P000000001A',phone:'0700000000',email:'billing@fictional.example',physical_address:'Kenya',payment_instructions:''},client:{name:'FICTIONAL CLIENT LTD',pin:'A000000002B',country:'Kenya'},logo:null,etims:null,...over});
const make=async d=>invoicePdf(d,{PDFDocument:PDFLib.PDFDocument,StandardFonts:PDFLib.StandardFonts,rgb:PDFLib.rgb});
test('a one-page invoice has no page number, no internal payment note, and the thank-you line follows the totals',async()=>{
 const bytes=await make(base()),t=text(bytes);
 assert.equal((await PDFLib.PDFDocument.load(bytes)).getPageCount(),1);
 assert.doesNotMatch(t,/Page 1|not yet configured/);
 assert.match(t,/Net Amount[\s\S]*VAT[\s\S]*Current Invoice Amount[\s\S]*Amount Paid[\s\S]*Balance Brought Forward[\s\S]*Total Amount Due[\s\S]*Thank you for your continued trust/);
 assert.doesNotMatch(t,/Due:/,'no due date is printed when none is set');
});
test('a due date still prints when one is set, and payment instructions and the eTIMS number appear when recorded',async()=>{
 const t=text(await make(base({firm:{...base().firm,payment_instructions:'Fictional Bank, Account 0000'},etims:{etims_invoice_no:'ETIMS-1',etims_issued_on:'2026-11-02'}})));
 const withDue=text(await make({...base(),invoice:{...base().invoice,due_date:'2026-11-15'}}));
 assert.match(withDue,/Due: /);assert.match(t,/Payment instructions/);assert.match(t,/eTIMS invoice no: ETIMS-1/);
});
test('a long invoice runs to several pages and numbers them',async()=>{
 const bytes=await make(base({},40));const n=(await PDFLib.PDFDocument.load(bytes)).getPageCount();assert.ok(n>1);
 const t=text(bytes);assert.match(t,new RegExp('Page 1 of '+n));assert.match(t,new RegExp('Page '+n+' of '+n));
});
