// v12 requires a client account mapping for every ERP account a client uses. Tests that exercise
// accounting flows (not the mapping control itself) give the fictional client an Active mapping for
// every active account: prepared by one leader and activated by another, as the database guard requires.
export async function mapAllAccounts(tx,as,clientId,{creator='MANAGER',approver='PARTNER',from='2020-01-01'}={}){
 const accounts=await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code`;
 await as(creator,async a=>{for(const {code} of accounts)await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by) values(${clientId},${'FIXTURE-'+code},${'Fixture mapping '+code},${code},${from},${a.staff_id})`;});
 await as(approver,async a=>{await tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where client_id=${clientId} and status='Draft' and source_account_code like 'FIXTURE-%'`;});
 return accounts.length;
}
