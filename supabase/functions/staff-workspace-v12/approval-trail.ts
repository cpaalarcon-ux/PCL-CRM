// Approval trail for exports: who prepared, checked, approved or returned a record, when, and with what comment.
// Read through erp_private.approval_trail (a narrow function over the append-only audit log), never from the table directly.
export const TRAIL_HEADERS=['Time (UTC)','Step','User','Role','Comment'];
export async function approvalTrailRows(tx:any,table:string,keys:string[]):Promise<any[][]>{
 const ids=keys.filter(Boolean).map(String);if(!ids.length)return [];
 const rows=await tx`select occurred_at,step,comment,who_name,who_role from erp_private.approval_trail(${table}::text,${tx.array(ids)}::text[])`;
 return rows.map((r:any)=>[new Date(r.occurred_at).toISOString().replace('T',' ').slice(0,19),r.step,r.who_name,r.who_role,r.comment||'']);
}
