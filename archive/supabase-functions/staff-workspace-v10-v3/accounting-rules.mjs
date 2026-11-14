import {fail,text,date,choice} from './validation.mjs';
const costTypes=['Purchases','Expenditure','Non-eTIMS'];
export const isCost=r=>costTypes.includes(r.dataset);
export const cents=v=>{const n=Number(v);if(v===''||v==null||!Number.isFinite(n)||Math.abs(n)>1e12||Math.abs(n*100-Math.round(n*100))>.0001)fail(400,'Use an amount with at most two decimals.');return Math.round(n*100);};
export const money=v=>Math.round(Number(v||0)*100)/100;
export function mapValue(row,p,accounts,policy){
 if(!isCost(row)||row.is_split_parent)fail(400,'Choose active purchase or expenditure rows.');
 const account=accounts.find(a=>a.code===String(p.account_code)&&a.status==='Active'&&!a.is_legacy);
 if(!account||account.route!==Number(p.route))fail(400,'Choose an active detailed account for this route.');
 if(row.dataset==='Non-eTIMS'&&(Number(p.route)!==2||Number(account.code)<51000||Number(account.code)>=67000||Number(account.code)>=60000&&Number(account.code)<=60170))fail(400,'Use a specific operating, administrative or finance expense category for non-eTIMS expenditure. Stock, PPE and payroll belong in their own schedules.');
 if(Number(p.route)===1){if(!policy||!['Periodic','Perpetual'].includes(policy.inventory_method))fail(400,'A Manager must configure the client inventory method first.');const asset=account.statement==='Statement of financial position';if(policy.inventory_method==='Perpetual'&&!asset||policy.inventory_method==='Periodic'&&asset)fail(400,'The inventory account does not match the configured accounting method.');if(['50100','50110','50120','50130','50140','50150'].includes(account.code))fail(400,'Cost-of-sales and stock adjustments are not purchase-entry accounts.');}
 const asset=Number(p.route)===3?text(p.asset_details||'',1000):null;
 const use=Number(p.route)===3?choice(p.first_use_status,['In use','Not yet in use']):null;
 const first=use==='In use'?date(p.first_use_date):null;if(use==='In use'&&(!first||first>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date())))fail(400,'Confirm an actual first-use date, not a future date.');
 return {route:account.route,category_code:account.category_code,account_code:account.code,account_name:account.name,catalog_version:account.catalog_version,narration:text(p.narration||row.narration||row.normalized.description||`${row.normalized.party||'Purchase'} · ${row.normalized.invoice||''}`,1000),asset_details:asset,first_use_status:use,first_use_date:first};
}
export function splitValues(row,parts){
 if(!isCost(row)||row.parent_row_id||row.is_split_parent)fail(400,'Split an original unsplit purchase row.');
 if(!Array.isArray(parts)||parts.length<2||parts.length>20)fail(400,'Enter 2–20 allocation lines.');
 const parsed=parts.map(p=>({...p,amount:cents(p.amount),vat:cents(p.vat??0)}));
 if(parsed.some(p=>p.amount===0||Math.sign(p.amount)!==Math.sign(Number(row.normalized.amount))||p.vat!==0&&Math.sign(p.vat)!==Math.sign(Number(row.normalized.vat))))fail(400,'Allocation signs must match the original transaction.');
 if(parsed.reduce((s,p)=>s+p.amount,0)!==cents(row.normalized.amount)||parsed.reduce((s,p)=>s+p.vat,0)!==cents(row.normalized.vat||0))fail(400,'Allocation net and VAT totals must equal the original transaction exactly.');
 return parsed.map(p=>({...p,amount:p.amount/100,vat:p.vat/100,narration:text(p.narration,1000)}));
}
export function reconciliation(rows,inputs={},controls={}){
 const total=kind=>rows.filter(r=>r.dataset===kind&&!r.is_split_parent).reduce((a,r)=>({net:money(a.net+Number(r.normalized.amount||0)),vat:money(a.vat+Number(r.normalized.vat||0)),gross:money(a.gross+Number(r.normalized.amount||0)+Number(r.normalized.vat||0))}),{net:0,vat:0,gross:0});
 const etims=total('Sales'),pos=total('POS'),bank=rows.filter(r=>r.dataset==='Bank').reduce((a,r)=>money(a+Number(r.normalized.credit||0)),0),allocations=Array.isArray(inputs.allocations)?inputs.allocations:[];
 if(allocations.length>500)fail(400,'Split the reconciliation into fewer than 500 adjustments.');
 const allowed=['Non-sales receipt','Prior debtor collection','Current credit sales','Cash not banked','Settlement fee','Timing into bank','Timing out of bank','Other supported adjustment'];
 const parsed=allocations.map(x=>{const category=choice(x.category,allowed),value=cents(x.amount);if(value<=0)fail(400,'Use positive adjustment amounts.');return {category,amount:value/100,reference:text(x.reference,200),note:text(x.note,2000),evidence_id:x.evidence_id||null};});
 const keys=parsed.map(x=>x.reference.toUpperCase());if(new Set(keys).size!==keys.length)fail(400,'An adjustment reference is repeated. Record each adjustment once.');
 const sum=cat=>money(parsed.filter(x=>x.category===cat).reduce((s,x)=>s+x.amount,0));
 // Bank and sales are compared on a consistent gross basis. Nothing here posts revenue or VAT.
 const adjusted_receipts=money(bank-sum('Non-sales receipt')-sum('Prior debtor collection')+sum('Current credit sales')+sum('Cash not banked')+sum('Settlement fee')+sum('Timing into bank')-sum('Timing out of bank'));
 const pending=!rows.some(r=>r.dataset==='Bank')&&controls.bankPendingApproved===true;
 const issues=[];if(pending&&parsed.length)issues.push('Do not enter a bank bridge without bank data. Retain alternative sales evidence in the deferral.');if(!rows.some(r=>r.dataset==='Sales'))issues.push('Upload the supported sales register.');if(!rows.some(r=>r.dataset==='Bank')&&!pending)issues.push('Upload the bank control source.');
 if(sum('Non-sales receipt')+sum('Prior debtor collection')>bank+.01)issues.push('Receipt exclusions exceed the imported bank deposits.');
 const source_explanation=String(inputs.source_explanation||'').trim();if(rows.some(r=>r.dataset==='POS')&&Math.abs(etims.gross-pos.gross)>.01&&!source_explanation)issues.push('Explain the eTIMS/POS difference and identify corrective source rows.');
 if(!rows.some(r=>r.dataset==='POS')&&!inputs.pos_not_applicable_reason)issues.push('Upload POS/Z-report data or explain why POS is not applicable.');
 const residual=money(adjusted_receipts-etims.gross);if(!pending&&Math.abs(residual)>.01&&!parsed.some(x=>x.category==='Other supported adjustment'))issues.push('The banking bridge has an unexplained residual.');
 const other=money(parsed.filter(x=>x.category==='Other supported adjustment').reduce((s,x)=>s+x.amount,0));if(other&&Math.abs(Math.abs(residual)-other)>.01)issues.push('Other supported adjustments must explain the residual exactly.');
 if(!String(inputs.conclusion||'').trim())issues.push('Record the reconciliation conclusion.');
 return {bank_status:pending?'Bank pending':'Imported',etims,pos,bank_deposits:pending?null:bank,benchmark_net:Math.max(etims.net,pos.net),adjusted_gross_receipts:pending?null:adjusted_receipts,residual_gross:pending?null:residual,allocations:parsed,issues,source_explanation,pos_not_applicable_reason:String(inputs.pos_not_applicable_reason||''),conclusion:String(inputs.conclusion||''),statement:'Review benchmark only. Approved sales and VAT remain supported source transactions; no MAX posting.'};
}
