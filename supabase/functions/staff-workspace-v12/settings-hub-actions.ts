import {fail} from './validation.mjs';
import {buildHub} from './settings-hub-rules.mjs';

// Settings hub (build 2787): counts only, read through erp_private.settings_hub(). It changes nothing.
export async function settingsHubAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action!=='settings_hub_read')return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'The settings hub is for Managers and Partners.');
 const rows=await tx`select section_key,pending,total from erp_private.settings_hub()`;
 return buildHub(rows.map((r:any)=>({section_key:r.section_key,pending:Number(r.pending),total:Number(r.total)})));
}
