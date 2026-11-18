// Test helper (build 2881): record and approve one brought-forward asset so a fixture trial balance with a property, plant and equipment balance agrees to the register.
// The class LAND has no depreciation, matching fixtures that carry no depreciation figures. Preparer: ASSISTANT; approver: MANAGER. Fictional only.
export async function approvePpe({tx,as,X,per,account,cost,name='Fictional equipment'}){
 const day=v=>new Date(v).toISOString().slice(0,10),before=new Date(Date.parse(day(per.starts_on)+'T00:00:00Z')-86400000).toISOString().slice(0,10),getTb=async()=>({tb:[]});
 const d=await as('ASSISTANT',a=>X.ppeAction(tx,a,per,{action:'ledger_ppe_asset_declare',asset_name:name,asset_account:account,class_code:'LAND',origin:'Brought forward',acquired_on:'2020-01-01',first_use_on:'2020-01-01',cost,business_percentage:100,bf_as_of:before,bf_accumulated_depreciation:0,bf_tax_wdv:0,evidence:'Fictional prior-year schedule for the fixture'},getTb,day(per.ends_on)));
 await as('MANAGER',a=>X.ppeAction(tx,a,per,{action:'ledger_ppe_asset_review',record_id:d.record_id,decision:'Approved'},getTb,day(per.ends_on)));
 return d;
}
