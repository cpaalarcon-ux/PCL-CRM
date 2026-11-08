// What an Assistant or Supervisor may choose when proposing a KYC file: the evidence types that accept an uploaded file.
export async function kycProposalAction(tx:any,a:any,p:any){
 if(p.action!=='kyc_proposal_options')return undefined;
 return {rules:await tx`select rule_code,label from erp_private.kyc_evidence_rules where rule_status<>'Retired' and 'upload'=any(accepted_forms) order by label`};
}
