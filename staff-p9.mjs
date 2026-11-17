// P9 tax deduction cards (build 2877): the KRA Appendix 2A columns A to O, one card per employee, built from the confirmed payroll months of a year.
// The server (p9-actions.ts, p9-rules.mjs) owns every rule. This module draws the readiness, the card and the download.
const kes=v=>v==null||v===''?'':Number(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const P9_INTRO='A P9 card copies the KRA tax deduction card (Appendix 2A) columns A to O. It is built only from confirmed payroll months, and each column is checked against the payroll run before the cards can be released. Nothing is filled in by guesswork: a missing month, name or figure stops the cards and names it.';
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
// The firm's years that have confirmed payroll, and the cards already released.
export function p9Panel(r,esc){
 const yrs=(r.years||[]).map(y=>`<tr><td>${esc(y.year)}</td><td class="num">${esc(y.confirmed_months)}</td><td><button type="button" data-period-action="p9-prepare" data-year="${esc(y.year)}">Prepare ${esc(y.year)} cards</button></td></tr>`).join('');
 const made=(r.released||[]).slice(0,10).map(x=>`<li>${esc(x.tax_year)} · ${esc(x.employee_name)} · ${esc(x.generated_by_name||'')} · ${esc(x.generated_at)}</li>`).join('');
 return `<p class="info full">${esc(P9_INTRO)}</p>${yrs?`<div class="scroll"><table><thead><tr><th>Year</th><th class="num">Confirmed months</th><th>Build</th></tr></thead><tbody>${yrs}</tbody></table></div>`:'<p class="muted">No payroll month has been confirmed for this client yet.</p>'}${made?`<h4>Recently released</h4><ul class="muted">${made}</ul>`:''}`;
}
const cardTable=(card,columns,esc)=>`<div class="scroll"><table class="p9"><thead><tr><th>Month</th>${columns.map(c=>`<th title="${esc(c.label)}">${esc(c.letter)}</th>`).join('')}</tr></thead><tbody>${MONTHS.map((m,i)=>{const r=card.rows[i];return `<tr><td>${esc(m)}</td>${columns.map(c=>`<td class="num">${r?kes(r[c.letter]):''}</td>`).join('')}</tr>`;}).join('')}<tr><th>Total</th>${columns.map(c=>`<th class="num">${['E1','E3'].includes(c.letter)?'':kes(card.totals[c.letter])}</th>`).join('')}</tr></tbody></table></div><p><b>Total chargeable pay (Col. K):</b> ${kes(card.totals.K)} &nbsp; <b>Total tax (Col. O):</b> ${kes(card.totals.O)}</p>`;
export function p9Result(x,esc){
 const issues=(x.issues||[]).length?`<div class="notice error"><b>Not ready to release</b><ul>${x.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`:'<p><span class="badge good">Ready to release</span></p>';
 const missing=(x.coverage||[]).filter(c=>c.status==='No confirmed payroll');
 const cov=`<h4>Months</h4><div class="scroll"><table><thead><tr><th>Month</th><th>Payroll</th></tr></thead><tbody>${(x.coverage||[]).map(c=>`<tr><td>${esc(c.month)}</td><td>${esc(c.status)}</td></tr>`).join('')}</tbody></table></div>`
  +(missing.length?`<fieldset class="full"><legend>No payroll ran in these months</legend>${missing.map(c=>`<label><input type="checkbox" class="p9Empty" value="${esc(c.month)}"> ${esc(c.month)}</label>`).join(' ')}</fieldset>`:'');
 const rows=(x.employees||[]).map(e=>`<tr><td>${esc(e.name)}</td><td>${esc(e.pin)}</td><td class="num">${esc(e.months_on_payroll)}</td><td class="num">${kes(e.totals.K)}</td><td class="num">${kes(e.totals.O)}</td><td><button type="button" data-period-action="p9-show" data-pin="${esc(e.pin)}">View card</button></td></tr>`).join('');
 return `<p><b>P9 cards for ${esc(x.year)}</b> · ${esc(x.client?.name||'')} · ${esc((x.employees||[]).length)} employees</p>${issues}<ul class="muted">${(x.notes||[]).map(n=>`<li>${esc(n)}</li>`).join('')}</ul>${cov}`
  +(rows?`<h4>Cards</h4><div class="scroll"><table><thead><tr><th>Employee</th><th>KRA PIN</th><th class="num">Months</th><th class="num">Chargeable pay (K)</th><th class="num">Tax (O)</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'')
  +`<div class="actions"><button type="button" data-period-action="p9-prepare" data-year="${esc(x.year)}">Check again</button>${x.ready?`<button type="button" data-period-action="p9-release" data-year="${esc(x.year)}">Release and download (ZIP)</button><button type="button" data-period-action="p9-print" data-year="${esc(x.year)}">Print all cards</button>`:''}<button type="button" data-period-action="p9-files">Back</button></div>`;
}
export function p9CardView(x,pin,esc){
 const e=(x.employees||[]).find(c=>c.pin===pin);if(!e)return '<p class="muted">Card not found.</p>';
 return `<h4>${esc(e.name)} · ${esc(e.pin)} · ${esc(x.year)}</h4>${cardTable(e,x.columns,esc)}${e.issues.length?`<ul class="error">${e.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:''}<div class="actions"><button type="button" data-period-action="p9-prepare" data-year="${esc(x.year)}">Back to cards</button></div>`;
}
// One printable page per employee: employer and employee details, the card, and the KRA footer.
export function p9PrintHtml(x,esc){
 return (x.employees||[]).map(e=>`<section class="p9page" style="page-break-after:always"><h3>Tax Deduction Card (P9), Year ${esc(x.year)}</h3><p>Employer: <b>${esc(x.client?.name||'')}</b> · Employer PIN: <b>${esc(x.client?.pin||'')}</b><br>Employee: <b>${esc(e.surname)} ${esc(e.other_names)}</b> · Employee PIN: <b>${esc(e.pin)}</b></p>${cardTable(e,x.columns,esc)}</section>`).join('');
}
// A ZIP with stored (uncompressed) entries: one CSV per employee. Plain text needs no compression and this keeps the module free of libraries.
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
export function zipStore(files){
 const enc=new TextEncoder(),parts=[],central=[];let offset=0;
 const u16=n=>[n&255,(n>>>8)&255],u32=n=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
 for(const f of files){
  const name=enc.encode(f.name),data=enc.encode(f.text),crc=crc32(data);
  const local=Uint8Array.from([0x50,0x4b,3,4,...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0)]);
  parts.push(local,name,data);
  central.push(Uint8Array.from([0x50,0x4b,1,2,...u16(20),...u16(20),...u16(0x0800),...u16(0),...u16(0),...u16(0x21),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset)]),name);
  offset+=local.length+name.length+data.length;
 }
 const cdSize=central.reduce((n,p)=>n+p.length,0);
 const end=Uint8Array.from([0x50,0x4b,5,6,...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(cdSize),...u32(offset),...u16(0)]);
 const all=[...parts,...central,end],out=new Uint8Array(all.reduce((n,p)=>n+p.length,0));let o=0;for(const p of all){out.set(p,o);o+=p.length;}
 return out;
}
export function downloadZip(name,files){
 const url=URL.createObjectURL(new Blob([zipStore(files)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
