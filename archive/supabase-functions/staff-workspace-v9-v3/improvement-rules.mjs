import {fail,text,choice,date} from './validation.mjs';
import {cents,money} from './accounting-rules.mjs';
export const entityTypes=['Limited company','Partnership','Sole proprietor','Other legal entity'];
export const packs=['Wholesale','Hospitality','Consultancy','Construction','Other'];
export const streams=['Business','Farming','Rental','Interest','Other'];
export const asDay=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export function entityInput(p){
 const type=p.legal_entity_type?choice(p.legal_entity_type,entityTypes):null,evidence=text(p.entity_evidence||'',2000,false);
 const month=p.year_end_month?Number(p.year_end_month):null,day=p.year_end_day?Number(p.year_end_day):null;
 if(month!==null||day!==null){if(!Number.isInteger(month)||!Number.isInteger(day)||month<1||month>12||day<1||day>new Date(Date.UTC(2000,month,0)).getUTCDate())fail(400,'Choose a valid financial year-end month and day.');}
 return {legal_entity_type:type,entity_evidence:evidence,year_end_month:month,year_end_day:day};
}
export function partnerRatios(partners){
 if(!Array.isArray(partners)||partners.length<2||partners.length>100)fail(400,'Enter 2–100 partners for the same effective window.');
 const rows=partners.map(p=>{const pct=Number(p.profit_percentage);if(!Number.isFinite(pct)||pct<=0||pct>100||Math.abs(pct*10000-Math.round(pct*10000))>.000001)fail(400,'Use profit percentages with up to four decimals.');const pin=text(p.partner_pin,11).toUpperCase();if(!/^[A-Z]\d{9}[A-Z]$/.test(pin))fail(400,'Check each partner PIN.');return {partner_name:text(p.partner_name,160),partner_pin:pin,recipient_type:choice(p.recipient_type,['Individual','Company','Other']),profit_percentage:pct};});
 if(new Set(rows.map(r=>r.partner_pin)).size!==rows.length)fail(400,'A partner PIN is repeated.');
 if(rows.reduce((s,r)=>s+Math.round(r.profit_percentage*10000),0)!==1000000)fail(400,'Profit-sharing percentages must total exactly 100%.');return rows;
}
export function stockValues(inputs,policy){
 const val=k=>inputs[k]===''||inputs[k]==null?null:cents(inputs[k])/100;
 const opening=val('opening_value'),purchases=val('resale_purchases'),landed=val('landed_costs')??0,returns=val('returns_value')??0,adjustments=val('adjustments')??0;
 const sales=val('net_sales'),margin=inputs.margin_percentage===''||inputs.margin_percentage==null?NaN:Number(inputs.margin_percentage),basis=choice(inputs.cost_basis,['Supported actual cost','Provisional margin estimate']);
 let cogs=val('cost_of_sales');if(basis==='Provisional margin estimate'){if(sales===null||!Number.isFinite(margin)||margin<0||margin>=100)fail(400,'Enter net sales and a provisional margin from 0 to below 100%.');cogs=money(sales*(1-margin/100));}
 if([opening,cogs,sales,val('count_value'),returns].some(v=>v!==null&&v<0))fail(400,'Opening, cost of sales, sales, count and additional returns must not be negative.');
 const count=val('count_value'),closing=opening===null||purchases===null||cogs===null?null:money(opening+purchases+landed-returns+adjustments-cogs),variance=count===null||closing===null?null:money(count-closing),issues=[];
 if(opening===null)issues.push('Opening not split / supported: do not substitute zero.');
 if(purchases===null)issues.push('Tie the resale purchases to mapped source rows.');if(cogs===null)issues.push('Support cost of sales or label the margin estimate.');
 if(!String(inputs.evidence_reference||'').trim())issues.push('Record the opening, cost, count and movement evidence references.');
 if(closing!==null&&closing<0)issues.push('Negative actual closing estimate: investigate without inferring miscoding.');
 if(variance!==null&&Math.abs(variance)>Number(policy.variance_threshold))issues.push('Count variance exceeds the policy threshold: document evidence and obtain independent review.');
 if(!String(inputs.reconciliation_note||'').trim())issues.push('Record the source tie-out and any variance resolution.');
 return {opening_value:opening,resale_purchases:purchases,landed_costs:landed,returns_value:returns,adjustments,net_sales:sales,cost_of_sales:cogs,closing_value:closing,count_value:count,count_variance:variance,cost_basis:basis,provisional:basis==='Provisional margin estimate',issues,label:basis==='Provisional margin estimate'?'PROVISIONAL MANAGEMENT ESTIMATE — NOT VERIFIED STOCK':'Draft supported value control — independent review required',full_perpetual_costing:false};
}
export function suggestionFor(row,history){
 const n=row.normalized||{},description=String(n.description||row.narration||'').trim().toLowerCase();
 const generic=!description||/^(purchases?|goods|items?|invoice|supplies|general|misc(?:ellaneous)?|stock)$/i.test(description);
 const matches=history.filter(h=>String(h.normalized?.party_pin||'').toUpperCase()===String(n.party_pin||'').toUpperCase()&&n.party_pin&&h.account_code);
 const exact=generic?[]:matches.filter(h=>String(h.normalized?.description||h.narration||'').trim().toLowerCase()===description);
 const codes=[...new Set(exact.map(h=>h.account_code))],low=[...new Set(matches.map(h=>h.account_code))];
 return {confidence:codes.length===1?'Context match':'Low confidence',account_code:codes.length===1?codes[0]:null,prior_accounts:low,can_accept:codes.length===1,reason:codes.length===1?'Same client, supplier and description in independently reviewed history. Confirm actual use.':'Supplier/PIN or rate alone cannot establish whether this is stock, expenditure or PPE. Choose manually.',source_row_id:codes.length===1?exact[0].row_id:null};
}
export function exportReadiness({client,kind,period,stock=[]}){
 const issues=['A verified official return-template adapter has not been installed.'];
 if(!client.legal_entity_type)issues.push('Confirm the legal entity type.');if(!client.kra_pin)issues.push('Complete the KRA PIN.');
 if(!period)issues.push('Record the verified reporting period and dated deadline rule.');
 if(['IT1','IT2P','IT2C'].includes(kind)){issues.push('Full annual ledger, openings, assets and return schedules must be tied out.');if(stock.some(s=>s.result?.provisional||s.status!=='Approved'))issues.push('Provisional or unapproved stock cannot certify annual stock.');}
 if(kind==='P10')issues.push('The complete payroll register and P10 adapter are a separate build.');
 return {ready:false,kind,issues,direct_submission:false,label:'Readiness checklist only — no KRA upload file generated'};
}
