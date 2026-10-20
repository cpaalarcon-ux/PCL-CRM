const CRM={
  sectors:["Agribusiness","Financial Services","Energy","Healthcare","NGO","Public Sector","SME/Startup","Legal","Education"],
  branches:["Nairobi","Bungoma","Kisii","Other"],
  regulators:["CBK","SASRA","KRA","LSK","IRA","CMA","Donor/Funder","None"],
  clientCategories:["Corporate","Non-Profit","Public Entity","Individual"],
  leadSources:["Referral","Website","Networking","Existing Client (Cross-sell)","Tender"],
  decisionRoles:["Decision Maker","Influencer","Billing Contact","Day-to-Day Contact"],
  billingFrequencies:["One-off","Monthly Retainer","Quarterly","Annually"],
  pipelineStages:["Lead","Contacted","Proposal Sent","Negotiation","Client Won","Client Lost"],
  serviceGroups:{
    "Audit & Assurance":["Statutory Audit","Internal Audit","Project Assurance","Value-for-Money Audit","Donor & Grant Assurance","Risk & Control Assurance"],
    "Tax Services":["Tax Compliance (VAT, PAYE, Income Tax)","Tax Diagnostic Reviews","Tax Advisory & Strategy","KRA Tax Exemption Applications (NGOs)","Transfer Pricing & International Tax"],
    "Accounting & Financial Reporting":["Bookkeeping & Outsourced Accounting","Payroll Management","IFRS / IPSAS Financial Reporting","Management Accounting","Cash-flow Forecasting & Financial Modeling"],
    "Advisory & Consulting":["Business Planning & Strategic Planning","Forensic Investigations","Feasibility Studies","Internal Controls Setup & Reviews","Governance & Risk Management","AML/CFT (POCAMLA) Support","LSK Trust-Account Compliance"]
  },
  sectorSuggestions:{
    Agribusiness:["Statutory Audit","Internal Audit","Tax Diagnostic Reviews","IFRS / IPSAS Financial Reporting","Internal Controls Setup & Reviews","Cash-flow Forecasting & Financial Modeling","Management Accounting"],
    "Financial Services":["Risk & Control Assurance","Internal Audit","IFRS / IPSAS Financial Reporting","Tax Compliance (VAT, PAYE, Income Tax)","Forensic Investigations","Business Planning & Strategic Planning","Governance & Risk Management"],
    Energy:["Cash-flow Forecasting & Financial Modeling","Feasibility Studies","Project Assurance","Tax Advisory & Strategy","Internal Controls Setup & Reviews","Risk & Control Assurance"],
    Healthcare:["Statutory Audit","Risk & Control Assurance","Donor & Grant Assurance","Tax Compliance (VAT, PAYE, Income Tax)","Management Accounting"],
    NGO:["Donor & Grant Assurance","Internal Controls Setup & Reviews","IFRS / IPSAS Financial Reporting","Tax Compliance (VAT, PAYE, Income Tax)","Business Planning & Strategic Planning","KRA Tax Exemption Applications (NGOs)"],
    "Public Sector":["Forensic Investigations","Project Assurance","IFRS / IPSAS Financial Reporting","Value-for-Money Audit","Tax Compliance (VAT, PAYE, Income Tax)","Governance & Risk Management"],
    "SME/Startup":["Bookkeeping & Outsourced Accounting","IFRS / IPSAS Financial Reporting","Payroll Management","Cash-flow Forecasting & Financial Modeling","Tax Compliance (VAT, PAYE, Income Tax)","Business Planning & Strategic Planning","Feasibility Studies"],
    Legal:["LSK Trust-Account Compliance","Tax Advisory & Strategy","AML/CFT (POCAMLA) Support","Forensic Investigations"],
    Education:["IFRS / IPSAS Financial Reporting","Internal Audit","Risk & Control Assurance","Tax Compliance (VAT, PAYE, Income Tax)","Payroll Management","Management Accounting"]
  },
  branchRouting:{Nairobi:"Nairobi Branch Manager",Bungoma:"Bungoma Branch Manager",Kisii:"Kisii Branch Manager",Other:"Practice Administration queue"}
};

