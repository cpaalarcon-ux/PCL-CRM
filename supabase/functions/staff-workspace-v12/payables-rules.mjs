// Supplier ledger and ageing. Pure functions: no database. Every supplier is a sub-account of the Trade payables control
// account (20000); the supplier ledger is rebuilt from the posted lines on 20000 and must equal the control account.
export const PAYABLES_ACCOUNT='20000';
export const BUCKETS=[{label:'0–30 days',from:0,to:30},{label:'31–60 days',from:31,to:60},{label:'61–90 days',from:61,to:90},{label:'Over 90 days',from:91,to:Infinity}];
const cents=v=>Math.round((Number(v||0)+Number.EPSILON)*100);
const kes=c=>c/100;
const day=v=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);
export const pinKey=v=>String(v||'').toUpperCase().replace(/\s+/g,'');
export const nameKey=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const daysBetween=(a,b)=>Math.round((Date.parse(day(b)+'T00:00:00Z')-Date.parse(day(a)+'T00:00:00Z'))/86400000);

// Match the party on a source row to the register: PIN first, then exact name or alias.
export function supplierIndex(suppliers){
 const byPin=new Map(),byName=new Map();
 for(const s of suppliers||[]){
  if(pinKey(s.kra_pin))byPin.set(pinKey(s.kra_pin),s);
  for(const n of [s.name,...(s.aliases||[])])if(nameKey(n))byName.set(nameKey(n),s);
 }
 return {find:({pin,name})=>{
  const byP=byPin.get(pinKey(pin));if(byP)return byP;
  const byN=byName.get(nameKey(name));
  // A name may match only when it cannot contradict a PIN: the source has none, or the supplier has none recorded.
  return byN&&(!pinKey(pin)||!pinKey(byN.kra_pin))?byN:null;
 }};
}

// lines: posted lines on 20000, each {date,debit,credit,kind,party,pin,line_id}. Opening-balance lines are kept apart because
// an opening trial balance gives one total, not a split by supplier.
export function buildPayables({lines,suppliers,asOf}){
 const idx=supplierIndex(suppliers),groups=new Map(),unassigned=[],opening=[];
 let gl=0;
 for(const l of lines||[]){
  const net=cents(l.credit)-cents(l.debit);gl+=net;
  if(l.kind==='Opening'){opening.push({...l,net});continue;}
  const s=(l.party||l.pin)?idx.find({pin:l.pin,name:l.party}):null;
  if(!s){unassigned.push({...l,net,reason:(l.party||l.pin)?'Not in the supplier register':'No supplier on the source'});continue;}
  if(!groups.has(s.supplier_id))groups.set(s.supplier_id,{supplier:s,items:[]});
  groups.get(s.supplier_id).items.push({...l,net});
 }
 const out=[];
 for(const {supplier,items} of groups.values()){
  // Payments (debits) clear the oldest invoices first; whatever is left is aged from the invoice date.
  const credits=items.filter(i=>i.net>0).map(i=>({date:day(i.date),open:i.net})).sort((a,b)=>a.date.localeCompare(b.date));
  let paid=items.filter(i=>i.net<0).reduce((n,i)=>n-i.net,0);
  for(const c of credits){const use=Math.min(c.open,paid);c.open-=use;paid-=use;}
  const buckets=BUCKETS.map(b=>({label:b.label,cents:0}));
  for(const c of credits.filter(c=>c.open>0)){const age=Math.max(0,daysBetween(c.date,asOf)),b=buckets.find((x,i)=>age>=BUCKETS[i].from&&age<=BUCKETS[i].to);b.cents+=c.open;}
  const owed=credits.reduce((n,c)=>n+c.open,0),debit=paid;
  out.push({supplier_id:supplier.supplier_id,name:supplier.name,pin:supplier.kra_pin,status:supplier.status,balance:kes(owed-debit),owed:kes(owed),debit_balance:kes(debit),
   buckets:buckets.map(b=>({label:b.label,amount:kes(b.cents)})),transactions:items.length});
 }
 out.sort((a,b)=>b.balance-a.balance||a.name.localeCompare(b.name));
 const sum=(arr)=>arr.reduce((n,x)=>n+x.net,0);
 const suppliersTotal=out.reduce((n,s)=>n+cents(s.balance),0),unassignedTotal=sum(unassigned),openingTotal=sum(opening);
 const parts=suppliersTotal+unassignedTotal+openingTotal;
 const names=new Map();for(const u of unassigned.filter(u=>u.reason==='Not in the supplier register')){const k=pinKey(u.pin)||nameKey(u.party);const n=names.get(k)||{party:u.party||'',pin:u.pin||'',net:0,lines:0};n.net+=u.net;n.lines++;names.set(k,n);}
 return {
  as_of:day(asOf),suppliers:out,
  buckets:BUCKETS.map((b,i)=>({label:b.label,amount:kes(out.reduce((n,s)=>n+cents(s.buckets[i].amount),0))})),
  unregistered:[...names.values()].map(n=>({...n,net:kes(n.net)})).sort((a,b)=>b.net-a.net),
  unassigned:{count:unassigned.length,amount:kes(unassignedTotal),manual:unassigned.filter(u=>u.reason==='No supplier on the source').length},
  opening:{count:opening.length,amount:kes(openingTotal)},
  totals:{suppliers:kes(suppliersTotal),unassigned:kes(unassignedTotal),opening:kes(openingTotal),ageing:kes(parts),gl_control:kes(gl),difference:kes(gl-parts)}
 };
}

// The close checks. A client with no register yet is not blocked: the ageing simply reads "Not started".
export function payablesChecks(report,{registerInUse}){
 const t=report.totals,checks=[];
 const add=(code,label,status,detail)=>checks.push({code,label,status,detail,blocking:status==='Blocked'});
 if(!registerInUse){add('PAYABLES_REGISTER','Supplier register','Not started','No suppliers are registered for this client yet. Add suppliers so the creditors ageing can be reconciled to the Trade payables control account.');return checks;}
 add('PAYABLES_CONTROL','Supplier ageing agrees with the Trade payables control account',t.difference?'Blocked':'Pass',t.difference?`Supplier ageing totals KES ${t.ageing.toFixed(2)} but the control account shows KES ${t.gl_control.toFixed(2)}: difference KES ${t.difference.toFixed(2)}.`:`Both show KES ${t.gl_control.toFixed(2)}.`);
 const un=report.unassigned;
 add('PAYABLES_ASSIGNED','Every payable movement belongs to a registered supplier',un.count?'Blocked':'Pass',un.count?`${un.count} line(s) worth KES ${un.amount.toFixed(2)} are not tied to a registered supplier${report.unregistered.length?`, for example ${report.unregistered.slice(0,3).map(u=>u.party||u.pin).join('; ')}`:''}. Add the supplier or correct the source.`:'All movements are tied to a supplier.');
 if(report.opening.count)add('PAYABLES_OPENING','Opening payables split by supplier',report.opening.amount?'Review':'Pass',report.opening.amount?`The opening balance of KES ${report.opening.amount.toFixed(2)} is a single total and is not split by supplier. Record the opening supplier balances when the supplier statements are available.`:'Opening balance is nil.');
 return checks;
}
