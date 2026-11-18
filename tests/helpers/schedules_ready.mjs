// Test helper (build 2886): declare and approve a supporting schedule for every note that has balances, one line per account at the account's own amount, so a pack can reach the final stage.
// The schedules are declared by ASSISTANT and approved by MANAGER. They must be approved before the notes are prepared, because the notes digest includes them.
export async function approveSchedules({tx,as,S,per,getStatements,asOf}){
 const read=()=>as('MANAGER',a=>S.schedulesAction(tx,a,per,{action:'ledger_schedules_read'},getStatements,asOf));
 let r=await read();
 for(const k of r.kinds.filter(x=>x.relevant&&x.state!=='Approved')){
  const lines=k.accounts.filter(a=>a.amount!==0).map(a=>({category:k.categories[0],description:'Fictional schedule line '+a.code,account:a.code,reference:'',amount:a.amount}));
  const d=await as('ASSISTANT',a=>S.schedulesAction(tx,a,per,{action:'ledger_schedule_declare',kind:k.kind,evidence:'Fictional supporting document at the year end',lines},getStatements,asOf));
  await as('MANAGER',a=>S.schedulesAction(tx,a,per,{action:'ledger_schedule_review',schedule_id:d.schedule_id,decision:'Approved'},getStatements,asOf));
 }
 return await read();
}
