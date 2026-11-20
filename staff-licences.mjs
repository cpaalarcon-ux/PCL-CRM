// Step 4: licences and permits per client, with expiry dates. Pure view helpers; the rules live in the database
// (20261109261000_client_licences.sql) and the server (engagement-actions.ts).
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const LICENCE_NOTE='The warning window (60 days) and the licences a legal structure is expected to hold are defaults that the Compliance Lead has not yet confirmed. A licence flag blocks nothing.';
const day=v=>String(v||'').slice(0,10);
export const isCurrent=l=>!l.ended_on;
// Wording for each state, shared by the client screen and the audit file.
export function stateText(state,daysLeft){
 if(state==='Expired')return daysLeft!=null?`Expired ${Math.abs(Number(daysLeft))} day(s) ago`:'Expired';
 if(state==='Expiring')return `Expires in ${Number(daysLeft)} day(s)`;
 if(state==='Missing')return 'Expected for this legal structure, none recorded';
 return 'Valid';
}
export const stateTone=state=>state==='Expired'||state==='Missing'?'bad':state==='Expiring'?'warn':'ok';
// Count by state, for the headline sentence.
export function licenceCounts(rows){
 const n=k=>rows.filter(r=>r.state===k).length;
 return {expired:n('Expired'),expiring:n('Expiring'),missing:n('Missing'),valid:n('Valid'),total:rows.length};
}
export function headline(rows){
 const c=licenceCounts(rows);
 if(!c.total)return {tone:'neutral',text:'No licence or permit is recorded for this client.'};
 const bits=[];if(c.expired)bits.push(c.expired+' expired');if(c.expiring)bits.push(c.expiring+' expiring soon');if(c.missing)bits.push(c.missing+' expected but not recorded');
 return bits.length?{tone:c.expired||c.missing?'bad':'warn',text:'Needs attention: '+bits.join(', ')+'.'}:{tone:'ok',text:'All recorded licences are valid.'};
}
// The section shown on the client KYC screen.
export function licencesSection({client,licences=[],summary=[],types=[],leader,table,button,shortDate}){
 const mine=licences.filter(l=>l.client_id===client.client_id),current=mine.filter(isCurrent),ended=mine.filter(l=>!isCurrent(l));
 const typeLabel=c=>types.find(t=>t.type_code===c)?.label||c;
 const missing=summary.filter(r=>r.client_id===client.client_id&&r.state==='Missing');
 const h=headline([...current.map(l=>({state:l.state})),...missing]);
 const row=l=>[esc(typeLabel(l.licence_type))+(l.description?` <small>${esc(l.description)}</small>`:''),esc(l.licence_number),esc(l.issuing_authority),esc(shortDate(l.expires_on)),`<span class="badge ${stateTone(l.state)}">${esc(l.state)}</span> <small>${esc(stateText(l.state,l.days_left))}</small>`,leader?button('licence-renew','Renew',l.licence_id)+' '+button('licence-end','End',l.licence_id):''];
 const endedRow=l=>[esc(typeLabel(l.licence_type)),esc(l.licence_number),esc(l.issuing_authority),esc(shortDate(l.expires_on)),esc('Ended '+shortDate(l.ended_on)+' · '+(l.end_reason||'')),''];
 return `<h3>Licences and permits</h3><p class="${h.tone==='bad'||h.tone==='warn'?'warn':'muted'}" id="licenceStatus">${esc(h.text)}</p>`
  +missing.map(m=>`<p class="warn">${esc(typeLabel(m.licence_type))}: ${esc(stateText('Missing'))}.</p>`).join('')
  +table(['Licence','Number','Issued by','Expires','State',''],current.map(row))
  +(ended.length?`<details><summary>Ended or renewed (${ended.length})</summary>${table(['Licence','Number','Issued by','Expires','Ended',''],ended.map(endedRow))}</details>`:'')
  +`<p class="muted">${esc(LICENCE_NOTE)}</p><div class="actions">${leader?button('licence-new','+ Add licence or permit',client.client_id):''}</div>`;
}
export function licenceFormFields({field,select,area,types,licence}){
 const opts=types.map(t=>[t.type_code,t.label]);
 return select('licence_type','Type of licence *',opts,licence?.licence_type||'')
  +field('licence_number','Licence or permit number *','','text','required maxlength="100"')
  +field('issuing_authority','Issued by (for a county permit, name the county)',licence?.issuing_authority||'','text','maxlength="200"')
  +field('description','Description (required for Other)','','text','maxlength="300"')
  +field('issued_on','Issued on','','date')+field('expires_on','Expires on *','','date','required');
}
// The read-only flag shown on the audit file. Never shows a licence number.
export function auditFlag(rows=[]){
 const c=licenceCounts(rows),h=headline(rows);
 return {tone:h.tone,text:h.text,counts:c,
  rows:rows.map(r=>({label:r.label,authority:r.authority,state:r.state,tone:stateTone(r.state),text:stateText(r.state,r.days_left),expires_on:day(r.expires_on)})),
  attention:c.expired+c.expiring+c.missing};
}
export function auditFlagHtml(rows=[]){
 const f=auditFlag(rows);
 if(!rows.length)return `<section class="card section-space" id="auditLicences"><h3>Client licences and permits</h3><p class="muted">No licence or permit is recorded for this client, and none is expected for its legal structure.</p></section>`;
 const items=f.rows.map(r=>`<li class="${r.tone}"><b>${esc(r.label)}</b> <small>${esc(r.authority)}</small> · ${r.expires_on?'expires '+esc(r.expires_on)+' · ':''}<span class="badge ${r.tone}">${esc(r.state)}</span> <small>${esc(r.text)}</small></li>`).join('');
 return `<section class="card section-space" id="auditLicences"><h3>Client licences and permits</h3><p class="${f.tone==='bad'||f.tone==='warn'?'warn':'muted'}">${esc(f.text)}</p><ul class="audit-licences">${items}</ul><p class="muted">For the audit team to consider in planning and going-concern work. It creates no risk and blocks no sign-off; a Partner decides what an expired licence means for this file.</p></section>`;
}
