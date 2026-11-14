import {fail} from './validation.mjs';
import {vat3Schedules} from './vat3-rules.mjs';
import {workbook} from './workbook-file.ts';
const dateText=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
// The VAT3 schedules workbook from a locked VAT case. Kept apart from suite-export so it loads without the PDF library.
export async function vat3File(c:any,client:any,staffNames:Map<string,string>,rows:any[],calculated:any,locked:boolean){
 if(c.kind!=='VAT')fail(400,'The VAT3 schedules are only available for a VAT case.');
 if(!locked)fail(400,'The VAT3 schedules are available once the Manager has locked the VAT case.');
 if(calculated.testing_only===true)fail(400,'This case used a testing rate and is not for filing.');
 const v=vat3Schedules({rows,result:calculated,inputs:c.inputs||{}});
 const bytes=await workbook([
  ['Start Here',['Read before using','Instruction'],[
   ['Purpose','VAT3 schedules prepared from the Manager-reviewed VAT case, in the order of the KRA VAT annexes.'],
   ['Important','This is a preparation file, not a KRA submission or receipt. Confirm the schedule letters and column order against the current KRA VAT return before uploading or keying figures into iTax.'],
   ['Client',client.company_name],['KRA PIN',client.kra_pin||'Not recorded'],['Return period',`${dateText(c.starts_on)} to ${dateText(c.ends_on)}`],['ERP case status',c.status],['Case reference',c.case_id],
   ['Reviewed by',staffNames.get(c.reviewed_by)||'Not recorded'],['Only reviewed lines',`Sales lines are included when confirmed and purchase lines when eligible. Skipped: ${v.counts.skipped.sales} sales, ${v.counts.skipped.purchases} purchases.`],
   ['Tie-out',v.issues.length?'REVIEW REQUIRED':'Schedules agree to the tax case'],...v.issues.map((x:string)=>['Action required',x])
  ]],...v.sheets]);
 return {bytes,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',name:`VAT3_Schedules_${dateText(c.starts_on)}_${dateText(c.ends_on)}_${String(c.case_id).slice(0,8)}.xlsx`};
}
