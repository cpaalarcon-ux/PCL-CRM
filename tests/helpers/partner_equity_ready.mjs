// Test helper (build 2888): the fictional figures of a two-partner firm, and a way to declare and approve the partners' capital and current accounts so a partnership pack can reach the final stage.
// Capital 1,000,000 at the start (600,000 / 400,000), 50,000 introduced by the first partner, current accounts 100,000 (60,000 / 40,000), drawings 200,000 (120,000 / 80,000), profit 500,000.
export const L=(line_code,statement,section,label,sort_order,normal_side)=>({line_code,statement,section,label,sort_order,normal_side,note_ref:null});
export const lineDefs=[L('SFP.CASH','Financial position','Current assets','Cash',100,'Debit'),L('SFP.OWNER_CAP','Financial position','Equity','Partners capital',300,'Credit'),L('SFP.RETAINED','Financial position','Equity','Partners current accounts',370,'Credit'),L('SFP.DRAWINGS','Financial position','Equity','Drawings',380,'Debit'),
 L('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit'),L('PL.COST','Profit or loss','Operating costs','Costs',1100,'Debit')];
const map=(a,l)=>({account_code:a,line_code:l,effective_from:'2020-01-01',effective_to:null,status:'Approved'});
export const maps=[map('10000','SFP.CASH'),map('30000','SFP.OWNER_CAP'),map('31000','SFP.RETAINED'),map('32000','SFP.DRAWINGS'),map('40000','PL.REVENUE'),map('50000','PL.COST')];
const bs=(code,opening,movDr,movCr)=>({code,name:'A'+code,opening,movement_debit:movDr,movement_credit:movCr,net:opening+movDr-movCr});
export const tb=()=>[bs('10000',1100000,950000,200000),bs('30000',-1000000,0,50000),bs('31000',-100000,0,0),bs('32000',0,200000,0),bs('40000',0,0,900000),bs('50000',0,400000,0)];
export const shares=[{partner_name:'Fictional Amani',share_bp:6000},{partner_name:'Fictional Zawadi',share_bp:4000}];
export const rows=()=>[{partner_name:'Fictional Amani',capital_opening:600000,capital_movement:50000,current_opening:60000,drawings:120000},{partner_name:'Fictional Zawadi',capital_opening:400000,capital_movement:0,current_opening:40000,drawings:80000}];
export const EVIDENCE='Fictional partners ledger at the year end';
// Declared by ASSISTANT and approved by MANAGER. get/asOf are the same as the action takes. Returns the read after approval.
export async function approvePartnerEquity({tx,as,S,per,get,asOf,over={}}){
 const d=await as('ASSISTANT',a=>S.partnerEquityAction(tx,a,per,{action:'ledger_partner_equity_declare',evidence:EVIDENCE,rows:rows(),...over},get,asOf));
 await as('MANAGER',a=>S.partnerEquityAction(tx,a,per,{action:'ledger_partner_equity_review',equity_id:d.equity_id,decision:'Approved'},get,asOf));
 return await as('MANAGER',a=>S.partnerEquityAction(tx,a,per,{action:'ledger_partner_equity_read'},get,asOf));
}
