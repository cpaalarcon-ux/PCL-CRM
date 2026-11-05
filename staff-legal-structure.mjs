// Edit client: Legal structure + Subcategory (dependent dropdowns), the accounting-family hint and the client-list filter.
// The rows come from the workspace data (erp_private.legal_structure_types); nothing is hard-coded except the family wording.
const ACCOUNTING=['Limited company','Partnership','Sole proprietor','Non-profit organisation'];
export const structureRows=data=>data?.legal_structure_types||[];
export const structuresOf=rows=>[...new Set(rows.map(r=>r.structure))];
export const subtypesOf=(rows,structure)=>rows.filter(r=>r.structure===structure).map(r=>r.subtype);
export function familyOf(rows,structure,subtype){
 if(!structure)return null;
 if(subtype)return rows.find(r=>r.structure===structure&&r.subtype===subtype)?.engine_family||null;
 const set=[...new Set(rows.filter(r=>r.structure===structure).map(r=>r.engine_family))];
 return set.length===1?set[0]:null;
}
export function familyHint(rows,structure,subtype){
 if(!structure)return 'Choose the legal structure first. It guides the setup, checklists and accounting; tax obligations are still activated only after verification.';
 if(!subtype)return 'Now choose the subcategory that matches the registration document.';
 const family=familyOf(rows,structure,subtype);
 if(!family)return '';
 return ACCOUNTING.includes(family)?`Accounting family: ${family}. Ledger, chart of accounts and tax review are available for this client.`:`Accounting family: ${family}. This client can be set up and tracked; its accounting engine is not enabled yet.`;
}
export function legalStructureFields({client,rows,isLeader,esc,options}){
 const c=client||{},structures=structuresOf(rows),classified=!!(c.legal_structure&&c.legal_subtype),locked=classified&&!isLeader;
 const subs=subtypesOf(rows,c.legal_structure);
 return `<fieldset class="full" data-legal-structure="${esc(c.legal_structure||'')}|${esc(c.legal_subtype||'')}"><legend>Legal structure</legend><div class="form-grid">
  <label>Legal structure *<select name="legal_structure" required${locked?' disabled':''}>${options(structures,c.legal_structure,'Choose…')}</select></label>
  <label>Subcategory *<select name="legal_subtype" required${locked?' disabled':''}>${options(subs,c.legal_subtype,c.legal_structure?'Choose…':'Choose a legal structure first')}</select></label>
  <p class="info full" id="legalStructureHint" role="status">${esc(locked?'Only a Manager or Partner can change a classified client. '+familyHint(rows,c.legal_structure,c.legal_subtype):familyHint(rows,c.legal_structure,c.legal_subtype))}</p>
  ${classified&&!locked?`<label class="full" id="legalStructureReasonBox" hidden>Why is the legal structure changing? *<textarea name="legal_structure_reason" maxlength="1000"></textarea></label>`:''}
  ${c.legal_structure_changed_at?`<p class="muted full">Last changed ${esc(String(c.legal_structure_changed_at).slice(0,10))}${c.legal_structure_changed_by_name?` by ${esc(c.legal_structure_changed_by_name)}`:''}.</p>`:''}
 </div></fieldset>`;
}
// Keep the Subcategory list and the hint in step with the chosen structure; ask for a reason when an existing classification changes.
export function bindLegalStructure(root,rows,esc,options){
 const form=root.querySelector('form');if(!form||!form.elements)return;const structure=form.elements.namedItem('legal_structure'),subtype=form.elements.namedItem('legal_subtype');
 if(!structure||!subtype)return;
 const box=root.querySelector('#legalStructureReasonBox'),hint=root.querySelector('#legalStructureHint'),original=root.querySelector('[data-legal-structure]')?.dataset.legalStructure||'|';
 const refresh=()=>{
  if(box)box.hidden=`${structure.value}|${subtype.value}`===original;
  if(hint)hint.textContent=familyHint(rows,structure.value,subtype.value);
 };
 structure.addEventListener('change',()=>{subtype.innerHTML=options(subtypesOf(rows,structure.value),'',structure.value?'Choose…':'Choose a legal structure first');refresh();});
 subtype.addEventListener('change',refresh);
 refresh();
}
export const structureLabel=(c,esc)=>c.legal_structure?`${esc(c.legal_structure)}${c.legal_subtype?` · ${esc(c.legal_subtype)}`:' · subcategory missing'}`:'Legal structure missing';
export function structureFilter(rows,esc){
 return `<label class="inline-filter">Legal structure <select id="clientStructureFilter"><option value="">All</option>${structuresOf(rows).map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}<option value="__missing">Not classified</option></select></label>`;
}
