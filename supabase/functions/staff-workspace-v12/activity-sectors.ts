// Every dated activity is equal: there is no "main" activity. The client's sector list is whatever its current
// activities map to. clients.primary_sector stays only as a display field; it follows the activity with the largest
// turnover share (earliest start when shares are not entered) and is never used to decide a rule.
export const sectorForActivity:any={agriculture:'Agribusiness',construction:'Construction',education:'Education',financial:'Financial Services',healthcare:'Healthcare',hospitality:'Hospitality & Tourism',ict:'Information Technology',manufacturing:'Manufacturing',msme:'SME/Startup',mining:'Mining & Quarrying',nonprofit:'NGO',professional:'Professional Services',public:'Public Sector',real_estate:'Real Estate',retail:'Wholesale & Retail',transport:'Transport & Logistics',utilities:'Energy',wholesale:'Wholesale & Retail',other:'SME/Startup'};
export async function currentSectors(tx:any,clientId:string,asOf?:string){
 const day=asOf||new Date().toISOString().slice(0,10);
 const rows=await tx`select activity_code from erp_private.client_activities where client_id=${clientId} and effective_from<=${day} and (effective_to is null or effective_to>=${day}) order by turnover_share desc nulls last,effective_from,activity_name`;
 return [...new Set(rows.map((r:any)=>sectorForActivity[r.activity_code]||'SME/Startup'))] as string[];
}
export async function syncClientSector(tx:any,clientId:string){
 const sectors=await currentSectors(tx,clientId);if(!sectors.length)return null;
 await tx`update erp_private.clients set primary_sector=${sectors[0]} where client_id=${clientId} and primary_sector is distinct from ${sectors[0]}`;return sectors[0];
}
