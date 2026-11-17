// Test helper (build 2878): approve the standard wording for an edition and declare and approve every disclosure a year needs, so a pack can reach the final stage.
// Preparer: MANAGER and ASSISTANT; approvers: PARTNER2 for the library and MANAGER for the disclosures. Fictional text only.
export async function approveWording({tx,as,W,per,getStatements,asOf,framework='IFRS for SMEs Accounting Standard',edition='Third Edition (2025)'}){
 await as('MANAGER',a=>W.wordingLibraryAction(tx,a,{action:'wording_library_prepare_all',framework,edition}));
 const ids=(await tx`select wording_id from erp_private.standard_wording where framework=${framework} and edition=${edition} and status='Draft'`).map(r=>r.wording_id);
 if(ids.length)await as('PARTNER2',a=>W.wordingLibraryAction(tx,a,{action:'wording_library_review',framework,edition,wording_ids:ids,decision:'Approved'}));
 const read=await as('MANAGER',a=>W.wordingAction(tx,a,per,{action:'ledger_wording_read'},getStatements,asOf));
 for(const d of read.disclosures){
  if(d.state==='Approved')continue;
  const x=await as('ASSISTANT',a=>W.wordingAction(tx,a,per,{action:'ledger_disclosure_declare',code:d.code,...(d.allow_nothing?{state:'Nothing to report'}:{state:'Text',body:'Fictional statement for '+d.title+'.'})},getStatements,asOf));
  await as('MANAGER',a=>W.wordingAction(tx,a,per,{action:'ledger_disclosure_review',disclosure_id:x.disclosure_id,decision:'Approved'},getStatements,asOf));
 }
 return await as('MANAGER',a=>W.wordingAction(tx,a,per,{action:'ledger_wording_read'},getStatements,asOf));
}
