import {scheduleSheets,LAYOUT} from './wht-vat-rules.mjs';
import {workbook} from './workbook-file.ts';
const base64=(bytes:Uint8Array)=>{let str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(str);};
// The withholding VAT schedule (sections A and B of KRA's return) for one payment month. A preparation file: the KRA workbook validates and builds its own upload file.
export async function whtVatFile(client:any,month:string,lines:any[]){
 const t=scheduleSheets({lines,client,month});
 const bytes=await workbook([
  ['Start Here',['Read before using','Instruction'],[
   ['Purpose','Schedule of VAT withheld from suppliers, prepared from purchase invoices and payment dates, in the section order of the KRA Withholding VAT return.'],
   ['Important','This is a preparation file, not a KRA submission or receipt. Key or paste these rows into the current KRA Withholding VAT workbook, let it validate, and confirm its version first.'],
   ['Layout used',`${LAYOUT.code}: ${LAYOUT.source}`],['Client',client.company_name],['KRA PIN',client.kra_pin||'Not recorded'],['Payment month',month],
   ['Rate source','Each line carries the rate from the effective-dated withholding VAT rule on its payment date. It is not fixed in this file.'],
   ['Rounding','The ERP keeps each amount to the cent. This file shows the whole-shilling figure the KRA workbook calculates (rounded up).'],
   ['Tie-out',t.issues.length>1?'REVIEW REQUIRED':'Schedule agrees to the ERP lines'],...t.issues.map((x:string)=>['Action required',x])
  ]],...t.sheets]);
 return {bytes,base64:base64(bytes),mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',name:`WHT_VAT_Schedule_${month}_${String(client.company_name).replace(/[^A-Za-z0-9]+/g,'_').slice(0,40)}.xlsx`,issues:t.issues,count:t.counts.lines};
}
