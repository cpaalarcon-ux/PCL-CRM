// KRA VAT CSV evidence screens (build 2831a). The server (kra-csv-actions.ts, kra-csv-rules.mjs) owns every rule.
// This module draws the retained files, the reconciliation to the approved registers and the reviewer decisions. It never changes a register.
import {downloadCsv} from './staff-statutory-files.mjs?v=20261117-frame-v1';
export const KRA_NOTE='Upload each section of the KRA VAT auto-populated return exactly as downloaded. The ERP keeps the original file, reads invoice numbers and PINs as text so leading zeros survive, and compares the totals with the approved sales register and the lines with your supplier invoices. A corrected file becomes a new version; the earlier one is kept. Nothing here changes a register or posts anything.';
const kes=v=>v==null||v===''?'':Number(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const STATUS_CLASS={Agrees:'good','Differs':'bad','Incomplete':'warn','No CSV uploaded':'warn','CSV not uploaded':'warn','No register':'bad'};
const badge=(s,esc)=>`<span class="badge ${STATUS_CLASS[s]||'warn'}">${esc(s)}</span>`;
export function sectionsTable(r,esc,button){
 const rows=(r.sections||[]).map(s=>{const c=s.current;return `<tr><td>${esc(s.label)}</td><td>${c?`v${esc(c.version)} · ${esc(c.file_name)}`:'<span class="muted">Not uploaded</span>'}</td><td class="num">${c?esc(c.line_count):''}</td><td class="num">${c?kes(c.totals?.net):''}</td><td class="num">${c?kes(c.totals?.vat):''}</td><td>${c?esc(c.uploaded_by||'')+' · '+esc(String(c.uploaded_at||'').slice(0,10)):''}</td><td class="actions">${button('kra-upload',c?'Upload new version':'Upload',s.section)}${c?button('kra-original','Original',c.batch_id):''}</td></tr>`;}).join('');
 return `<div class="scroll"><table id="kraSections"><thead><tr><th>Section</th><th>Retained file</th><th class="num">Lines</th><th class="num">Net</th><th class="num">VAT</th><th>Uploaded</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
export function salesPanel(s,esc){
 const rows=(s.categories||[]).map(c=>`<tr><td>${esc(c.category)}</td><td>${badge(c.status,esc)}</td><td class="num">${c.uploaded?kes(c.csv_net):'–'}</td><td class="num">${c.register_present?kes(c.register_net):'–'}</td><td class="num">${c.uploaded?kes(c.difference_net):''}</td><td class="num">${c.uploaded?kes(c.csv_vat):'–'}</td><td class="num">${c.register_present?kes(c.register_vat):'–'}</td><td class="num">${c.uploaded?kes(c.difference_vat):''}</td></tr>`).join('');
 return `<h4>Sales: KRA CSV against the approved sales register ${badge(s.status,esc)}</h4>${s.register_imports===0?'<p class="muted">There is no confirmed sales update for this month, so there is nothing to compare with yet.</p>':''}<div class="scroll"><table><thead><tr><th>VAT category</th><th>Result</th><th class="num">CSV net</th><th class="num">Register net</th><th class="num">Net difference</th><th class="num">CSV VAT</th><th class="num">Register VAT</th><th class="num">VAT difference</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">A section that has not been uploaded is shown as not uploaded, never as zero. VAT may differ by KES 1.00 for rounding; net must agree to the cent.</p>`;
}
export function differencesPanel(side,title,x,esc,button,total){
 const list=x.differences||[];
 if(!list.length)return x.status==='No CSV uploaded'?'':`<h4>${esc(title)}</h4><p><span class="badge good">No differences</span></p>`;
 const rows=list.map((d,i)=>{const desc=side==='Sales'?`${esc(d.category)} · CSV ${kes(d.csv_net)} against register ${kes(d.register_net)}`:`${esc(d.invoice||'')} · ${esc(d.party||'')} ${esc(d.party_pin||'')}${d.csv_net!=null?` · CSV ${kes(d.csv_net)}`:''}${d.register_net!=null?` · register ${kes(d.register_net)}`:''}${d.register_category?` · register category ${esc(d.register_category)}`:''}${d.csv_category?` · KRA ${esc(d.csv_category)}`:''}`;
  return `<tr><td>${esc(d.kind)}</td><td>${desc}${d.detail?`<br><small class="muted">${esc(d.detail)}</small>`:''}</td><td>${d.review?`<span class="badge ${d.cleared?'good':'warn'}">${esc(d.review.disposition)}</span><br><small>${esc(d.review.reviewed_by||'')} · ${esc(String(d.review.reviewed_at||'').slice(0,10))}<br>${esc(d.review.reason)}</small>`:'<span class="badge bad">Open</span>'}</td><td>${d.cleared?'':button('kra-review','Review',String(i),`data-side="${esc(side)}"`)}</td></tr>`;}).join('');
 return `<h4>${esc(title)} · ${esc(x.open)} open, ${esc(x.cleared)} cleared${total>list.length?` (first ${list.length} of ${esc(total)} shown)`:''}</h4><div class="scroll"><table><thead><tr><th>Difference</th><th>Detail</th><th>Decision</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
export function purchasesSummary(p,esc){
 const rows=(p.categories||[]).map(c=>`<tr><td>${esc(c.category)}</td><td>${c.uploaded?'v'+esc(c.version):'<span class="muted">Not uploaded</span>'}</td><td class="num">${c.uploaded?kes(c.csv_net):'–'}</td><td class="num">${kes(c.register_net)}</td><td class="num">${esc(c.lines)} / ${esc(c.register_lines)}</td></tr>`).join('');
 return `<h4>Purchases: KRA CSV matched to supplier invoices ${badge(p.status,esc)}</h4><p class="muted">${esc(p.matched||0)} of ${esc(p.csv_lines||0)} CSV lines matched a supplier invoice by invoice number and PIN. Zero-rated, exempt and standard-rated lines stay distinct; a missing or conflicting category is listed for review and is not taken from the CSV, the supplier or the rate.</p><div class="scroll"><table><thead><tr><th>Category</th><th>CSV</th><th class="num">CSV net</th><th class="num">Register net</th><th class="num">Lines (CSV / register)</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
export function changesPanel(changes,esc){
 const items=Object.entries(changes||{}).map(([s,c])=>`<li>Section ${esc(s)} version ${esc(c.from_version)} → ${esc(c.to_version)}: ${esc(c.added_count)} added, ${esc(c.removed_count)} removed, ${esc(c.changed_count)} changed, ${esc(c.unchanged)} unchanged. <small>${esc(c.reason||'')}</small></li>`).join('');
 return items?`<h4>Changed since the earlier file</h4><ul>${items}</ul>`:'';
}
export function createKraCsvUI(ctx,{show,button}){
 const {esc,field,select,form,request,notice,projectName}=ctx;
 let pid='',month='',lastRead=null;
 async function view(){
  const r=await request({action:'kra_csv_read',project_id:pid,month});lastRead=r;
  show('KRA VAT CSVs · '+month,`<p><b>${esc(projectName(pid))}</b></p><p class="info full">${esc(KRA_NOTE)}</p><div class="actions">${button('kra-csv','Choose another month')}${button('back','Back')}</div>${sectionsTable(r,esc,button)}${changesPanel(r.version_changes,esc)}${salesPanel(r.sales,esc)}${differencesPanel('Sales','Sales differences',r.sales,esc,button,r.sales.differences.length)}${purchasesSummary(r.purchases,esc)}${differencesPanel('Purchases','Purchase differences',r.purchases,esc,button,r.purchases.difference_count)}`);
 }
 const handlers={
  async 'kra-csv'(){
   show('KRA VAT CSVs',`<p><b>${esc(projectName(pid))}</b></p><p class="info full">${esc(KRA_NOTE)}</p>`+form(field('month','Month *',month||new Date().toISOString().slice(0,7),'month','required'),'Open'),async f=>f.get('month'),m=>{month=m;return view();},{refreshWorkspace:false});
  },
  async 'kra-upload'(section){
   const cur=(lastRead?.sections||[]).find(s=>s.section===section),label=cur?.label||section;
   show('Upload '+label+' · '+month,`<p class="info full">${esc(KRA_NOTE)}</p>`+form(`<label class="full">KRA CSV file *<input type="file" name="file" accept=".csv,text/csv" required></label>`+(cur?.current?field('supersede_reason','Why this file replaces version '+cur.current.version+' *','','text','required minlength="10" maxlength="500"'):''),'Keep this file'),
    async f=>{const file=f.get('file');if(!file||!file.name)throw new Error('Choose the CSV file.');const text=await file.text();return request({action:'kra_csv_upload',project_id:pid,month,section,file_name:file.name,csv_text:text,supersede_reason:f.get('supersede_reason')||undefined});},
    x=>{notice(`Kept ${x.label}, version ${x.version}: ${x.line_count} lines${x.warning_count?`, ${x.warning_count} to check`:''}.`);return view();},{refreshWorkspace:false,pendingLabel:'Reading the file…'});
  },
  async 'kra-original'(id){const x=await request({action:'kra_csv_original',project_id:pid,batch_id:id});downloadCsv(x.file_name,x.content_text);notice('Downloaded the original file, unchanged.');},
  async 'kra-review'(i,el){
   const side=el?.dataset.side,d=(lastRead?.[side.toLowerCase()]?.differences||[])[Number(i)];if(!d)return view();
   show('Decide on a difference',`<p><b>${esc(d.kind)}</b></p>`+form(select('disposition','Decision *',(lastRead.dispositions||[]).map(x=>[x,x]),'','Choose')+field('reason','What you found or decided *','','text','required minlength="10" maxlength="500"')+'<p class="muted full">Explained and Accepted difference clear it. Register to be corrected and Query raised keep it open. A new CSV version or a change to the register reopens it.</p>','Record decision'),
    async f=>request({action:'kra_csv_review',project_id:pid,month,side,scope_key:d.scope_key,evidence_key:d.evidence_key,disposition:f.get('disposition'),reason:f.get('reason')}),()=>{notice('Decision recorded.');return view();},{refreshWorkspace:false});
  }
 };
 return {isAction:a=>Object.hasOwn(handlers,a),async handle(a,id,el){pid=id;return handlers[a](el?.dataset.id,el);},open(id){pid=id;return handlers['kra-csv']();}};
}
