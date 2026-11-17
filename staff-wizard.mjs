// A step-by-step form (build 2869). A form made of `.wz-step` sections is shown one step at a time, with a stepper on top, a footer that stays in view,
// the first field of each step focused, and the existing submit button kept for the last step only. Nothing here decides anything: the form still sends the
// same fields to the same action, and the server checks them again. Pure helpers are exported so they can be tested without a page.

// The most recent financial year that has already ended, from the client's year-end (month 1-12, day 1-31). Null when the year-end is not recorded.
export function suggestPeriod(month,day,today){
 const m=Number(month),d=Number(day);
 if(!Number.isInteger(m)||!Number.isInteger(d)||m<1||m>12||d<1||d>31||!/^\d{4}-\d{2}-\d{2}$/.test(String(today||'')))return null;
 const y=Number(String(today).slice(0,4));
 const endOf=year=>{const last=new Date(Date.UTC(year,m,0)).getUTCDate();return new Date(Date.UTC(year,m-1,Math.min(d,last)));};
 const iso=dt=>dt.toISOString().slice(0,10);
 let end=endOf(y);if(iso(end)>String(today))end=endOf(y-1);
 const prev=endOf(end.getUTCFullYear()-1),start=new Date(prev.getTime()+86400000);
 return {start:iso(start),end:iso(end)};
}
// Which stepper dot a step gets.
export const stepState=(i,current)=>i<current?'done':i===current?'current':'todo';
// A person is offered only when they belong to the chosen firm (the option value is "staff|firm").
export const inFirm=(optionValue,firmId)=>!optionValue||!firmId||String(optionValue).split('|')[1]===String(firmId);

export function attachWizard(form,{doc=document,labels={}}={}){
 const steps=[...form.querySelectorAll('.wz-step')];
 if(steps.length<2)return null;
 const submit=form.querySelector('button[type=submit]');
 let cur=0;
 const nav=doc.createElement('ol');nav.className='wz-stepper';nav.setAttribute('aria-label','Steps');
 steps.forEach((s,i)=>{const li=doc.createElement('li');li.dataset.step=String(i);li.innerHTML='<span class="wz-dot"></span><span class="wz-name"></span>';li.querySelector('.wz-dot').textContent=String(i+1);li.querySelector('.wz-name').textContent=s.dataset.title||('Step '+(i+1));nav.append(li);});
 form.prepend(nav);
 const foot=doc.createElement('div');foot.className='wz-footer full';
 const back=doc.createElement('button');back.type='button';back.className='wz-back';back.textContent=labels.back||'Back';
 const next=doc.createElement('button');next.type='button';next.className='primary wz-next';next.textContent=labels.next||'Next';
 foot.append(back,next);if(submit){submit.classList.add('wz-submit');foot.append(submit);}
 form.append(foot);
 const focusFirst=()=>{const el=steps[cur].querySelector('input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])');if(el&&el.focus)el.focus();};
 const show=(i,focus=true)=>{
  cur=Math.max(0,Math.min(steps.length-1,i));
  steps.forEach((s,k)=>{s.hidden=k!==cur;});
  [...nav.children].forEach((li,k)=>{li.dataset.state=stepState(k,cur);if(k===cur)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
  back.hidden=cur===0;next.hidden=cur===steps.length-1;if(submit)submit.hidden=cur!==steps.length-1;
  if(focus)focusFirst();
 };
 // A step is complete when every field in it passes its own checks. The first problem is shown in place.
 const stepOk=()=>{for(const el of steps[cur].querySelectorAll('input,select,textarea')){if(el.disabled||el.type==='hidden')continue;if(el.checkValidity&&!el.checkValidity()){if(el.reportValidity)el.reportValidity();if(el.focus)el.focus();return false;}}return true;};
 const go=()=>{if(stepOk())show(cur+1);};
 next.addEventListener('click',go);back.addEventListener('click',()=>show(cur-1));
 // Enter moves on instead of submitting early; a text area keeps its own Enter.
 form.addEventListener('keydown',e=>{if(e.key==='Enter'&&cur<steps.length-1&&e.target&&e.target.tagName!=='TEXTAREA'&&e.target.tagName!=='BUTTON'){e.preventDefault();go();}});
 // A click on an earlier stepper dot goes back; going forward uses Next so each step is checked.
 nav.addEventListener('click',e=>{const li=e.target.closest&&e.target.closest('li');if(!li)return;const k=Number(li.dataset.step);if(k<cur)show(k);});
 show(0);
 return {show,next:go,get current(){return cur;},steps};
}
