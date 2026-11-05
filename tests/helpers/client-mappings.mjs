// v12 requires a client account mapping for every ERP account a client uses. Tests that exercise
// accounting flows (not the mapping control itself) give the fictional client an Active mapping for
// every active account: prepared by one leader and activated by another, as the database guard requires.
export async function mapAllAccounts(tx,as,clientId,{creator='MANAGER',approver='PARTNER',from='2020-01-01'}={}){
 const accounts=await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code`;
 await as(creator,async a=>{for(const {code} of accounts)await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by) values(${clientId},${'FIXTURE-'+code},${'Fixture mapping '+code},${code},${from},${a.staff_id})`;});
 await as(approver,async a=>{await tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where client_id=${clientId} and status='Draft' and source_account_code like 'FIXTURE-%'`;});
 return accounts.length;
}

// Ledger years now wait for a classified client and an approved chart of accounts for its family. Tests that exercise accounting flows
// (not those gates) classify the fictional client from its legal_entity_type and give it an approved chart, prepared and reviewed by two leaders.
export async function readyForLedger(tx,clientId){
 const c=(await tx`select legal_entity_type from erp_private.clients where client_id=${clientId}`)[0];
 const pair={'Limited company':['Limited Company','Private Limited Company'],Partnership:['Partnership','General Partnership'],'Sole proprietor':['Individual','Sole Proprietor'],'Non-profit organisation':['Non-Profit Organisation','NGO']}[c.legal_entity_type];
 if(pair)await tx`update erp_private.clients set legal_structure=${pair[0]},legal_subtype=${pair[1]} where client_id=${clientId}`;
 const leaders=await tx`select staff_id from erp_private.staff_members where category_code in('PARTNER','MANAGER') order by category_code,staff_id limit 2`;
 const codes=(await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code`).map(x=>x.code);
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note)
  values(${clientId},'2020-01-01',${c.legal_entity_type},${'{Wholesale}'},${'{'+codes.join(',')+'}'},'Approved',${leaders[0].staff_id},${leaders[1].staff_id},now(),'Fictional approval for ledger tests')`;
}
