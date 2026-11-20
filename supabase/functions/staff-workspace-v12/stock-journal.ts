import {fail,uuid} from './validation.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v).slice(0,10);
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const INVENTORY_ACCOUNT='10190',MOVEMENT_ACCOUNT='50140';

// Approved stock rolls inside a client financial year, with the closing-stock journal each one needs.
// A periodic roll changes inventory by (closing - opening): Dr/Cr 10190 Inventory against 50140 Inventory opening/closing adjustment.
export async function stockRollsRead(tx:any,l:any){
 const rows=await tx`select c.control_id,c.stock_class,c.starts_on,c.ends_on,c.snapshot,c.result,pol.inventory_method from erp_private.stock_controls c join erp_private.stock_policy_versions pol on pol.policy_id=c.policy_id
  where c.project_id=${l.project_id} and c.status='Approved' and c.ends_on>=${day(l.starts_on)} and c.ends_on<=${day(l.ends_on)} order by c.ends_on,c.stock_class`;
 const out=[];
 for(const r of rows){
  const res=r.snapshot?.result||r.result||{},opening=res.opening_value,closing=res.closing_value;
  const j=(await tx`select journal_id,status,reference from erp_private.ledger_journals where project_id=${l.project_id} and kind='Stock' and source_snapshot->>'control_id'=${String(r.control_id)} order by created_at desc limit 1`)[0];
  const movement=opening==null||closing==null?null:round(num(closing)-num(opening));
  out.push({control_id:r.control_id,stock_class:r.stock_class,starts_on:day(r.starts_on),ends_on:day(r.ends_on),method:r.inventory_method,opening:opening??null,closing:closing??null,movement,count_variance:res.count_variance??null,provisional:!!res.provisional,
   journal_id:j?.journal_id||null,journal_status:j?.status||null,journal_reference:j?.reference||null,
   can_propose:r.inventory_method==='Periodic'&&!j&&movement!==null&&movement!==0&&!res.provisional,
   note:r.inventory_method!=='Periodic'?'Perpetual stock is posted from each sale and purchase, not from the roll.':res.provisional?'A provisional margin estimate is not verified stock, so no journal is proposed.':movement===0?'No change in stock this month.':j?null:'Ready for a proposed journal.'});
 }
 return {rolls:out,accounts:{inventory:INVENTORY_ACCOUNT,movement:MOVEMENT_ACCOUNT}};
}

// The journal lines for one roll. The caller creates the draft journal; it is posted only after independent review.
export async function stockJournalPlan(tx:any,l:any,controlId:string){
 const all=(await stockRollsRead(tx,l)).rolls,roll=all.find((r:any)=>r.control_id===uuid(controlId));
 if(!roll)fail(404,'That stock roll is not an approved roll in this financial year.');
 if(roll.method!=='Periodic')fail(400,'Only periodic stock rolls need a closing-stock journal.');
 if(roll.provisional)fail(400,'A provisional margin estimate is not verified stock. Approve a supported roll first.');
 if(roll.journal_id)fail(400,`A stock journal (${roll.journal_reference}) already exists for this roll.`);
 if(roll.movement===null||roll.movement===0)fail(400,'There is no change in stock to journal.');
 const m=Math.abs(roll.movement),up=roll.movement>0,label=`${roll.stock_class} stock ${roll.starts_on} to ${roll.ends_on}`;
 return {roll,journal_date:roll.ends_on,reference:'STK-'+roll.ends_on.replaceAll('-','')+'-'+String(roll.control_id).slice(0,4).toUpperCase(),
  description:`Closing stock adjustment: ${label}. Opening ${roll.opening}, closing ${roll.closing}, change ${roll.movement}.`+(roll.count_variance?` Count variance ${roll.count_variance} is not adjusted here.`:''),
  evidence:`Approved stock roll ${roll.control_id} (${label}).`,
  snapshot:{kind:'Stock roll',control_id:roll.control_id,opening:roll.opening,closing:roll.closing,movement:roll.movement},
  lines:[{account_code:up?INVENTORY_ACCOUNT:MOVEMENT_ACCOUNT,debit:m,credit:0,description:label},{account_code:up?MOVEMENT_ACCOUNT:INVENTORY_ACCOUNT,debit:0,credit:m,description:label}]};
}
