// Field-level form errors for every staff dialog that uses the shared form helper.
// Before: one line of red text under the whole dialog, and the browser's own bubble that disappears when you click away.
// Now: the message sits beside the field, the field is marked invalid for screen readers, focus moves to the first problem,
// and the message clears as soon as the person edits that field.
let counter=0;

const clean=t=>String(t||'').replace(/\s+/g,' ').replace(/[*:]+\s*$/,'').replace(/\s*\*\s*/g,' ').trim();

// Visible label text of a control, without the control's own text or an existing error message.
export function fieldLabel(el){
 const own=el.closest?.('label');
 if(own){const copy=own.cloneNode?.(true);if(copy){copy.querySelectorAll?.('input,select,textarea,.field-error,small,button').forEach(x=>x.remove());const t=clean(copy.textContent);if(t)return t;}}
 const id=el.id&&el.ownerDocument?.querySelector?.(`label[for="${el.id}"]`);if(id){const t=clean(id.textContent);if(t)return t;}
 const legend=el.closest?.('fieldset')?.querySelector?.('legend');if(legend){const t=clean(legend.textContent);if(t)return t;}
 return clean(el.getAttribute?.('aria-label')||el.name||'This field').replace(/_/g,' ');
}

// One plain sentence for the first thing wrong with a control. A title attribute on the control wins for pattern problems
// because it already says what the format should be.
export function messageFor(el,label=fieldLabel(el)){
 const v=el.validity||{},cap=label.charAt(0).toUpperCase()+label.slice(1);
 if(v.valueMissing)return `${cap} is required.`;
 if(v.typeMismatch)return el.type==='email'?`${cap}: enter a valid email address.`:el.type==='url'?`${cap}: enter a full web address starting with https://.`:`${cap} is not valid.`;
 if(v.patternMismatch)return el.title?`${cap}: ${el.title.replace(/\.$/,'')}.`:`${cap} is not in the expected format.`;
 if(v.tooShort)return `${cap} must be at least ${el.minLength} characters.`;
 if(v.tooLong)return `${cap} must be at most ${el.maxLength} characters.`;
 if(v.rangeUnderflow)return `${cap} must be ${el.min} or more.`;
 if(v.rangeOverflow)return `${cap} must be ${el.max} or less.`;
 if(v.stepMismatch)return `${cap} has more decimal places than allowed.`;
 if(v.badInput)return `${cap} is not a valid entry.`;
 return el.validationMessage||`${cap} needs attention.`;
}

export function clearFieldError(el){
 el.removeAttribute?.('aria-invalid');
 const id=el.getAttribute?.('data-error-id');if(!id)return;
 el.ownerDocument?.getElementById?.(id)?.remove();
 el.removeAttribute('data-error-id');
 const by=(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(x=>x&&x!==id).join(' ');
 if(by)el.setAttribute('aria-describedby',by);else el.removeAttribute('aria-describedby');
}

export function showFieldError(el,message){
 clearFieldError(el);
 const doc=el.ownerDocument,id=`field-error-${++counter}`,note=doc.createElement('small');
 note.className='field-error';note.id=id;note.textContent=message;
 el.setAttribute('aria-invalid','true');el.setAttribute('data-error-id',id);
 el.setAttribute('aria-describedby',[el.getAttribute('aria-describedby'),id].filter(Boolean).join(' '));
 el.insertAdjacentElement('afterend',note);
 return note;
}

// Controls inside a hidden block or a closed <details> cannot be focused, so they are left to the server rather than blocking the person invisibly.
const controls=form=>[...form.elements].filter(el=>el.name&&el.willValidate!==false&&!['submit','button','reset','hidden','fieldset'].includes(el.type)&&!el.disabled&&!el.closest?.('[hidden],details:not([open])'));

// Check every control; show a message beside each problem; return the list. An empty list means the form may be sent.
export function validateForm(form){
 const issues=[];
 for(const el of controls(form)){
  clearFieldError(el);
  if(el.type==='radio'||el.type==='checkbox'){if(!el.required)continue;}
  if(el.checkValidity?.()===false){const message=messageFor(el);showFieldError(el,message);issues.push({el,message});}
 }
 return issues;
}

// Turn on live clearing: editing a field removes its message.
export function watchForm(form){
 const clear=e=>{if(e.target?.getAttribute?.('data-error-id')||e.target?.getAttribute?.('aria-invalid'))clearFieldError(e.target);};
 form.addEventListener('input',clear);form.addEventListener('change',clear);
}

const words=s=>clean(s).toLowerCase();

// Server messages are plain sentences. When one names a field on the form (for example "The end date must follow the start date."
// or "Enter a review note of at least 10 characters."), return that control so the message can sit beside it.
// The longest matching label wins; labels shorter than four letters are ignored to avoid false matches.
export function matchServerError(form,message){
 const text=words(message);let best=null,bestLen=0;
 for(const el of controls(form)){
  const label=words(fieldLabel(el)),alt=words(String(el.name||'').replace(/_/g,' '));
  for(const candidate of [label,alt]){
   if(candidate.length<4||candidate.length<=bestLen)continue;
   if(text.includes(candidate)){best=el;bestLen=candidate.length;}
  }
 }
 return best;
}

// Show a server message: beside the matching field when there is one, and always return what to put in the dialog notice.
export function applyServerError(form,message){
 const el=matchServerError(form,message);
 if(!el)return {el:null,notice:message};
 showFieldError(el,message).setAttribute('role','alert');el.focus?.();
 return {el,notice:'Check the highlighted field.'};
}

export function summary(issues){return issues.length===1?'Fix the highlighted field, then save again.':`Fix the ${issues.length} highlighted fields, then save again.`;}
