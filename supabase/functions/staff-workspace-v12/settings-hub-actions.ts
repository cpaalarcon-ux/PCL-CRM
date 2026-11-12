import {fail} from './validation.mjs';
import {buildHub} from './settings-hub-rules.mjs';
import {lockedStarters} from './bank-starter-rules.mjs';

// Settings hub (build 2787): counts only, read through erp_private.settings_hub(). It changes nothing.
export async function settingsHubAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action!=='settings_hub_read')return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'The settings hub is for Managers and Partners.');
 const rows=await tx`select section_key,pending,total from erp_private.settings_hub()`;
 const counts=rows.map((r:any)=>({section_key:r.section_key,pending:Number(r.pending),total:Number(r.total)}));
 // Locked bank starter rules still waiting for the Tax Lead's recorded confirmation (build 2788); counted here because which starters are locked is a rule in code.
 const conf=await tx`select rule_key,account_code,status from erp_private.starter_rule_confirmations where status='Confirmed'`;
 const locked=lockedStarters(conf);
 counts.push({section_key:'starter_confirmations',pending:locked.filter((x:any)=>x.locked).length,total:locked.length});
 return buildHub(counts);
}
