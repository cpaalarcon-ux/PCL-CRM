// Screen helpers for manual payroll lines. The server (payroll-lines.mjs) owns every rule; this only draws the form.
export const RELATIONSHIPS=['Employee','Casual worker','Director','Shareholder','Owner','Partner','Family member'];
export const RELATIONSHIP_HELP={
 'Employee':'An ordinary employee with no ownership or family link to the client.',
 'Casual worker':'Paid by the day or job. Needs an ID number, phone number and the date paid.',
 'Director':'A director paid a salary or fees through payroll. Needs the board resolution or contract.',
 'Shareholder':'A shareholder who is also employed. Needs the contract or board resolution that sets the pay.',
 'Owner':'The owner of a sole proprietorship. Owner withdrawals are Drawings, not payroll.',
 'Partner':'A partner in a partnership. Partner withdrawals are Drawings, not payroll.',
 'Family member':'A relative of an owner, director, partner or shareholder. Needs the duties performed and the basis of the pay.'
};
export function lineFieldset(i,x,esc){
 const v=k=>esc(x[k]??''),opt=(list,cur)=>list.map(o=>`<option ${o===cur?'selected':''}>${esc(o)}</option>`).join('');
 const num=(k,l)=>`<label>${l}<input data-col="${k}" type="number" min="0" step="0.01" value="${v(k)}"></label>`;
 return `<fieldset data-pay-line class="ledger-entry-line"><legend>Person ${i}</legend>
 <label>Name *<input data-col="name" required maxlength="160" value="${v('name')}"></label>
 <label>KRA PIN<input data-col="pin" maxlength="11" value="${v('pin')}"></label>
 <label>ID number<input data-col="employee_id" maxlength="30" value="${v('employee_id')}"></label>
 <label>Relationship to the client *<select data-col="relationship" required><option value="">Choose…</option>${opt(RELATIONSHIPS,x.relationship)}</select></label>
 <p class="muted full" data-rel-help></p>
 <label>Employment type<select data-col="employment_type">${opt(['Permanent','Contract','Casual'],x.employment_type||'Permanent')}</select></label>
 <label>Residence<select data-col="resident"><option value="">Decide in the preview</option>${opt(['Resident','Non-resident'],x.resident)}</select></label>
 ${num('gross','Gross cash pay for the month *')}${num('taxable_benefits','Taxable benefits')}${num('other_pension','Other pension contribution')}${num('mortgage_interest','Mortgage interest')}${num('postretirement_medical','Post-retirement medical')}${num('other_deductions','Other deductions from pay')}
 <label>Phone (casual)<input data-col="phone" maxlength="20" value="${v('phone')}"></label>
 <label>Date paid (casual)<input data-col="date_paid" type="date" value="${v('date_paid')}"></label>
 <label>Evidence for this line *<input data-col="evidence_reference" required maxlength="300" placeholder="Payslip no., payment proof or signed register" value="${v('evidence_reference')}"></label>
 <label data-for-rel="Director|Shareholder|Family member">Board resolution, contract or agreement<input data-col="approval_reference" maxlength="300" value="${v('approval_reference')}"></label>
 <label data-for-rel="Family member">Duties performed and basis of the pay<input data-col="related_basis" maxlength="500" value="${v('related_basis')}"></label>
 <button type="button" data-remove-line>Remove this person</button></fieldset>`;
}
export function collectLines(root){
 return [...root.querySelectorAll('[data-pay-line]')].map(fs=>Object.fromEntries([...fs.querySelectorAll('[data-col]')].map(el=>[el.dataset.col,el.value])));
}
export function syncRelationship(fs){
 const rel=fs.querySelector('[data-col="relationship"]').value,help=fs.querySelector('[data-rel-help]');
 if(help)help.textContent=RELATIONSHIP_HELP[rel]||'';
 for(const el of fs.querySelectorAll('[data-for-rel]'))el.hidden=!el.dataset.forRel.split('|').includes(rel);
}
