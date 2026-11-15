import {fail} from './validation.mjs';
import {tot3Sheets,LAYOUT} from './tot3-rules.mjs';
import {workbook} from './workbook-file.ts';
const dateText=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
// The TOT3 workings from a locked Turnover Tax case. Kept apart from suite-export so it loads without the PDF library. Nothing is sent to KRA.
export async function tot3File(c:any,client:any,staffNames:Map<string,string>,rows:any[],calculated:any,locked:boolean){
 if(c.kind!=='TOT')fail(400,'The TOT3 workings are only available for a Turnover Tax case.');
 if(!locked)fail(400,'The TOT3 workings are available once the Manager has locked the TOT case.');
 if(calculated.testing_only===true)fail(400,'This case used a testing rate and is not for filing.');
 const t=tot3Sheets({rows,result:calculated,c,client,partners:[]});
 const bytes=await workbook([
  ['Start Here',['Read before using','Instruction'],[
   ['Purpose','TOT3 workings prepared from the Manager-reviewed Turnover Tax case, in the section order of the KRA TOT3 return.'],
   ['Important','This is a preparation file, not a KRA submission or receipt. The TOT3 return is a KRA workbook that validates and generates its own upload file: key or paste these figures into the current KRA file and confirm its version first.'],
   ['Layout used',`${LAYOUT.code}: ${LAYOUT.source}`],['Client',client.company_name],['KRA PIN',client.kra_pin||'Not recorded'],['Return period',`${dateText(c.starts_on)} to ${dateText(c.ends_on)}`],['ERP case status',c.status],['Case reference',c.case_id],
   ['Rate source','The turnover tax rate is the one in the locked case, taken from the effective-dated rule for the period. It is not fixed in this file.'],
   ['Reviewed by',staffNames.get(c.reviewed_by)||'Not recorded'],['Tie-out',t.issues.length?'REVIEW REQUIRED':'Workings agree to the tax case'],...t.issues.map((x:string)=>['Action required',x])
  ]],...t.sheets]);
 return {bytes,mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',name:`TOT3_Workings_${dateText(c.starts_on)}_${dateText(c.ends_on)}_${String(c.case_id).slice(0,8)}.xlsx`};
}
