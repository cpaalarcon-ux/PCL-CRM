/* Editable, incomplete client intake for the browser-local preview.
   No real client data is bundled. Server-side authorization is required before go-live. */
(function () {
  "use strict";
  const key = "pcl-crm-clients-v1";
  let editingId = null, snapshot = null, internalReset = false;
  const clean = value => String(value ?? "").trim();
  const norm = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  const esc = value => clean(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function canManage() {
    try { const role = JSON.parse(localStorage.getItem("pcl-unified-shell-preview-v1") || "{}").category || "Engagement Partner"; return ["Engagement Partner", "Manager"].includes(role); } catch (_) { return false; }
  }
  function readClients() {
    const records = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(records)) throw new Error("The client directory could not be read. Nothing was changed.");
    return records;
  }
  function missing(client) {
    const fields = [];
    const add = (id, label, valid) => { if (!valid) fields.push({id, label}); };
    add("companyName", "Company name", clean(client.companyName));
    add("clientFirm", "Initial servicing firm", client.firmId && firmById(client.firmId));
    add("primarySector", "Primary sector", CRM.sectors.includes(client.primarySector));
    add("branchLocation", "Branch location", CRM.branches.includes(client.branchLocation));
    add("clientCategory", "Client category", CRM.clientCategories.includes(client.clientCategory));
    add("contactName", "Contact name", clean(client.contact?.name));
    add("email", "Contact email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(client.contact?.email)));
    add("phone", "Contact phone", clean(client.contact?.phone));
    add("servicePicker", "Services requested", (client.services || []).some(service => allServices().includes(service)));
    if (client.clientCategory === "Corporate") add("incorporationDate", "Incorporation date", /^\d{4}-\d{2}-\d{2}$/.test(clean(client.incorporationDate)));
    if ((client.services || []).includes("Tax Compliance (VAT, PAYE, Income Tax)")) add("taxWorkPacks", "Tax work packs", client.taxProfile?.workPacks?.length);
    if (client.smeAuditExempt) add("smeAuditExemptionBasis", "Approved SME exemption basis", clean(client.smeAuditExemptionBasis));
    return fields;
  }
  function stamp(client) {
    const fields = missing(client);
    return {...client, profileStatus:fields.length ? "Draft" : "Details complete", missingFields:fields.map(field=>field.label)};
  }
  function message(text, error = false) {
    const el = document.getElementById("clientProfileNotice");
    if (el) { el.textContent = text; el.className = `client-profile-notice${error ? " error" : ""}`; }
  }
  function fieldState(client) {
    const fields = missing(client), form = document.getElementById("client-form");
    form.querySelectorAll(".client-field-missing").forEach(el=>el.classList.remove("client-field-missing"));
    form.querySelectorAll(".client-missing-label").forEach(el=>el.remove());
    fields.forEach(field=>{
      const el=document.getElementById(field.id); if(!el)return;
      el.classList.add("client-field-missing");
      const badge=document.createElement("small"); badge.className="client-missing-label"; badge.textContent="Missing / needs correction";
      el.insertAdjacentElement("afterend",badge);
    });
    const summary=document.getElementById("clientMissingSummary");
    summary.textContent=fields.length ? `Draft profile — ${fields.length} required details missing: ${fields.map(field=>field.label).join(", ")}. Save what you have and complete these later.` : "Profile details complete. KYC verification, approvals and the signed Engagement Letter are still required before engagement activation.";
    summary.className=`client-profile-notice${fields.length ? " error" : ""}`;
  }
  function formRecord() {
    const form=document.getElementById("client-form"), data=new FormData(form);
    // buildClient is the existing CRM field mapper. Its generated tasks are not committed here.
    const record=buildClient(form);
    record.firmId = form.elements.clientFirm.value;
    record.importReference=clean(data.get("importReference"));
    record.incorporationDate=data.get("incorporationDate")||null;
    record.smeAuditExempt=data.get("smeAuditExempt")==="on";
    record.smeAuditExemptionBasis=clean(data.get("smeAuditExemptionBasis"));
    record.etimsOnboardingRequired=data.get("etimsOnboardingRequired")==="on";
    return record;
  }
  function updateFieldState() { try { fieldState(formRecord()); } catch (_) { /* Existing form may still be initialising. */ } }
  function setControl(name,value) {
    const form=document.getElementById("client-form"), control=form.elements.namedItem(name);
    if(!control)return;
    if(control.type==="checkbox") {control.checked=Boolean(value);return;}
    if(control.tagName==="SELECT" && value && !Array.from(control.options).some(option=>option.value===value)) control.add(new Option(String(value),String(value)));
    control.value=value??"";
  }
  function resetEditor() {
    editingId=null;snapshot=null;
    const form=document.getElementById("client-form");internalReset=true;form.reset();internalReset=false;
    form.elements.clientFirm.disabled=false;
    form.elements.importReference.readOnly=false;
    form.querySelector('[type="submit"]').textContent="Save client draft";
    document.getElementById("clientEditTitle").textContent="New client profile";
    showRecommendation();showTaxComplianceProfile();updateFieldState();
  }
  function openEditor(id) {
    if(!canManage())return message("Only Engagement Partners and Managers may edit client master details in this preview.",true);
    let record;try {record=readClients().find(item=>item.id===id&&!item.deletedAt);}catch(error){return message(error.message,true);}
    if(!record)return message("Client not found. Refresh the directory.",true);
    resetEditor();editingId=id;snapshot=JSON.stringify(record);
    const direct=["companyName","tradingName","primarySector","branchLocation","clientCategory","leadSource","pieStatus","isSacco","billingFrequency","pipelineStage","engagementValue","engagementLetter","notes","incorporationDate","smeAuditExempt","smeAuditExemptionBasis","etimsOnboardingRequired","importReference"];
    direct.forEach(name=>setControl(name,record[name]));setControl("clientFirm",record.firmId);
    for(const [name,key] of Object.entries({contactName:"name",jobTitle:"jobTitle",email:"email",phone:"phone",decisionRole:"decisionRole"}))setControl(name,record.contact?.[key]);
    const taxMap={etimsStatus:"etimsStatus",taxReportingMonth:"reportingMonth",taxYearStart:"financialYearStart",taxYearEnd:"financialYearEnd",corporationTaxRate:"corporationTaxRate",openingVatCredit:"openingVatCredit",openingStock:"openingStock",finalStockStatus:"finalStockStatus",instalmentMethod:"instalmentMethod",priorYearTax:"priorYearTax",currentYearTaxForecast:"currentYearTaxForecast",expectedWhtCredits:"expectedWhtCredits",taxWorkingPaper:"workingPaper"};
    Object.entries(taxMap).forEach(([field,key])=>setControl(field,record.taxProfile?.[key]));
    for(const [name,values] of Object.entries({regulator:record.regulators||[],services:record.services||[],taxRegistration:record.taxProfile?.registrations||[],taxWorkPack:record.taxProfile?.workPacks||[]}))document.querySelectorAll(`#client-form input[name="${name}"]`).forEach(input=>input.checked=values.includes(input.value));
    const form=document.getElementById("client-form");
    form.elements.clientFirm.disabled=Boolean(record.firmId);
    form.elements.importReference.readOnly=Boolean(record.importReference);
    form.querySelector('[type="submit"]').textContent="Save client changes";
    document.getElementById("clientEditTitle").textContent=`Edit: ${record.companyName||record.importReference||"Client profile"}`;
    showRecommendation();showTaxComplianceProfile();fieldState(record);
    const unmapped=Object.entries(record.unmappedImportFields||{});
    message(unmapped.length?`Imported values needing review: ${unmapped.map(([field,value])=>`${field}: ${value}`).join("; ")}. Existing IDs, engagement ownership and historical documents will be preserved.`:"Client opened for editing. Save partial details now and complete the red fields later.");
    form.scrollIntoView({behavior:"smooth",block:"start"});form.elements.companyName.focus({preventScroll:true});
  }
  function saveEditor(event) {
    event.preventDefault();event.stopImmediatePropagation();
    if(!canManage())return message("Only Engagement Partners and Managers may create or edit clients. Nothing was saved.",true);
    const form=event.currentTarget;
    // Drafts may omit required business fields, but supplied email/number/date values must still be valid.
    if(!form.reportValidity())return;
    let records,record;
    try { records=readClients(); record=formRecord(); } catch(error) {return message(error.message,true);}
    if(!record.companyName&&!record.importReference)return message("Enter a Company Name or a unique Client ID / Reference to identify this draft.",true);
    const index=records.findIndex(item=>item.id===editingId),original=index>=0?records[index]:null;
    if(editingId&&(!original||JSON.stringify(original)!==snapshot))return message("This client changed elsewhere. Reopen the profile before saving so existing changes are preserved.",true);
    if(original?.firmId&&record.firmId!==original.firmId)return message("The existing servicing firm cannot be reassigned here. A different engagement firm requires a separate engagement.",true);
    const identifiers=[record.companyName,record.tradingName,record.importReference].map(norm).filter(Boolean);
    if(records.some((item,i)=>i!==index&&[item.companyName,item.tradingName,item.importReference,...(item.previousNames||[])].map(norm).some(value=>value&&identifiers.includes(value))))return message("This name or Client Reference matches an existing client. Open that client instead of creating a duplicate.",true);
    if(record.smeAuditExempt&&(record.pieStatus||["Financial Services","Public Sector"].includes(record.primarySector)))return message("An SME exemption cannot override a PIE or high-risk sector audit requirement. Refer this decision to the Engagement Partner.",true);
    const before=original?JSON.parse(JSON.stringify(original)):null;
    record=stamp({...original,...record,id:original?.id||record.id,createdAt:original?.createdAt||record.createdAt,importReference:original?.importReference||record.importReference||crypto.randomUUID(),contact:{...original?.contact,...record.contact},taxProfile:record.taxProfile?{...original?.taxProfile,...record.taxProfile}:original?.taxProfile||null,tasks:original?.tasks||[],eqrCompleted:original?.eqrCompleted||false,reportSigned:original?.reportSigned||false,updatedAt:new Date().toISOString()});
    if(original?.companyName && original.companyName!==record.companyName) record.previousNames=[...new Set([...(original.previousNames||[]),original.companyName])];
    // Retain existing tasks. Only complete profiles receive new client-level
    // checklist/routing templates; this never activates an engagement.
    if(record.profileStatus==="Details complete"){
      const existingIds=new Set(record.tasks.map(task=>task.id));
      record.tasks=[...record.tasks,...generateWorkflows(record).filter(task=>!existingIds.has(task.id))];
    }
    const editable=["companyName","tradingName","primarySector","branchLocation","clientCategory","leadSource","contact","services","regulators","pieStatus","isSacco","billingFrequency","pipelineStage","engagementValue","engagementLetter","notes","taxProfile","incorporationDate","smeAuditExempt","smeAuditExemptionBasis","etimsOnboardingRequired","firmId"];
    const changes=before?editable.filter(field=>JSON.stringify(before[field]??null)!==JSON.stringify(record[field]??null)).map(field=>({field,before:before[field]??null,after:record[field]??null})):[];
    if(before)record.changeHistory=[...(Array.isArray(before.changeHistory)?before.changeHistory:[]),{changedAt:record.updatedAt,source:"Local client editor (not authenticated)",changes}];
    if(index>=0)records[index]=record;else records.push(record);
    try {localStorage.setItem(key,JSON.stringify(records));}catch(_){return message("Could not save in this browser. Your entered details remain in the form.",true);}
    clients=records;resetEditor();renderClientList();
    message(`${record.companyName||record.importReference} saved. ${record.missingFields.length ? `${record.missingFields.length} missing details remain highlighted in red.` : "Profile details are complete."} No engagement was activated and no KYC approval was granted.`);
    window.dispatchEvent(new CustomEvent("pcl:client-profiles-updated"));
  }
  function decorate() {
    const list=document.getElementById("clientList");if(!list)return;
    list.querySelectorAll(".client-item").forEach(card=>{
      const id=card.querySelector("[data-id]")?.dataset.id;
      const client=clients.find(item=>item.id===id);if(!client)return;
      const heading=card.querySelector("h3");
      if(heading){heading.textContent="";const button=document.createElement("button");button.type="button";button.className="client-name-edit";button.dataset.editClient=id;button.textContent=client.companyName||client.importReference||"Missing client name";button.disabled=!canManage();heading.append(button);}
      card.querySelector(".client-completeness")?.remove();
      const fields=missing(client),panel=document.createElement("div");panel.className=`client-completeness${fields.length?" incomplete":""}`;
      panel.innerHTML=fields.length?`<b>Draft — ${fields.length} missing details</b><div>${fields.map(field=>`<span class="client-missing-badge">Missing: ${esc(field.label)}</span>`).join("")}</div>`:'<b>Profile details complete</b><span class="hint"> · Engagement / KYC approval is separate.</span>';
      card.querySelector(".client-topline")?.insertAdjacentElement("afterend",panel);
      if(fields.length){const sign=card.querySelector('[data-action="sign-report"]');if(sign){sign.disabled=true;sign.title="Complete the client profile and engagement gates first.";}}
    });
  }
  function refresh() {
    clients=readClients();renderClientList();
  }
  const originalRender=renderClientList;
  renderClientList=function(){originalRender();decorate();};
  const originalTransition=validateStageTransition;
  validateStageTransition=function(lead,nextStage,...rest){
    const errors=originalTransition(lead,nextStage,...rest);
    if(nextStage==="Active Engagement"){
      const matches=clients.filter(client=>clientMatchesLead(client,lead));
      if(matches.length===1&&missing(matches[0]).length)errors.push("Complete the red missing details in the Client Profile before engagement activation.");
    }
    return errors;
  };
  const form=document.getElementById("client-form");
  if(form){
    form.querySelectorAll("[required]").forEach(input=>input.required=false);
    form.insertAdjacentHTML("afterbegin",'<h3 id="clientEditTitle">New client profile</h3><div id="clientProfileNotice" class="client-profile-notice" role="status" aria-live="polite">Save partial client details now. Missing fields will be highlighted in red.</div><div id="clientMissingSummary" class="client-profile-notice"></div><label>Client ID / Reference (optional if company name is entered)<input name="importReference" id="clientImportReference" /></label>');
    form.querySelector('[type="submit"]').textContent="Save client draft";
    form.querySelector('[type="reset"]').textContent="Cancel / New client";
    form.addEventListener("submit",saveEditor,true);
    form.addEventListener("input",updateFieldState);
    form.addEventListener("change",updateFieldState);
    form.addEventListener("reset",()=>{if(internalReset)return;setTimeout(()=>{editingId=null;snapshot=null;form.elements.clientFirm.disabled=false;form.elements.importReference.readOnly=false;form.querySelector('[type="submit"]').textContent="Save client draft";document.getElementById("clientEditTitle").textContent="New client profile";updateFieldState();},0);});
    document.getElementById("clientList")?.addEventListener("click",event=>{const button=event.target.closest("[data-edit-client]");if(button)openEditor(button.dataset.editClient);});
    updateFieldState();decorate();
  }
  const style=document.createElement("style");style.textContent='.client-name-edit{border:0;background:none;color:#07523c;font:inherit;font-weight:700;padding:0;text-align:left;text-decoration:underline;text-underline-offset:3px}.client-name-edit:disabled{color:inherit;text-decoration:none;cursor:default}.client-completeness{margin:10px 0;padding:10px;border:1px solid #c8dfd0;border-radius:7px;background:#f4fbf6}.client-completeness.incomplete,.client-profile-notice.error{background:#fff3f3;border-color:#db9e9e;color:#8d2020}.client-missing-badge{display:inline-block;margin:5px 6px 0 0;padding:3px 7px;border:1px solid #d58d8d;border-radius:5px;color:#8d2020;background:#fff;font-size:12px}.client-field-missing{border:2px solid #b42318!important;background:#fff5f5!important}.client-missing-label{display:block;color:#a51e1e;font-size:11px;margin-top:4px}.client-profile-notice{margin:10px 0;padding:12px;border:1px solid #cad8cf;border-radius:7px;font-size:12px}.client-profile-notice:empty{display:none}';document.head.append(style);
  document.addEventListener("change",()=>{document.querySelectorAll("[data-edit-client]").forEach(button=>button.disabled=!canManage());});
  window.pclClientProfiles={canManage,missing,stamp,refresh,openEditor};
})();
