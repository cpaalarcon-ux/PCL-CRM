import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {fieldLabel,messageFor,validateForm,watchForm,applyServerError,matchServerError,clearFieldError,summary}=await import('../staff-field-errors.mjs');
function page(html){const dom=new JSDOM(`<!doctype html><body><form id="f" novalidate>${html}</form></body>`);const f=dom.window.document.getElementById('f');return {f,doc:dom.window.document,win:dom.window};}
const FORM=`<label>Company name *<input name="company_name" required maxlength="10"></label><label>Contact email<input name="email" type="email"></label><label>KRA PIN<input name="kra_pin" pattern="[AP][0-9]{9}[A-Z]" title="Use the format A123456789Z"></label><label>Start date<input name="starts_on" type="date"></label><label>End date<input name="ends_on" type="date"></label><label>Review note<textarea name="review_note"></textarea></label><label class="full">Turnover share<input name="share" type="number" min="0" max="100" step="0.01"></label><button type="submit">Save</button>`;

test('labels are read without the asterisk, the control text or an earlier error',()=>{
 const {f}=page(FORM);assert.equal(fieldLabel(f.elements.company_name),'Company name');assert.equal(fieldLabel(f.elements.kra_pin),'KRA PIN');
 f.elements.company_name.value='';validateForm(f);assert.equal(fieldLabel(f.elements.company_name),'Company name','an error message inside the label does not leak into it');
});

test('each invalid field gets its own message, is marked invalid and is described by it',()=>{
 const {f,doc}=page(FORM);f.elements.email.value='not-an-email';f.elements.kra_pin.value='bad';f.elements.company_name.value='';f.elements.share.value='150';
 const issues=validateForm(f);
 assert.deepEqual(issues.map(i=>i.el.name),['company_name','email','kra_pin','share']);
 assert.equal(issues[0].message,'Company name is required.');
 assert.match(issues[1].message,/Contact email: enter a valid email address/);
 assert.equal(issues[2].message,'KRA PIN: Use the format A123456789Z.');
 assert.equal(issues[3].message,'Turnover share must be 100 or less.');
 for(const {el,message} of issues){assert.equal(el.getAttribute('aria-invalid'),'true');const n=doc.getElementById(el.getAttribute('data-error-id'));assert.equal(n.textContent,message);assert.ok(el.getAttribute('aria-describedby').includes(n.id));assert.equal(el.nextElementSibling,n,'the message sits right beside the field');}
 assert.equal(doc.querySelectorAll('.field-error').length,4);
 assert.equal(summary(issues),'Fix the 4 highlighted fields, then save again.');assert.equal(summary(issues.slice(0,1)),'Fix the highlighted field, then save again.');
});

test('validating again replaces messages instead of stacking them; a clean form returns nothing',()=>{
 const {f,doc}=page(FORM);validateForm(f);validateForm(f);assert.equal(doc.querySelectorAll('.field-error').length,1);
 f.elements.company_name.value='Mlima';assert.deepEqual(validateForm(f),[]);assert.equal(doc.querySelectorAll('.field-error').length,0);assert.equal(f.elements.company_name.hasAttribute('aria-invalid'),false);
});

test('editing a field clears its message and keeps any other description it had',()=>{
 const {f,doc,win}=page(FORM);watchForm(f);const el=f.elements.company_name;el.setAttribute('aria-describedby','help');validateForm(f);
 assert.equal(el.getAttribute('aria-describedby').startsWith('help '),true);
 el.value='M';el.dispatchEvent(new win.Event('input',{bubbles:true}));
 assert.equal(doc.querySelectorAll('.field-error').length,0);assert.equal(el.getAttribute('aria-describedby'),'help');assert.equal(el.hasAttribute('aria-invalid'),false);
});

test('hidden or closed-section controls do not block the form invisibly',()=>{
 const {f}=page(`<label>Visible<input name="a" required></label><div hidden><label>Hidden<input name="b" required></label></div><details><summary>More</summary><label>Folded<input name="c" required></label></details>`);
 assert.deepEqual(validateForm(f).map(i=>i.el.name),['a']);
});

test('a server message that names a field is shown beside it; one that does not stays in the notice',()=>{
 const {f,doc}=page(FORM);
 let r=applyServerError(f,'The end date must follow the start date.');
 assert.ok(['starts_on','ends_on'].includes(r.el.name));assert.equal(r.notice,'Check the highlighted field.');
 assert.equal(doc.querySelector('.field-error').getAttribute('role'),'alert');
 r=applyServerError(f,'Enter a review note of at least 10 characters.');assert.equal(r.el.name,'review_note');
 r=applyServerError(f,'Record unavailable to this account.');assert.equal(r.el,null);assert.equal(r.notice,'Record unavailable to this account.');
 assert.equal(matchServerError(f,'Something unrelated happened'),null);
});

test('the longest matching label wins, and very short labels never match',()=>{
 const {f}=page(`<label>Date<input name="d"></label><label>Start date<input name="s"></label><label>Id<input name="id"></label>`);
 assert.equal(matchServerError(f,'The start date is outside the year.').name,'s');assert.equal(matchServerError(f,'Invalid id supplied'),null);
});
