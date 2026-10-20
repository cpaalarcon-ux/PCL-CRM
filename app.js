const CRM={
  sectors:["Agribusiness","Financial Services","Energy","Healthcare","NGO","Public Sector","SME/Startup","Legal","Education"],
  branches:["Nairobi","Bungoma","Kisii","Other"],
  regulators:["CBK","SASRA","KRA","LSK","IRA","CMA","Donor/Funder","None"],
  clientCategories:["Corporate","Non-Profit","Public Entity","Individual"],
  leadSources:["Referral","Website","Networking","Existing Client (Cross-sell)","Tender"],
  decisionRoles:["Decision Maker","Influencer","Billing Contact","Day-to-Day Contact"],
  billingFrequencies:["One-off","Monthly Retainer","Quarterly","Annually"],
  pipelineStages:["Lead","Contacted","Proposal Sent","Negotiation","Client Won","Client Lost"],
  taxRegistrations:["VAT","PAYE","Withholding Tax (WHT)","Corporation Tax","NSSF","SHIF","AHL","NITA"],
  etimsStatuses:["Registered and active","Registered — review required","Not registered","Not applicable"],
  finalStockStatuses:["Not applicable","Expected margin only","Stock count pending","Final costing in progress","Final stock costed"],
  instalmentMethods:["Not applicable","Current-year estimate","110% prior-year tax","Agriculture method"],
  taxWorkPacks:[
    {id:"vat",label:"VAT and eTIMS control"},
    {id:"payroll",label:"PAYE and statutory payroll"},
    {id:"wht",label:"Professional services and WHT"},
    {id:"credits",label:"Tax credits and adjustments"},
    {id:"incomeTax",label:"Monthly TB and income-tax review"},
    {id:"ppe",label:"PPE and capital allowances"},
    {id:"stock",label:"Stock and gross-profit review"},
    {id:"instalment",label:"Instalment tax"},
    {id:"report",label:"Client tax report and period close"}
  ],
  accessRoles:[
    {level:"Level 1",position:"Engagement Partner",visibility:"Global visibility across all branches, clients, deals, tasks and financial figures.",scope:"All records"},
    {level:"Level 2",position:"Manager",visibility:"Own records plus records held by Supervisors, Assistants and Interns in the manager's assigned teams.",scope:"Assigned teams"},
    {level:"Level 3",position:"Audit Supervisor",visibility:"Assigned clients plus fieldwork records and daily tasks of assigned Assistants and Interns.",scope:"Assigned fieldwork team"},
    {level:"Level 4",position:"Audit Assistant",visibility:"Assigned client records and assigned fieldwork only.",scope:"Assigned clients only"},
    {level:"Level 5",position:"Intern",visibility:"Only individual tasks explicitly assigned by an Audit Supervisor.",scope:"Assigned tasks only"}
  ],
  permissionProfiles:[
    {position:"Engagement Partner",profile:"Full System Administrator",rights:"Create, edit and delete all records, view all engagement fees, complete EQR and move a PIE engagement to Client Won / Audit Signed.",restrictions:"None within the CRM governance model."},
    {position:"Manager",profile:"Standard Manager",rights:"Create and edit clients and deals, view and edit engagement fees, approve timesheets and review notes.",restrictions:"Cannot delete client profiles, change global settings or override final audit sign-off."},
    {position:"Audit Supervisor",profile:"Fieldwork Manager",rights:"Create and edit assigned tasks, add notes, upload workpapers and move assigned engagements through fieldwork stages.",restrictions:"Engagement Fee is hidden. Cannot delete records or complete final sign-off."},
    {position:"Audit Assistant",profile:"Standard User (Restricted)",rights:"Read assigned client details, update assigned task status, upload requested documents and add working-paper notes.",restrictions:"Client profiles and deals are read-only. Cannot export, view fees, access other teams or delete records."},
    {position:"Intern",profile:"Limited User",rights:"Read and update only the tasks explicitly assigned to the intern and read documents attached to those tasks.",restrictions:"Cannot access client contacts, financial data, client lists, exports or unassigned records."}
  ],
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
function selectedTaxWorkPacks(){return[...document.querySelectorAll('input[name="taxWorkPack"]:checked')].map(input=>input.value)}
function hasTaxCompliance(){return selectedServices().includes("Tax Compliance (VAT, PAYE, Income Tax)")}
function numberOrNull(value){return value===""?null:Number(value)}
function setOptions(id,items,placeholder="Select…"){document.getElementById(id).innerHTML=`<option value="">${placeholder}</option>${items.map(item=>`<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`}
function renderStaticFields(){
  setOptions("primarySector",CRM.sectors,"Select sector…");setOptions("branchLocation",CRM.branches,"Select branch…");setOptions("clientCategory",CRM.clientCategories,"Select category…");setOptions("leadSource",CRM.leadSources,"Select lead source…");setOptions("decisionRole",CRM.decisionRoles,"Select role…");setOptions("billingFrequency",CRM.billingFrequencies,"Select frequency…");setOptions("pipelineStage",CRM.pipelineStages,"Select stage…");setOptions("etimsStatus",CRM.etimsStatuses,"Select status…");setOptions("finalStockStatus",CRM.finalStockStatuses,"Select status…");setOptions("instalmentMethod",CRM.instalmentMethods,"Select method…");
  document.getElementById("regulatoryBodies").innerHTML=CRM.regulators.map(r=>`<label><input type="checkbox" name="regulator" value="${escapeHtml(r)}" />${escapeHtml(r)}</label>`).join("");
  document.getElementById("taxRegistrations").innerHTML=CRM.taxRegistrations.map(registration=>`<label><input type="checkbox" name="taxRegistration" value="${escapeHtml(registration)}" />${escapeHtml(registration)}</label>`).join("");
  document.getElementById("taxWorkPacks").innerHTML=CRM.taxWorkPacks.map(workPack=>`<label><input type="checkbox" name="taxWorkPack" value="${escapeHtml(workPack.id)}" />${escapeHtml(workPack.label)}</label>`).join("");
  document.getElementById("servicePicker").innerHTML=Object.entries(CRM.serviceGroups).map(([group,services])=>`<section class="service-group"><strong>${escapeHtml(group)}</strong><div class="service-options">${services.map(service=>`<label><input type="checkbox" name="services" value="${escapeHtml(service)}" />${escapeHtml(service)}</label>`).join("")}</div></section>`).join("");
  document.getElementById("serviceCatalog").innerHTML=Object.entries(CRM.serviceGroups).map(([group,services])=>`<section class="card catalog-section"><h3>${escapeHtml(group)}</h3><ul>${services.map(service=>`<li>${escapeHtml(service)}</li>`).join("")}</ul></section>`).join("");
  document.getElementById("sectorMatrix").innerHTML=Object.entries(CRM.sectorSuggestions).map(([sector,services])=>`<section class="card catalog-section"><h3>${escapeHtml(sector)}</h3><p class="hint">Recommended controlled service tags</p><ul>${services.map(service=>`<li>${escapeHtml(service)}</li>`).join("")}</ul></section>`).join("");
}
function renderAccessControl(){
  const hierarchyRows=CRM.accessRoles.map(role=>`<tr><td>${escapeHtml(role.level)}</td><td><b>${escapeHtml(role.position)}</b></td><td>${escapeHtml(role.visibility)}</td><td>${escapeHtml(role.scope)}</td></tr>`).join("");
  const profileRows=CRM.permissionProfiles.map(profile=>`<tr><td><b>${escapeHtml(profile.position)}</b><br><span class="hint">${escapeHtml(profile.profile)}</span></td><td>${escapeHtml(profile.rights)}</td><td>${escapeHtml(profile.restrictions)}</td></tr>`).join("");
  document.getElementById("accessControl").innerHTML=`<div class="section"><div class="section-heading"><h3>Role hierarchy and data visibility</h3><span class="hint">Higher positions inherit visibility of their assigned lower teams</span></div><table class="access-table"><thead><tr><th>Level</th><th>Position</th><th>Visibility</th><th>Record scope</th></tr></thead><tbody>${hierarchyRows}</tbody></table></div><div class="section"><div class="section-heading"><h3>Permission profiles</h3><span class="hint">Assign these profiles to authenticated users by position</span></div><table class="access-table"><thead><tr><th>Position / profile</th><th>Permitted actions</th><th>Restrictions</th></tr></thead><tbody>${profileRows}</tbody></table></div><div class="section"><div class="section-heading"><h3>Protected fields and actions</h3><span class="hint">Apply these rules in the server-side permission layer</span></div><table class="access-table"><thead><tr><th>Control</th><th>Engagement Partner</th><th>Manager</th><th>Audit Supervisor</th><th>Audit Assistant</th><th>Intern</th></tr></thead><tbody><tr><td>Engagement Fee</td><td>Read / write</td><td>Read / write</td><td>Hidden</td><td>Hidden</td><td>Hidden</td></tr><tr><td>EQR Completed</td><td>Read / write</td><td>Read-only</td><td>Read-only</td><td>Read-only</td><td>Hidden</td></tr><tr><td>PIE Client Won / Audit Signed</td><td>May move after EQR</td><td>Read-only</td><td>Read-only</td><td>Read-only</td><td>Hidden</td></tr><tr><td>Export client data</td><td>Allowed</td><td>Allowed for assigned teams</td><td>Not allowed</td><td>Not allowed</td><td>Not allowed</td></tr><tr><td>Delete client record</td><td>Allowed</td><td>Not allowed</td><td>Not allowed</td><td>Not allowed</td><td>Not allowed</td></tr></tbody></table></div>`;
}
function showTaxComplianceProfile(){document.getElementById("taxComplianceProfile").hidden=!hasTaxCompliance()}
function showRecommendation(){
  const sector=document.getElementById("primarySector").value,target=document.getElementById("serviceRecommendation"),recommended=CRM.sectorSuggestions[sector];
  if(!recommended){target.innerHTML="Choose a Primary Sector to view its recommended standard service tags.";return}
  target.innerHTML=`<b>${escapeHtml(sector)} recommendation:</b> ${recommended.map(escapeHtml).join(", ")}. <button type="button" id="applyRecommendations">Apply these tags</button>`;
  document.getElementById("applyRecommendations").addEventListener("click",()=>{document.querySelectorAll('input[name="services"]').forEach(input=>input.checked=recommended.includes(input.value));showTaxComplianceProfile();showNotice(`Applied ${sector} recommended service tags. Review and amend them for this engagement before saving.`)})
}
function requiresIeQr(client){return client.pieStatus||["Financial Services","Public Sector"].includes(client.primarySector)}
function addTaxTask(tasks,client,id,title,owner="Tax team",control={}){tasks.push({id:`tax-${id}`,title,owner,status:"Not started",category:"Tax Compliance",taxPeriod:client.taxProfile.reportingMonth||"Not set",evidenceLocation:"",itaxStatus:control.itaxStatus||"Not applicable",reviewerApproval:control.reviewerApproval||"Not required",postingStatus:control.postingStatus||"Not applicable",control})}
function generateWorkflows(client){
  const tasks=[];
  if(requiresIeQr(client))tasks.push({id:"ieqr",title:"Assign Independent Engagement Quality Reviewer",owner:"Engagement Partner",status:"Pending Engagement Partner",gate:true});
  tasks.push({id:"routing",title:`Route lead to ${CRM.branchRouting[client.branchLocation]}`,owner:CRM.branchRouting[client.branchLocation],status:"Open"});
  if(client.taxProfile){
    const packs=client.taxProfile.workPacks;
    addTaxTask(tasks,client,"setup","Confirm KRA PIN, registrations, financial year, reporting month, tax rate and opening balances", "Tax Manager",{reviewerApproval:"Pending"});
    if(packs.includes("vat")){
      addTaxTask(tasks,client,"vat-source","Collect eTIMS sales, Z reports, bank statements, sales evidence and purchase data");
      addTaxTask(tasks,client,"vat-sales-banking","Reconcile eTIMS sales, Z reports, bank deposits and documented non-sales receipts");
      addTaxTask(tasks,client,"vat-purchases","Classify eTIMS purchases at 16%, 8%, zero-rated or exempt and route each item to COGS, expenditure or PPE");
      addTaxTask(tasks,client,"vat-return","Prepare output VAT, input VAT, opening-credit and adjustment control", "Tax Associate",{reviewerApproval:"Pending"});
      addTaxTask(tasks,client,"vat-file","Obtain review, file VAT return and retain acknowledgement, PRN and payment evidence", "Tax Manager",{itaxStatus:"Pending verification",reviewerApproval:"Pending"});
    }
    if(packs.includes("payroll")){
      addTaxTask(tasks,client,"payroll-input","Collect payroll register, casual-wage records and statutory payment evidence");
      addTaxTask(tasks,client,"payroll-reconcile","Reconcile payroll and GL to PAYE, NSSF, SHIF, AHL and NITA statutory totals");
      addTaxTask(tasks,client,"payroll-file","Prepare, review and file PAYE and applicable statutory returns, then retain payment evidence", "Tax Manager",{itaxStatus:"Pending verification",reviewerApproval:"Pending"});
    }
    if(packs.includes("wht")){
      addTaxTask(tasks,client,"wht-review","Review professional-service payments, resident status, WHT code, rate and supporting evidence");
      addTaxTask(tasks,client,"wht-file","Prepare WHT return and payment, then retain certificates and iTax evidence", "Tax Manager",{itaxStatus:"Pending verification",reviewerApproval:"Pending"});
    }
    if(packs.includes("credits")){
      addTaxTask(tasks,client,"credit-register","Enter VAT adjustments, WHT credits, instalment payments and balance payments in the Tax Credit Register", "Tax Associate",{itaxStatus:"Pending verification",reviewerApproval:"Pending",postingStatus:"Blocked"});
      addTaxTask(tasks,client,"credit-post","Post a tax credit or prepayment only after iTax verification and reviewer approval", "Tax Manager",{itaxStatus:"Required",reviewerApproval:"Required",postingStatus:"Blocked pending approval"});
    }
    if(packs.includes("incomeTax")){
      addTaxTask(tasks,client,"tb-map","Map GL/TB balances to tax treatment and investigate unsupported, non-deductible or exceptional expenditure");
      addTaxTask(tasks,client,"income-tax","Prepare provisional taxable-profit and income-tax estimate after the supported tax adjustments", "Tax Manager",{reviewerApproval:"Pending"});
    }
    if(packs.includes("ppe"))addTaxTask(tasks,client,"ppe","Confirm asset class, first use, business use, tax WDV and capital-allowance support", "Tax Associate",{reviewerApproval:"Pending"});
    if(packs.includes("stock"))addTaxTask(tasks,client,"stock","Review gross margin and closing stock, then obtain final stock count and costing before finalising income tax", "Client / Tax Associate",{reviewerApproval:"Pending"});
    if(packs.includes("instalment"))["Month 4","Month 6","Month 9","Month 12"].forEach(month=>addTaxTask(tasks,client,`instalment-${month.replace(" ","").toLowerCase()}`,`${month}: calculate instalment tax, obtain approval, confirm payment and record it as a tax prepayment`, "Tax Manager",{itaxStatus:"Pending verification",reviewerApproval:"Pending",postingStatus:"Blocked pending approval"}));
    if(packs.includes("report")){
      addTaxTask(tasks,client,"findings","Review open tax findings, exceptions and TB control before reporting", "Tax Manager",{reviewerApproval:"Pending"});
      addTaxTask(tasks,client,"report","Approve and issue the client tax report with the next-period action list", "Tax Manager",{reviewerApproval:"Pending"});
    }
  }
  if(client.isSacco)tasks.push({id:"sasra",title:"Start SASRA annual reporting readiness — 60 days before applicable deadline",owner:"Financial Services team",status:"Recurring"});
  return tasks
}
function normaliseName(value){return value.toLowerCase().replace(/[^a-z0-9]/g,"")}
function findPotentialDuplicate(companyName,tradingName){const names=[normaliseName(companyName),normaliseName(tradingName)].filter(Boolean);return clients.find(client=>[client.companyName,client.tradingName].map(normaliseName).some(name=>name&&names.includes(name)))}
function buildClient(form){
  const data=new FormData(form),companyName=data.get("companyName").trim(),tradingName=data.get("tradingName").trim();
  const services=selectedServices();
  const taxProfile=services.includes("Tax Compliance (VAT, PAYE, Income Tax)")?{registrations:data.getAll("taxRegistration"),etimsStatus:data.get("etimsStatus"),reportingMonth:data.get("taxReportingMonth"),financialYearStart:data.get("taxYearStart"),financialYearEnd:data.get("taxYearEnd"),corporationTaxRate:numberOrNull(data.get("corporationTaxRate")),openingVatCredit:numberOrNull(data.get("openingVatCredit")),openingStock:numberOrNull(data.get("openingStock")),finalStockStatus:data.get("finalStockStatus"),instalmentMethod:data.get("instalmentMethod"),priorYearTax:numberOrNull(data.get("priorYearTax")),currentYearTaxForecast:numberOrNull(data.get("currentYearTaxForecast")),expectedWhtCredits:numberOrNull(data.get("expectedWhtCredits")),workingPaper:data.get("taxWorkingPaper").trim(),workPacks:selectedTaxWorkPacks()}:null;
  const client={id:crypto.randomUUID(),createdAt:new Date().toISOString(),companyName,tradingName,primarySector:data.get("primarySector"),branchLocation:data.get("branchLocation"),regulators:data.getAll("regulator"),pieStatus:data.get("pieStatus")==="on",isSacco:data.get("isSacco")==="on",clientCategory:data.get("clientCategory"),leadSource:data.get("leadSource"),contact:{name:data.get("contactName").trim(),jobTitle:data.get("jobTitle").trim(),email:data.get("email").trim(),phone:data.get("phone").trim(),decisionRole:data.get("decisionRole")},services,engagementValue:data.get("engagementValue")?Number(data.get("engagementValue")):null,billingFrequency:data.get("billingFrequency"),pipelineStage:data.get("pipelineStage"),engagementLetter:data.get("engagementLetter").trim(),notes:data.get("notes").trim(),taxProfile,eqrCompleted:false,reportSigned:false};
  client.tasks=generateWorkflows(client);return client
}
function showNotice(message){const notice=document.getElementById("notice");notice.textContent=message;notice.classList.add("show");clearTimeout(showNotice.timer);showNotice.timer=setTimeout(()=>notice.classList.remove("show"),6000)}
function updateMetrics(){document.getElementById("clientCount").textContent=clients.length;document.getElementById("pieCount").textContent=clients.filter(requiresIeQr).length;document.getElementById("taxCount").textContent=clients.filter(client=>client.services.includes("Tax Compliance (VAT, PAYE, Income Tax)")).length}
function renderClientList(){
  const list=document.getElementById("clientList");if(!clients.length){list.innerHTML='<div class="empty">No client records yet. Complete the onboarding form to create the first record.</div>';updateMetrics();return}
  list.innerHTML=clients.slice().reverse().map(client=>{
    const ieqr=client.tasks.find(task=>task.id==="ieqr"),taxTaskCount=client.tasks.filter(task=>task.category==="Tax Compliance").length,servicePills=client.services.map(service=>`<span class="pill">${escapeHtml(service)}</span>`).join(""),statusPill=ieqr?`<span class="pill ${client.eqrCompleted?"":"critical"}">EQR: ${client.eqrCompleted?"Completed":"Pending Engagement Partner"}</span>`:"",auditAction=client.services.includes("Statutory Audit")?`<button data-action="sign-report" data-id="${client.id}">Mark audit report signed</button>`:"",taxPill=taxTaskCount?`<span class="pill warning">Tax tasks: ${taxTaskCount}</span>`:"";
    return `<article class="client-item"><div class="client-topline"><div><h3>${escapeHtml(client.companyName)}</h3><div class="client-meta">${escapeHtml(client.primarySector)} · ${escapeHtml(client.branchLocation)} · ${escapeHtml(client.pipelineStage||"No pipeline stage")}</div></div><div class="client-meta">${client.engagementValue?`KES ${client.engagementValue.toLocaleString()}`:"Fee not recorded"}</div></div><div>${statusPill}${taxPill}${client.isSacco?'<span class="pill warning">SASRA annual reminder</span>':""}${client.regulators.map(item=>`<span class="pill">${escapeHtml(item)}</span>`).join("")}</div><div>${servicePills||'<span class="client-meta">No service tag selected</span>'}</div><div class="client-actions">${ieqr&&!client.eqrCompleted?`<button type="button" disabled title="Only an authenticated Engagement Partner may complete EQR">EQR completion: Engagement Partner only</button>`:""}${auditAction}<button data-action="view-tasks" data-id="${client.id}">View workflow tasks</button><button data-action="remove-client" data-id="${client.id}">Remove record</button></div></article>`
  }).join("");updateMetrics()
}
function clientById(id){return clients.find(client=>client.id===id)}
function displayTasks(client){const taxSummary=client.taxProfile?`Tax setup: ${client.taxProfile.registrations.join(", ")||"Registrations not selected"}; report month: ${client.taxProfile.reportingMonth||"Not set"}; work packs: ${client.taxProfile.workPacks.map(id=>CRM.taxWorkPacks.find(pack=>pack.id===id)?.label||id).join(", ")}\n\n`:"";alert(`${client.companyName} workflow tasks\n\n${taxSummary}${client.tasks.map(task=>`• ${task.title} — ${task.owner} (${task.status})${task.category==="Tax Compliance"?` [Period: ${task.taxPeriod}; iTax: ${task.itaxStatus}; Review: ${task.reviewerApproval}; Posting: ${task.postingStatus}]`:""}`).join("\n")||"No workflow tasks created."}`)}
function listenForClientActions(){document.getElementById("clientList").addEventListener("click",event=>{
  const button=event.target.closest("button[data-action]");if(!button)return;const client=clientById(button.dataset.id);if(!client)return;
  if(button.dataset.action==="sign-report"){if(!client.eqrCompleted&&client.tasks.some(task=>task.id==="ieqr")){alert("Audit Report Signed is blocked until an authenticated Engagement Partner records EQR Completed.");return}client.reportSigned=true;if(!client.tasks.some(task=>task.id==="cross-sell"))client.tasks.push({id:"cross-sell",title:`On day 30 after audit completion, pitch Tax Diagnostic Reviews or Cash-flow Forecasting & Financial Modeling to ${client.companyName}`,owner:"Account Manager",status:"Scheduled"});saveClients();renderClientList();showNotice(`Audit report marked signed for ${client.companyName}; the day-30 cross-selling task has been scheduled.`)}
  if(button.dataset.action==="view-tasks")displayTasks(client);
  if(button.dataset.action==="remove-client"){if(!confirm(`Remove ${client.companyName} from this browser's CRM records?`))return;clients=clients.filter(item=>item.id!==client.id);saveClients();renderClientList();showNotice("Client record removed.")}
})}
function initialiseTabs(){document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(button=>button.classList.toggle("active",button===tab));document.querySelectorAll(".tab-panel").forEach(panel=>panel.classList.toggle("active",panel.id===tab.dataset.tab))}))}
function initialiseForm(){
  const form=document.getElementById("client-form");document.getElementById("primarySector").addEventListener("change",showRecommendation);document.getElementById("servicePicker").addEventListener("change",showTaxComplianceProfile);document.getElementById("resetForm").addEventListener("click",()=>setTimeout(()=>{showRecommendation();showTaxComplianceProfile()}));
  form.addEventListener("submit",event=>{event.preventDefault();if(!form.reportValidity())return;if(hasTaxCompliance()&&!selectedTaxWorkPacks().length){alert("Select at least one Tax Compliance Work Pack so the CRM creates the correct tasks.");return}const client=buildClient(form),duplicate=findPotentialDuplicate(client.companyName,client.tradingName);if(duplicate&&!confirm(`Potential duplicate: ${duplicate.companyName}. Save this record anyway?`))return;clients.push(client);saveClients();renderClientList();form.reset();showRecommendation();showTaxComplianceProfile();showNotice(`${client.companyName} saved. ${client.tasks.length} workflow task${client.tasks.length===1?"":"s"} created.`)});
  document.getElementById("clearClients").addEventListener("click",()=>{if(!clients.length||!confirm("Clear every client record stored in this browser?"))return;clients=[];saveClients();renderClientList();showNotice("All local client records have been cleared.")})
}
renderStaticFields();renderAccessControl();initialiseTabs();initialiseForm();listenForClientActions();showRecommendation();showTaxComplianceProfile();renderClientList();