const storageKey="pcl-crm-clients-v1";
let clients=loadClients();
function loadClients(){try{return JSON.parse(localStorage.getItem(storageKey))||[]}catch{return[]}}
function saveClients(){localStorage.setItem(storageKey,JSON.stringify(clients))}
function escapeHtml(value=""){return String(value).replace(/[&<>'"]/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character])}
function selectedServices(){return[...document.querySelectorAll('input[name="services"]:checked')].map(input=>input.value)}
function setOptions(id,items,placeholder="Select…"){document.getElementById(id).innerHTML=`<option value="">${placeholder}</option>${items.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`}
function renderStaticFields(){
  setOptions("primarySector",CRM.sectors,"Select sector…");setOptions("branchLocation",CRM.branches,"Select branch…");setOptions("clientCategory",CRM.clientCategories,"Select category…");setOptions("leadSource",CRM.leadSources,"Select lead source…");setOptions("decisionRole",CRM.decisionRoles,"Select role…");setOptions("billingFrequency",CRM.billingFrequencies,"Select frequency…");setOptions("pipelineStage",CRM.pipelineStages,"Select stage…");
  document.getElementById("regulatoryBodies").innerHTML=CRM.regulators.map(r=>`<label><input type="checkbox" name="regulator" value="${escapeHtml(r)}" />${escapeHtml(r)}</label>`).join("");
  document.getElementById("servicePicker").innerHTML=Object.entries(CRM.serviceGroups).map(([group,services])=>`<section class="service-group"><strong>${escapeHtml(group)}</strong><div class="service-options">${services.map(service=>`<label><input type="checkbox" name="services" value="${escapeHtml(service)}" />${escapeHtml(service)}</label>`).join("")}</div></section>`).join("");
  document.getElementById("serviceCatalog").innerHTML=Object.entries(CRM.serviceGroups).map(([group,services])=>`<section class="card catalog-section"><h3>${escapeHtml(group)}</h3><ul>${services.map(service=>`<li>${escapeHtml(service)}</li>`).join("")}</ul></section>`).join("");
  document.getElementById("sectorMatrix").innerHTML=Object.entries(CRM.sectorSuggestions).map(([sector,services])=>`<section class="card catalog-section"><h3>${escapeHtml(sector)}</h3><p class="hint">Recommended controlled service tags</p><ul>${services.map(service=>`<li>${escapeHtml(service)}</li>`).join("")}</ul></section>`).join("");
}
function showRecommendation(){
  const sector=document.getElementById("primarySector").value,target=document.getElementById("serviceRecommendation"),recommended=CRM.sectorSuggestions[sector];
  if(!recommended){target.innerHTML="Choose a Primary Sector to view its recommended standard service tags.";return}
  target.innerHTML=`<b>${escapeHtml(sector)} recommendation:</b> ${recommended.map(escapeHtml).join(", ")}. <button type="button" id="applyRecommendations">Apply these tags</button>`;
  document.getElementById("applyRecommendations").addEventListener("click",()=>{document.querySelectorAll('input[name="services"]').forEach(input=>input.checked=recommended.includes(input.value));showNotice(`Applied ${sector} recommended service tags. Review and amend them for this engagement before saving.`)})
}
function requiresIeQr(client){return client.pieStatus||["Financial Services","Public Sector"].includes(client.primarySector)}
function generateWorkflows(client){
  const tasks=[];
  if(requiresIeQr(client))tasks.push({id:"ieqr",title:"Assign Independent Engagement Quality Reviewer (CPA Kebeno Maonga Douglas)",owner:"CPA Alarcon",status:"Open",gate:true});
  tasks.push({id:"routing",title:`Route lead to ${CRM.branchRouting[client.branchLocation]}`,owner:CRM.branchRouting[client.branchLocation],status:"Open"});
  if(client.services.includes("Tax Compliance (VAT, PAYE, Income Tax)")){tasks.push({id:"paye",title:"Prepare PAYE return and payment reminder — due by 20th monthly",owner:"Tax team",status:"Recurring"});tasks.push({id:"vat",title:"Prepare VAT return and payment reminder — due by 20th monthly",owner:"Tax team",status:"Recurring"})}
  if(client.isSacco)tasks.push({id:"sasra",title:"Start SASRA annual reporting readiness — 60 days before applicable deadline",owner:"Financial Services team",status:"Recurring"});
  return tasks
}
function normaliseName(value){return value.toLowerCase().replace(/[^a-z0-9]/g,"")}
function findPotentialDuplicate(companyName,tradingName){const names=[normaliseName(companyName),normaliseName(tradingName)].filter(Boolean);return clients.find(client=>[client.companyName,client.tradingName].map(normaliseName).some(name=>name&&names.includes(name)))}
function buildClient(form){
  const data=new FormData(form),companyName=data.get("companyName").trim(),tradingName=data.get("tradingName").trim();
  const client={id:crypto.randomUUID(),createdAt:new Date().toISOString(),companyName,tradingName,primarySector:data.get("primarySector"),branchLocation:data.get("branchLocation"),regulators:data.getAll("regulator"),pieStatus:data.get("pieStatus")==="on",isSacco:data.get("isSacco")==="on",clientCategory:data.get("clientCategory"),leadSource:data.get("leadSource"),contact:{name:data.get("contactName").trim(),jobTitle:data.get("jobTitle").trim(),email:data.get("email").trim(),phone:data.get("phone").trim(),decisionRole:data.get("decisionRole")},services:selectedServices(),engagementValue:data.get("engagementValue")?Number(data.get("engagementValue")):null,billingFrequency:data.get("billingFrequency"),pipelineStage:data.get("pipelineStage"),engagementLetter:data.get("engagementLetter").trim(),notes:data.get("notes").trim(),reportSigned:false};
  client.tasks=generateWorkflows(client);return client
}
function showNotice(message){const notice=document.getElementById("notice");notice.textContent=message;notice.classList.add("show");clearTimeout(showNotice.timer);showNotice.timer=setTimeout(()=>notice.classList.remove("show"),6000)}
function updateMetrics(){document.getElementById("clientCount").textContent=clients.length;document.getElementById("pieCount").textContent=clients.filter(requiresIeQr).length;document.getElementById("taxCount").textContent=clients.filter(client=>client.services.includes("Tax Compliance (VAT, PAYE, Income Tax)")).length}
function renderClientList(){
  const list=document.getElementById("clientList");if(!clients.length){list.innerHTML='<div class="empty">No client records yet. Complete the onboarding form to create the first record.</div>';updateMetrics();return}
  list.innerHTML=clients.slice().reverse().map(client=>{
    const ieqr=client.tasks.find(task=>task.id==="ieqr"),servicePills=client.services.map(service=>`<span class="pill">${escapeHtml(service)}</span>`).join(""),statusPill=ieqr?`<span class="pill ${ieqr.status==="Complete"?"":"critical"}">IEQR: ${escapeHtml(ieqr.status)}</span>`:"",auditAction=client.services.includes("Statutory Audit")?`<button data-action="sign-report" data-id="${client.id}">Mark audit report signed</button>`:"";
    return `<article class="client-item"><div class="client-topline"><div><h3>${escapeHtml(client.companyName)}</h3><div class="client-meta">${escapeHtml(client.primarySector)} · ${escapeHtml(client.branchLocation)} · ${escapeHtml(client.pipelineStage||"No pipeline stage")}</div></div><div class="client-meta">${client.engagementValue?`KES ${client.engagementValue.toLocaleString()}`:"Fee not recorded"}</div></div><div>${statusPill}${client.isSacco?'<span class="pill warning">SASRA annual reminder</span>':""}${client.regulators.map(item=>`<span class="pill">${escapeHtml(item)}</span>`).join("")}</div><div>${servicePills||'<span class="client-meta">No service tag selected</span>'}</div><div class="client-actions">${ieqr&&ieqr.status!=="Complete"?`<button data-action="complete-ieqr" data-id="${client.id}">Complete IEQR assignment</button>`:""}${auditAction}<button data-action="view-tasks" data-id="${client.id}">View workflow tasks</button><button data-action="remove-client" data-id="${client.id}">Remove record</button></div></article>`
  }).join("");updateMetrics()
}
function clientById(id){return clients.find(client=>client.id===id)}
function displayTasks(client){alert(`${client.companyName} workflow tasks\n\n${client.tasks.map(task=>`• ${task.title} — ${task.owner} (${task.status})`).join("\n")||"No workflow tasks created."}`)}
function listenForClientActions(){document.getElementById("clientList").addEventListener("click",event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;const client=clientById(button.dataset.id);if(!client)return;
  if(button.dataset.action==="complete-ieqr"){client.tasks.find(task=>task.id==="ieqr").status="Complete";saveClients();renderClientList();showNotice(`IEQR assignment marked complete for ${client.companyName}.`)}
  if(button.dataset.action==="sign-report"){const ieqr=client.tasks.find(task=>task.id==="ieqr");if(ieqr&&ieqr.status!=="Complete"){alert("Audit Report Signed is blocked until the Independent Engagement Quality Reviewer assignment is complete.");return}client.reportSigned=true;if(!client.tasks.some(task=>task.id==="cross-sell"))client.tasks.push({id:"cross-sell",title:`On day 30 after audit completion, pitch Tax Diagnostic Reviews or Cash-flow Forecasting & Financial Modeling to ${client.companyName}`,owner:"Account Manager",status:"Scheduled"});saveClients();renderClientList();showNotice(`Audit report marked signed for ${client.companyName}; the day-30 cross-selling task has been scheduled.`)}
  if(button.dataset.action==="view-tasks")displayTasks(client);
  if(button.dataset.action==="remove-client"){if(!confirm(`Remove ${client.companyName} from this browser's CRM records?`))return;clients=clients.filter(item=>item.id!==client.id);saveClients();renderClientList();showNotice("Client record removed.")}
})}
function initialiseTabs(){document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(button=>button.classList.toggle("active",button===tab));document.querySelectorAll(".tab-panel").forEach(panel=>panel.classList.toggle("active",panel.id===tab.dataset.tab))}))}
function initialiseForm(){
  const form=document.getElementById("client-form");document.getElementById("primarySector").addEventListener("change",showRecommendation);document.getElementById("resetForm").addEventListener("click",()=>setTimeout(showRecommendation));
  form.addEventListener("submit",event=>{event.preventDefault();if(!form.reportValidity())return;const client=buildClient(form),duplicate=findPotentialDuplicate(client.companyName,client.tradingName);if(duplicate&&!confirm(`Potential duplicate: ${duplicate.companyName}. Save this record anyway?`))return;clients.push(client);saveClients();renderClientList();form.reset();showRecommendation();showNotice(`${client.companyName} saved. ${client.tasks.length} workflow task${client.tasks.length===1?"":"s"} created.`)});
  document.getElementById("clearClients").addEventListener("click",()=>{if(!clients.length||!confirm("Clear every client record stored in this browser?"))return;clients=[];saveClients();renderClientList();showNotice("All local client records have been cleared.")})
}
renderStaticFields();initialiseTabs();initialiseForm();listenForClientActions();showRecommendation();renderClientList();
