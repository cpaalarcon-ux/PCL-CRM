// A sole proprietor's owner and a partnership's partners cannot be employees of their own business: what they take out is a
// drawing (an appropriation of profit), not a staff cost. This rule is a logic check only and needs no tax rate.
const clean=v=>String(v||'').toUpperCase().replace(/\s+/g,'');
const person=v=>String(v||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();

export const OWNER_PAYMENT_MESSAGE='Owner and partner payments must be routed to Drawings, not payroll.';

export function ownerPayrollIssues({entityType,clientPin='',partners=[],rows=[]}){
 if(!['Sole proprietor','Partnership'].includes(entityType))return [];
 const pins=new Map(),names=new Map();
 const role=entityType==='Partnership'?'a partner of this partnership':'the owner of this sole proprietorship';
 if(entityType==='Sole proprietor'&&clean(clientPin))pins.set(clean(clientPin),role);
 if(entityType==='Partnership')for(const p of partners){if(clean(p.partner_pin))pins.set(clean(p.partner_pin),role);if(person(p.partner_name).length>=5)names.set(person(p.partner_name),role);}
 const issues=[];
 for(const r of rows){
  const byPin=pins.get(clean(r.pin)),byName=!byPin?names.get(person(r.name)):null,hit=byPin||byName;
  if(hit)issues.push(`Row ${r.source_row}: ${r.name} is ${hit}. ${OWNER_PAYMENT_MESSAGE}`);
 }
 return issues;
}
