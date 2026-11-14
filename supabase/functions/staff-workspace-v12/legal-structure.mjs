// Client legal structure: the seven groups and the rule that turns a structure + subcategory into an accounting "engine family".
// The structure/subcategory/family rows live in erp_private.legal_structure_types; this module only reads them.
export const STRUCTURES=['Limited Company','Partnership','Individual','Non-Profit Organisation','Public Entity','Co-operative Society','Other'];
export const FAMILIES=['Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Co-operative society','Other legal entity'];
// Families the ledger, chart of accounts and tax review can run today. The others are classified and checked but not yet enabled.
export const ACCOUNTING_FAMILIES=['Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch'];
export const pairOk=(rows,structure,subtype)=>rows.some(r=>r.structure===structure&&r.subtype===subtype);
// A retired subcategory stays on clients that already have it but cannot be chosen again.
export const pairRetired=(rows,structure,subtype)=>rows.some(r=>r.structure===structure&&r.subtype===subtype&&r.retired===true);
// The SACCO type follows the subcategory: DT_SACCO, NWDT_SACCO or NOT_SACCO.
export const saccoTypeFor=(rows,structure,subtype)=>rows.find(r=>r.structure===structure&&r.subtype===subtype)?.sacco_type||'NOT_SACCO';
// With a subcategory the row decides. Without one, the family is known only if every subcategory of the structure agrees.
export function familyFor(rows,structure,subtype){
 if(!structure)return null;
 if(subtype)return rows.find(r=>r.structure===structure&&r.subtype===subtype)?.engine_family||null;
 const set=[...new Set(rows.filter(r=>r.structure===structure).map(r=>r.engine_family))];
 return set.length===1?set[0]:null;
}
export const accountingEnabled=family=>ACCOUNTING_FAMILIES.includes(family);
export function describe(structure,subtype){return structure?(subtype?`${structure} · ${subtype}`:`${structure} · subcategory missing`):'Legal structure missing';}
