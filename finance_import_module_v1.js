/* Browser-local historical finance register. Does not post to receivables. */
(function () {
  "use strict";
  const C = window.PCLFinanceImportCore;
  const KEY = "pcl-finance-import-history-v1", CLIENTS = "pcl-crm-clients-v1";
  const esc = value => C.clean(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const json = (key, fallback) => { const text = localStorage.getItem(key); return text ? JSON.parse(text) : fallback; };
  const clientList = () => json(CLIENTS, []).filter(c => !c.deletedAt);
  const firmList = () => typeof activeFirms === "function" ? activeFirms() : [];
  const category = () => json("pcl-unified-shell-preview-v1", {}).category || "Engagement Partner";
  const allowed = () => ["Engagement Partner", "Manager"].includes(category());
  const data = () => {
    const result = json(KEY, { schema: 1, records: [], batches: [] });
    if (result.schema !== 1 || !Array.isArray(result.records) || !Array.isArray(result.batches)) throw new Error("Finance history storage is invalid. Restore the saved data before importing.");
    return result;
  };
  const kes = cents => `KES ${(cents/100).toLocaleString("en-KE", {minimumFractionDigits:2, maximumFractionDigits:2})}`;
  const byId = id => document.getElementById(id);
  let loadedSheets = [], review = null, editing = null, page = 0;
  function message(text, error = false) { const node=byId("financeImportNotice"); node.textContent=text; node.className=`fi-notice${error?" fi-missing":""}`; }
  function guard() { if (!allowed()) throw new Error("Only Engagement Partners and Managers may access imported finance history."); }
  function save(next, previous) {
    guard();
    if ((localStorage.getItem(KEY) || "") !== previous) throw new Error("Finance history changed in another tab. Refresh and review again.");
    localStorage.setItem(KEY, JSON.stringify(next)); // One atomic localStorage write.
  }
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.__pclXlsxLoading) return window.__pclXlsxLoading;
    window.__pclXlsxLoading = new Promise((resolve,reject) => {
      const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error("Excel reader unavailable."));
      script.onerror=()=>reject(new Error("Could not load the Excel reader."));document.head.append(script);
    });return window.__pclXlsxLoading;
  }
  async function readFiles(files) {
    guard(); review=null;loadedSheets=[];byId("financeImportReview").replaceChildren();
    if (!files.length) return;
    message("Reading Excel files…");
    try {
      const XLSX=await ensureXlsx(), sheets=[];
      for (const file of files) {
        if (file.size > 20*1024*1024) throw new Error(`${file.name}: file exceeds 20 MB.`);
        const book=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
        let usable=0;
        for (const sheetName of book.SheetNames) {
          const matrix=XLSX.utils.sheet_to_json(book.Sheets[sheetName],{header:1,raw:true,defval:null,blankrows:true});
          const headerIndex=matrix.findIndex(row=>row.includes("Number")&&(row.includes("Amount Signed")||row.includes("Total in Currency Signed")));
          if (headerIndex<0) continue;
          const headers=matrix[headerIndex].map(C.clean), kind=headers.includes("Amount Signed")?"Payment":"Journal";
          if (new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length) throw new Error(`${file.name}: duplicate column headings.`);
          const rows=[];
          matrix.slice(headerIndex+1).forEach((values,i)=>{if(values.some(v=>C.clean(v)))rows.push({rowNumber:headerIndex+i+2,values:Object.fromEntries(headers.map((h,j)=>[h,values[j]??null]))});});
          sheets.push({fileName:file.name,sheetName,kind,rows});usable++;
        }
        if (!usable) throw new Error(`${file.name}: expected Payment or Journal Entry export columns were not found.`);
      }
      guard();loadedSheets=sheets;
      message(`${sheets.length} worksheet(s), ${sheets.reduce((n,s)=>n+s.rows.length,0)} nonblank rows loaded. Currency: Kenyan shillings (KES). Review the import before saving.`);
    } catch(error) { loadedSheets=[];message(error.message,true); }
  }
  function preview() {
    guard();if(!loadedSheets.length)throw new Error("Select the Excel files first.");
    const firmId=byId("financeImportFirm").value;
    if(firmId&&!firmList().some(f=>f.id===firmId))throw new Error("Select a valid firm or leave it missing.");
    const previous=localStorage.getItem(KEY)||"", clients=clientList();
    const result=C.prepare(loadedSheets,data().records,clients,firmId);
    review={result,previous,clientSnapshot:JSON.stringify(clients),firmId};
    const s=C.summary(result.records,clients), issues=[...result.conflicts,...result.errors];
    byId("financeImportReview").innerHTML=`<div class="fi-notice"><b>Import review · KES</b><p>${result.rowsRead} rows read · <b>${s.count} new records</b> · ${result.duplicates.length} duplicates skipped · ${result.conflicts.length} conflicts · ${result.errors.length} invalid rows.</p><p>${s.payments} payments: ${kes(s.paymentMinor)}. ${s.journals} journal entries: ${kes(s.journalMinor)}.</p><p>${s.linked} records link to an existing client. ${s.count-s.linked} require a client link. Missing firms and unallocated payments remain highlighted in red.</p></div>${issues.length?`<div class="fi-missing">${issues.map(i=>`<p>${esc(i.fileName)}, row ${i.row}: ${esc(i.reason)}</p>`).join("")}</div>`:""}<p>Imported history preserves source statuses and references. It does not mark invoices paid, create new clients or change statements.</p><label class="fi-confirm"><input type="checkbox" id="financeImportConfirm" /> I have reviewed the KES totals and understand the outstanding links.</label><button type="button" id="financeImportSave" ${!s.count||issues.length?"disabled":""}>Import ${s.count} new finance records</button>`;
  }
  function commit() {
    guard();if(!review||!byId("financeImportConfirm")?.checked)throw new Error("Review the import and check the confirmation box.");
    if(review.firmId!==byId("financeImportFirm").value||review.clientSnapshot!==JSON.stringify(clientList()))throw new Error("The firm selection or client list changed. Review the import again.");
    const {result}=review;
    if(result.errors.length||result.conflicts.length||!result.records.length)throw new Error("Resolve conflicts and invalid rows before importing.");
    const next=data(), at=new Date().toISOString(), batchId=crypto.randomUUID();
    next.records.push(...result.records.map(r=>({...r,id:crypto.randomUUID(),batchId,importedAt:at,importedByCategory:category()})));
    next.batches.push({id:batchId,at,category:category(),currency:"KES",files:loadedSheets.map(s=>({fileName:s.fileName,sheetName:s.sheetName,rows:s.rows.length})),rowsRead:result.rowsRead,imported:result.records.length,duplicates:result.duplicates,conflicts:result.conflicts,errors:result.errors});
    save(next,review.previous);
    const total=result.records.length, duplicates=result.duplicates.length;
    review=null;loadedSheets=[];byId("financeImportFiles").value="";byId("financeImportReview").replaceChildren();page=0;render();
    message(`${total} finance records imported in this browser. ${duplicates} duplicate rows skipped. Existing client links saved; missing details remain Update required.`);
  }
  function filtered(records) {
    const search=C.nameKey(byId("financeHistorySearch").value), clientId=byId("financeHistoryClient").value, kind=byId("financeHistoryKind").value;
    return records.filter(r=>(!search||C.nameKey(`${r.reference} ${r.sourceClientName}`).includes(search))&&(!kind||r.kind===kind)&&(!clientId||(clientId==="__MISSING__"?!r.clientId:r.clientId===clientId)));
  }
  function render() {
    const access=allowed();byId("financeHistoryBody").hidden=!access;byId("financeHistoryDenied").hidden=access;
    if(!access){byId("financeHistoryRows").replaceChildren();byId("financeHistorySummary").replaceChildren();byId("financeHistoryEdit").replaceChildren();byId("financeImportReview").replaceChildren();review=null;editing=null;return;}
    const state=data(), clients=clientList(), firms=firmList();
    for(const [id,items,first] of [["financeImportFirm",firms.map(f=>[f.id,f.legalName]),"Leave missing — update later"],["financeHistoryClient",clients.map(c=>[c.id,c.companyName||c.importReference]),"All clients"]]){
      const node=byId(id),selected=node.value;
      node.innerHTML=`<option value="">${first}</option>${id==="financeHistoryClient"?'<option value="__MISSING__">Client link required</option>':""}${items.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join("")}`;
      node.value=selected;
    }
    const rows=filtered(state.records), s=C.summary(rows,clients);
    byId("financeHistorySummary").innerHTML=`<div><b>${s.count}</b><span>Imported records</span></div><div><b>${s.payments}</b><span>Payments · ${kes(s.paymentMinor)}</span></div><div><b>${s.journals}</b><span>Journal entries · ${kes(s.journalMinor)}</span></div><div><b>${s.linked}</b><span>Linked to existing clients · ${s.count-s.linked} need linking</span></div>`;
    byId("financeHistoryCounts").textContent=`${state.records.length} saved records. Showing ${rows.length} with the selected filters. Imported history is excluded from invoice balances and statements pending reconciliation.`;
    page=Math.min(page,Math.max(0,Math.ceil(rows.length/40)-1));
    byId("financeHistoryRows").innerHTML=rows.slice(page*40,page*40+40).map(r=>{
      const client=clients.find(c=>c.id===r.clientId), firm=firms.find(f=>f.id===r.firmId), missing=C.needs(r,clients);
      return `<tr data-finance-record="${esc(r.id)}"><td><b>${esc(r.reference)}</b><br>${esc(r.date)}<br><small>${esc(r.kind==="Payment"?r.kind:r.suggestedType)}</small></td><td>${esc(r.sourceClientName)}<br>${client?`<button type="button" class="fi-link" data-finance-open-client="${esc(client.id)}">${esc(client.companyName||client.importReference)}</button><br><small>${esc(r.linkMethod)}</small>`:'<span class="fi-missing">Client link — Update required</span>'}</td><td>${firm?esc(firm.legalName):'<span class="fi-missing">Owning firm — Update required</span>'}</td><td class="fi-amount">${kes(r.amountMinor)}</td><td>${esc(r.sourceStatus||"Not supplied")}<br><small>Source status only</small></td><td><span class="fi-missing">Update required: ${esc(missing.join(", "))}</span></td><td><button type="button" data-finance-edit="${esc(r.id)}">Review / link</button></td></tr>`;
    }).join("")||'<tr><td colspan="7">No imported finance records match these filters.</td></tr>';
    byId("financeHistoryPage").textContent=`Page ${page+1} of ${Math.max(1,Math.ceil(rows.length/40))}`;
    byId("financeHistoryPrevious").disabled=page===0;byId("financeHistoryNext").disabled=(page+1)*40>=rows.length;
    byId("financeImportBatches").innerHTML=state.batches.slice().reverse().map(b=>`<li>${esc(b.at)} · ${b.rowsRead} rows read, ${b.imported} imported, ${b.duplicates.length} duplicates skipped · ${esc(b.category)}</li>`).join("");
  }
  function openEdit(id) {
    guard();const record=data().records.find(r=>r.id===id);if(!record)throw new Error("Record no longer exists.");
    editing={id,snapshot:JSON.stringify(record)};
    byId("financeHistoryEdit").innerHTML=`<form id="financeHistoryEditForm" class="card fi-card"><h3>Review ${esc(record.reference)}</h3><p>Source client: ${esc(record.sourceClientName)} · ${kes(record.amountMinor)} · ${esc(record.date)}. Original figures and references are preserved.</p><div class="grid"><label>Linked client<select name="clientId"><option value="">Update required</option>${clientList().map(c=>`<option value="${esc(c.id)}"${c.id===record.clientId?" selected":""}>${esc(c.companyName||c.importReference)}</option>`).join("")}</select></label><label>Owning firm<select name="firmId" ${record.firmId?"disabled":""}><option value="">Update required</option>${firmList().map(f=>`<option value="${esc(f.id)}"${f.id===record.firmId?" selected":""}>${esc(f.legalName)}</option>`).join("")}</select></label><label>Payment method<select name="paymentMethod" ${record.kind!=="Payment"?"disabled":""}>${["","Cash","M-Pesa","Bank","Cheque"].map(v=>`<option value="${v}"${v===record.paymentMethod?" selected":""}>${v||"Update required"}</option>`).join("")}</select></label><label>Document type<select name="documentType" ${record.kind==="Payment"?"disabled":""}>${(record.kind==="Payment"?["Payment"]:["Unconfirmed","Credit Note","Invoice","Other Journal"]).map(v=>`<option${v===record.documentType?" selected":""}>${v}</option>`).join("")}</select></label><label class="full">Reason for update<textarea required name="reason"></textarea></label></div><p class="hint">Saving a client link does not allocate a payment or post an invoice. Source: ${esc(record.source.fileName)}, ${esc(record.source.sheetName)}, row ${record.source.row}.</p><button type="submit">Save links and review details</button> <button type="button" id="financeHistoryCancel">Cancel</button></form>`;
    byId("financeHistoryEdit").scrollIntoView({block:"center",behavior:"smooth"});
  }
  function saveEdit(form) {
    guard();const previous=localStorage.getItem(KEY)||"",next=data(),index=next.records.findIndex(r=>r.id===editing?.id);
    if(index<0||JSON.stringify(next.records[index])!==editing.snapshot)throw new Error("The record changed. Reopen it before saving.");
    const r=next.records[index],values={};
    ["clientId","firmId","paymentMethod","documentType"].forEach(f=>values[f]=form.elements[f].disabled?r[f]:form.elements[f].value);
    const updated=C.amend(r,values,form.elements.reason.value,clientList(),firmList(),category(),new Date().toISOString());
    if(next.records.some(other=>other.id!==r.id&&other.kind===r.kind&&other.reference.toUpperCase()===r.reference.toUpperCase()&&updated.firmId&&other.firmId===updated.firmId))throw new Error("This reference already belongs to the selected firm.");
    next.records[index]=updated;save(next,previous);editing=null;byId("financeHistoryEdit").replaceChildren();render();message("Client link and review details saved. Original source data is unchanged.");
  }
  function navigate() {
    guard();document.querySelector('#unifiedTabs [data-erp-group="finance"]')?.click();
    document.querySelector('#unifiedSubnav [data-sub-panel="finance-import"]')?.click();render();
  }
  function openClientHistory(id) {navigate();byId("financeHistoryClient").value=id;page=0;render();}
  function showClient(id) {
    guard();document.querySelector('#unifiedTabs [data-erp-group="clients"]')?.click();
    window.pclClientProfiles?.openEditor(id);clientButton(id);
  }
  function clientButton(id) {
    const title=byId("clientEditTitle");if(!title)return;
    let button=byId("clientImportedFinance");if(!button){button=document.createElement("button");button.type="button";button.id="clientImportedFinance";title.after(button);}
    button.hidden=!allowed();button.textContent=`View imported finance history (${allowed()?data().records.filter(r=>r.clientId===id).length:0})`;button.onclick=()=>openClientHistory(id);
  }
  function start() {
    const panel=document.createElement("section");panel.id="finance-import";panel.className="tab-panel";
    panel.innerHTML=`<div class="intro"><div><h2>Finance import &amp; client history</h2><p>Historical payments and journal entries linked to existing clients. Currency: Kenyan shillings (KES).</p></div></div><p id="financeHistoryDenied" hidden>Only Engagement Partners and Managers can access this register.</p><div id="financeHistoryBody"><p class="fi-notice">Records are saved in this browser only. Missing firms, client links and invoice allocations remain open for review. This history does not change posted receivables or statements.</p><div id="financeImportNotice" role="status" aria-live="polite"></div><div id="financeHistorySummary" class="fi-summary"></div><details class="card fi-card" open><summary><b>Upload finance Excel files</b></summary><div class="grid"><label>Payment / Journal Entry Excel files<input type="file" id="financeImportFiles" accept=".xlsx,.xls" multiple /></label><label>Owning firm for this batch<select id="financeImportFirm"></select></label><label>Currency<input value="KES — Kenyan shillings" readonly /></label></div><button type="button" id="financeImportPreview">Review finance import</button><div id="financeImportReview"></div></details><div id="financeHistoryEdit"></div><div class="card fi-card"><h3>Imported client finance history</h3><div class="grid"><label>Search reference or source client<input id="financeHistorySearch" type="search" /></label><label>Client filter<select id="financeHistoryClient"></select></label><label>Record type<select id="financeHistoryKind"><option value="">All records</option><option>Payment</option><option value="Journal">Journal / possible credit note</option></select></label></div><p id="financeHistoryCounts"></p><div class="table-wrap"><table class="data-table"><thead><tr><th>Reference / date</th><th>Source and linked client</th><th>Firm</th><th>Signed amount (KES)</th><th>Source status</th><th>Required updates</th><th>Action</th></tr></thead><tbody id="financeHistoryRows"></tbody></table></div><div class="actions"><button id="financeHistoryPrevious" type="button">Previous</button><span id="financeHistoryPage"></span><button id="financeHistoryNext" type="button">Next</button></div></div><details class="card fi-card"><summary>Import history</summary><ul id="financeImportBatches"></ul></details></div>`;
    document.querySelector(".shell").append(panel);
    const style=document.createElement("style");style.textContent='.fi-card{padding:18px;margin:16px 0}.fi-card summary{cursor:pointer;margin-bottom:12px}.fi-notice{padding:12px;margin:10px 0;border:1px solid #c8d9d0;border-radius:8px;background:#f1f8f4}.fi-missing{color:#a11b1b;background:#fff0f0;border-radius:4px;padding:3px 5px;font-size:12px}.fi-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.fi-summary>div{padding:18px;background:#fff;border:1px solid #dce4e0;border-top:3px solid #0b3d2e;border-radius:9px}.fi-summary b{font-size:28px;display:block}.fi-summary span{font-size:12px}.fi-amount{white-space:nowrap}.fi-link{border:0;background:none;color:#07523c;padding:0;text-decoration:underline;text-align:left}.fi-confirm{display:flex;gap:8px;align-items:center;margin:14px 0}.fi-confirm input{width:auto}#finance-import [hidden]{display:none!important}@media(max-width:800px){.fi-summary{grid-template-columns:1fr 1fr}}';document.head.append(style);
    panel.addEventListener("click",event=>{const b=event.target.closest("button");if(!b)return;try{
      if(b.id==="financeImportPreview")preview();else if(b.id==="financeImportSave")commit();else if(b.dataset.financeEdit)openEdit(b.dataset.financeEdit);else if(b.dataset.financeOpenClient)showClient(b.dataset.financeOpenClient);else if(b.id==="financeHistoryCancel"){editing=null;byId("financeHistoryEdit").replaceChildren();}else if(b.id==="financeHistoryNext"){page++;render();}else if(b.id==="financeHistoryPrevious"){page--;render();}
    }catch(error){message(error.message,true);}});
    panel.addEventListener("submit",event=>{if(event.target.id!=="financeHistoryEditForm")return;event.preventDefault();try{saveEdit(event.target);}catch(error){message(error.message,true);}});
    byId("financeImportFiles").addEventListener("change",event=>readFiles([...event.target.files]));
    byId("financeImportFirm").addEventListener("change",()=>{review=null;byId("financeImportReview").replaceChildren();});
    ["financeHistoryClient","financeHistoryKind"].forEach(id=>byId(id).addEventListener("change",()=>{page=0;render();}));
    byId("financeHistorySearch").addEventListener("input",()=>{page=0;render();});
    document.addEventListener("click",event=>{if(event.target.closest('[data-sub-panel="finance-import"]')){try{render();}catch(error){message(error.message,true);}}const client=event.target.closest("[data-edit-client]");if(client&&allowed())clientButton(client.dataset.editClient);});
    byId("client-form")?.addEventListener("reset",()=>{if(byId("clientImportedFinance"))byId("clientImportedFinance").hidden=true;});
    ["erpPreviewCategory","workspacePositionFilter"].forEach(id=>byId(id)?.addEventListener("change",()=>{loadedSheets=[];review=null;editing=null;byId("financeImportFiles").value="";byId("financeImportNotice").replaceChildren();byId("financeImportReview").replaceChildren();if(byId("clientImportedFinance"))byId("clientImportedFinance").hidden=true;render();}));
    window.addEventListener("storage",event=>{if([KEY,CLIENTS,"pcl-unified-shell-preview-v1"].includes(event.key)){try{render();}catch(error){message(error.message,true);}}});
    render();
  }
  window.pclFinanceHistory={openClientHistory};
  start();
})();
