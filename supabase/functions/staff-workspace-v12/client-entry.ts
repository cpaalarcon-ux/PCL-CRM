import {branches,choice,fail,text,uuid} from './validation.mjs';

export async function readClientEntry(tx:any,p:any){
 const name=text(p.company_name,200),pin=p.kra_pin?text(p.kra_pin,11).toUpperCase():null;
 const [uatScope]=await tx`select erp_private.uat_scope_enabled() enabled`;
 const isUatFixture=!!uatScope.enabled&&/^UAT Fictional\b/i.test(name);
 if(uatScope.enabled&&!p.client_id&&!isUatFixture)fail(400,'This staging workspace accepts fictional test clients only. Start the company name with “UAT Fictional”.');
 if(pin&&!/^[A-Z][0-9]{9}[A-Z]$/.test(pin))fail(400,'Check the KRA PIN format.');
 const sector=p.primary_sector?text(p.primary_sector,100):null,branch=p.branch_location?choice(p.branch_location,branches):null;
 if(sector&&!(await tx`select sector_id from erp_private.sectors where name=${sector} and deleted_at is null`).length)fail(400,'Choose a saved sector, or add it with Add sector before saving this client.');
 const cat=p.legal_structure?null:p.client_category?choice(p.client_category,['Corporate','Non-Profit','Public Entity','Individual']):null;
 return {name,pin,sector,branch,cat,isUatFixture};
}

export function handlingFirmIds(p:any):string[]{
 const firms=Array.isArray(p.firm_ids)?p.firm_ids.map(uuid):[];
 if(!firms.length)fail(400,'Select at least one handling firm.');
 return firms;
}
