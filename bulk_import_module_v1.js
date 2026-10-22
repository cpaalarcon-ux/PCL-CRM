/*
  Browser-local bulk data importer for the public ERP preview.
  Excel files are parsed only in the administrator's browser. This module does
  not upload the workbook and does not publish any roster or client data.
*/
(function () {
  "use strict";

  const KEYS = {
    staff: "pcl-staff-directory-preview-v2",
    clients: "pcl-crm-clients-v1",
    links: "pcl-crm-client-staff-links-v1",
    firms: "pcl-crm-firms-v1"
  };
  const SHEETJS_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  const categories = ["Engagement Partner", "Manager", "Audit Supervisor", "Audit Assistant", "Intern"];
  const sectors = ["Agribusiness", "Financial Services", "Energy", "Healthcare", "NGO", "Public Sector", "SME/Startup", "Legal", "Education"];
  const branches = ["Nairobi", "Bungoma", "Kisii", "Other"];
  const fieldSets = {
    staff: [
      { key: "staffId", label: "Staff ID", required: true, aliases: ["staffid", "employeeid", "staffnumber", "staffno"] },
      { key: "fullName", label: "Staff Name", required: true, aliases: ["staffname", "fullname", "name", "employeename"] },
      { key: "position", label: "Staff Category", required: true, aliases: ["position", "role", "staffcategory", "jobtitle"] },
      { key: "standardCostRate", label: "Standard Cost Rate (KES/hr)", aliases: ["standardcostratekesshr", "standardcostrate", "costrate"] },
      { key: "billableRate", label: "Billable Rate (KES/hr)", aliases: ["billableratekesshr", "billablerate", "chargeoutrate"] },
      { key: "effectiveDate", label: "Effective Date", aliases: ["effectivedate", "startdate"] },
      { key: "endDate", label: "End Date / Contract End", aliases: ["enddate", "contractenddate", "expirydate"] },
      { key: "employmentType", label: "Employment Type", aliases: ["employmenttype", "employmentstatus"] },
      { key: "billingStatus", label: "Billing Status", aliases: ["billingstatus", "billability"] },
      { key: "firmScope", label: "Firm Scope", aliases: ["firmscope", "firm", "firmcode", "company"] }
    ],
    clients: [
      { key: "clientReference", label: "Client ID / Reference", aliases: ["clientid", "clientreference", "customernumber", "accountnumber"] },
      { key: "companyName", label: "Company Name", required: true, aliases: ["companyname", "legalname", "clientname", "customername"] },
      { key: "tradingName", label: "Trading Name", aliases: ["tradingname", "businessname"] },
      { key: "firm", label: "Handling Firm / Firm Code", aliases: ["handlingfirm", "firm", "firmcode", "companycode"] },
      { key: "primarySector", label: "Primary Sector", required: true, aliases: ["primarysector", "sector", "industry"] },
      { key: "branchLocation", label: "Branch Location", required: true, aliases: ["branchlocation", "branch", "office"] },
      { key: "regulators", label: "Regulatory Body", aliases: ["regulatorybody", "regulators", "regulator"] },
      { key: "pieStatus", label: "PIE Status", aliases: ["piestatus", "pie", "publicinterestentity"] },
      { key: "clientCategory", label: "Client Category", aliases: ["clientcategory", "category", "entitytype"] },
      { key: "leadSource", label: "Lead Source", aliases: ["leadsource", "source"] },
      { key: "contactName", label: "Contact Full Name", aliases: ["contactfullname", "contactname", "fullname"] },
      { key: "jobTitle", label: "Contact Job Title", aliases: ["contactjobtitle", "jobtitle", "title"] },
      { key: "email", label: "Contact Email", aliases: ["email", "emailaddress", "contactemail"] },
      { key: "phone", label: "Contact Phone", aliases: ["phone", "phonenumber", "contactphone", "mobile"] },
      { key: "decisionRole", label: "Contact Decision Role", aliases: ["roleindecision", "decisionrole", "contactrole"] },
      { key: "services", label: "Services Requested", aliases: ["servicesrequested", "services", "service"] },
      { key: "engagementValue", label: "Engagement Value (KES)", aliases: ["engagementvaluekes", "engagementvalue", "fee", "value"] },
      { key: "billingFrequency", label: "Billing Frequency", aliases: ["billingfrequency", "frequency"] },
      { key: "pipelineStage", label: "Pipeline Stage", aliases: ["pipelinestage", "stage", "status"] },
      { key: "incorporationDate", label: "Incorporation Date", aliases: ["incorporationdate", "registrationdate"] },
      { key: "smeAuditExempt", label: "SME Audit Exempt", aliases: ["smeauditexempt", "auditexempt"] }
    ],
    links: [
      { key: "staffId", label: "Staff ID", required: true, aliases: ["staffid", "employeeid", "staffnumber"] },
      { key: "clientReference", label: "Client ID / Company Name", required: true, aliases: ["clientid", "clientreference", "companyname", "clientname"] },
      { key: "roleOnClient", label: "Role on Client", aliases: ["roleonclient", "roleonjob", "assignmentrole", "role"] },
      { key: "firm", label: "Handling Firm / Firm Code", aliases: ["handlingfirm", "firm", "firmcode"] },
      { key: "plannedStartDate", label: "Planned Start Date", aliases: ["plannedstartdate", "startdate"] },
      { key: "plannedEndDate", label: "Planned End Date", aliases: ["plannedenddate", "enddate"] },
      { key: "allocation", label: "Allocation %", aliases: ["allocation", "allocationpercentage", "allocationpercent"] }
    ]
  };
  const state = { workbook: null, sheetName: "", headers: [], rows: [], type: "staff", mapping: {}, prepared: null };
  const clean = value => String(value ?? "").trim();
  const safe = value => clean(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  const normalise = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  const parseJson = key => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (_) { return []; } };
  const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const splitValues = value => clean(value).split(/[;,|]/).map(item => item.trim()).filter(Boolean);
  const bool = value => ["yes", "true", "1", "y", "checked"].includes(normalise(value));
  const numberOrNull = value => { const raw = clean(value).replace(/,/g, ""); if (!raw) return null; const number = Number(raw); return Number.isFinite(number) ? number : null; };
  const dateIso = value => {
    const raw = clean(value); if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const date = new Date(raw); return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  };
  const defaultFirms = [
    { id: "firm-1", firmCode: "ACPA", legalName: "ALARCON CERTIFIED PUBLIC ACCOUNTANTS" },
    { id: "firm-2", firmCode: "ACL", legalName: "ALARCON CONSULTANTS LTD" },
    { id: "firm-3", firmCode: "PCL", legalName: "PHAM CONSULTING LTD" }
  ];
  const firms = () => { const saved = parseJson(KEYS.firms); return saved.length ? saved : defaultFirms; };
  const firmFor = (value, fallback) => {
    const key = normalise(value); const selected = firms().find(firm => [firm.id, firm.firmCode, firm.legalName].some(option => normalise(option) === key));
    return selected?.id || fallback || "";
  };
  const categoryFor = value => {
    const key = normalise(value);
    const aliases = { partner: "Engagement Partner", engagementpartner: "Engagement Partner", manager: "Manager", auditmanager: "Manager", supervisor: "Audit Supervisor", auditsupervisor: "Audit Supervisor", assistant: "Audit Assistant", auditassistant: "Audit Assistant", intern: "Intern", trainee: "Intern" };
    return categories.find(item => normalise(item) === key) || aliases[key] || "";
  };
  const sectorFor = value => {
    const key = normalise(value);
    const aliases = { agribusinessfarming: "Agribusiness", agriculture: "Agribusiness", financialservicessector: "Financial Services", banking: "Financial Services", energyandnaturalresources: "Energy", notforprofit: "NGO", nonprofit: "NGO", ngos: "NGO", publicsectorandinfrastructure: "Public Sector", sme: "SME/Startup", smes: "SME/Startup", startup: "SME/Startup", legalfinancecompliance: "Legal", privateeducationinstitutions: "Education" };
    return sectors.find(item => normalise(item) === key) || aliases[key] || "";
  };
  const branchFor = value => branches.find(item => normalise(item) === normalise(value)) || "";
  const currentMapping = key => Number.isInteger(state.mapping[key]) && state.mapping[key] >= 0 ? state.mapping[key] : -1;
  const cell = (row, key) => { const index = currentMapping(key); return index >= 0 ? row[index] : ""; };
  const selectedStaff = () => parseJson(KEYS.staff);
  const selectedClients = () => parseJson(KEYS.clients);
  const selectedLinks = () => parseJson(KEYS.links);

  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (window.__pclXlsxLoading) return window.__pclXlsxLoading;
    window.__pclXlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = SHEETJS_URL; script.async = true;
      script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error("Excel reader did not initialise."));
      script.onerror = () => reject(new Error("Excel reader could not be loaded.")); document.head.append(script);
    });
    return window.__pclXlsxLoading;
  }
  function fieldOptions(type) { return fieldSets[type].map(field => `<option value="${safe(field.key)}">${safe(field.label)}${field.required ? " *" : ""}</option>`).join(""); }
  function autoMap(type) {
    state.mapping = {};
    fieldSets[type].forEach(field => {
      const index = state.headers.findIndex(header => field.aliases.includes(normalise(header)) || normalise(field.label) === normalise(header));
      state.mapping[field.key] = index;
    });
  }
  function defaultType() {
    const headers = state.headers.map(normalise);
    if (headers.includes("staffid") && (headers.includes("companyname") || headers.includes("clientid")) && !headers.includes("staffname")) return "links";
    if (headers.includes("staffid") || headers.includes("staffname") || headers.includes("position")) return "staff";
    return "clients";
  }
  function notice(message, error) {
    const target = document.getElementById("bulkImportNotice"); if (!target) return;
    target.textContent = message; target.className = `bulk-import-notice${error ? " error" : ""}`;
  }
  function readSheet(name) {
    if (!state.workbook || !window.XLSX) return;
    state.sheetName = name; const matrix = window.XLSX.utils.sheet_to_json(state.workbook.Sheets[name], { header: 1, defval: "", raw: false, blankrows: false });
    const headerRow = matrix.findIndex(row => row.some(value => clean(value))); state.headers = headerRow >= 0 ? matrix[headerRow].map(clean) : [];
    state.rows = headerRow >= 0 ? matrix.slice(headerRow + 1).filter(row => row.some(value => clean(value))) : [];
    state.type = defaultType(); autoMap(state.type); state.prepared = null; renderMapping();
  }
  function mappingHtml() {
    if (!state.headers.length) return '<div class="bulk-import-empty">Choose an Excel file to begin mapping its columns.</div>';
    const mappings = fieldSets[state.type].map(field => `<label class="bulk-map-row"><span>${safe(field.label)}${field.required ? " <b>*</b>" : ""}</span><select data-map-key="${safe(field.key)}"><option value="-1">Do not import</option>${state.headers.map((header, index) => `<option value="${index}" ${currentMapping(field.key) === index ? "selected" : ""}>${safe(header || `Column ${index + 1}`)}</option>`).join("")}</select></label>`).join("");
    const preview = state.rows.slice(0, 5).map(row => `<tr>${state.headers.map((_, index) => `<td>${safe(row[index])}</td>`).join("")}</tr>`).join("");
    return `<div class="bulk-import-meta"><span><b>${state.rows.length}</b> usable rows</span><span>Sheet: <b>${safe(state.sheetName)}</b></span><span>File data remains in this browser.</span></div><div class="bulk-map-grid">${mappings}</div><div class="bulk-import-preview"><h4>First five rows</h4><div class="table-wrap"><table class="data-table"><thead><tr>${state.headers.map(header => `<th>${safe(header)}</th>`).join("")}</tr></thead><tbody>${preview || `<tr><td colspan="${state.headers.length}">No data rows found.</td></tr>`}</tbody></table></div></div>`;
  }
  function renderMapping() {
    const host = document.getElementById("bulkImportMapping"); if (!host) return;
    const sheets = state.workbook ? state.workbook.SheetNames.map(name => `<option value="${safe(name)}" ${name === state.sheetName ? "selected" : ""}>${safe(name)}</option>`).join("") : "";
    const sheetControl = state.workbook ? `<label>Worksheet<select id="bulkSheetSelect">${sheets}</select></label>` : "";
    host.innerHTML = `${sheetControl}<div class="bulk-import-type"><label>Import type<select id="bulkImportType"><option value="staff" ${state.type === "staff" ? "selected" : ""}>Staff roster</option><option value="clients" ${state.type === "clients" ? "selected" : ""}>Client master</option><option value="links" ${state.type === "links" ? "selected" : ""}>Staff–client links</option></select></label><label>Default handling firm<select id="bulkDefaultFirm">${firms().map(firm => `<option value="${safe(firm.id)}">${safe(firm.firmCode || firm.legalName)}</option>`).join("")}</select></label></div>${mappingHtml()}<div class="actions"><button type="button" class="btn secondary" id="bulkDownloadTemplate">Download CSV template</button><button type="button" class="btn primary" id="bulkReviewImport" ${state.headers.length ? "" : "disabled"}>Review import</button></div><div id="bulkImportReview"></div>`;
    host.querySelector("#bulkSheetSelect")?.addEventListener("change", event => readSheet(event.target.value));
    host.querySelector("#bulkImportType")?.addEventListener("change", event => { state.type = event.target.value; autoMap(state.type); state.prepared = null; renderMapping(); });
    host.querySelectorAll("[data-map-key]").forEach(select => select.addEventListener("change", event => { state.mapping[event.target.dataset.mapKey] = Number(event.target.value); state.prepared = null; }));
    host.querySelector("#bulkDownloadTemplate")?.addEventListener("click", downloadTemplate);
    host.querySelector("#bulkReviewImport")?.addEventListener("click", reviewImport);
  }
  function requiredMissing() { return fieldSets[state.type].filter(field => field.required && currentMapping(field.key) < 0).map(field => field.label); }
  function duplicateKey(value) { return normalise(value); }
  function makeStaff(row) {
    const staffId = clean(cell(row, "staffId")).toUpperCase(), fullName = clean(cell(row, "fullName")), position = categoryFor(cell(row, "position"));
    const start = dateIso(cell(row, "effectiveDate")), end = dateIso(cell(row, "endDate"));
    if (!staffId || !fullName || !position) return { error: "Staff ID, Staff Name and a recognised staff category are required." };
    if (start && end && end < start) return { error: "End Date cannot be before Effective Date." };
    return { record: { staffId, loginId: staffId, fullName, position, standardCostRate: numberOrNull(cell(row, "standardCostRate")), billableRate: numberOrNull(cell(row, "billableRate")), effectiveDate: start, contractStartDate: start || "", contractEndDate: end || "", employmentType: clean(cell(row, "employmentType")) || "Contract", billingStatus: clean(cell(row, "billingStatus")) || "Billable", firmScope: clean(cell(row, "firmScope")) || "Assigned firms", clientScope: "Assigned clients", projectScope: "Assigned tasks", accountStatus: "Setup link required", rateStatus: numberOrNull(cell(row, "standardCostRate")) === null && numberOrNull(cell(row, "billableRate")) === null ? "Pending Finance approval" : "Imported, Finance approval required", importSource: "Excel", importedAt: new Date().toISOString() } };
  }
  function makeClient(row, defaultFirm) {
    const companyName = clean(cell(row, "companyName")), primarySector = sectorFor(cell(row, "primarySector")), branchLocation = branchFor(cell(row, "branchLocation"));
    if (!companyName || !primarySector || !branchLocation) return { error: "Company Name, a recognised Primary Sector and Branch Location are required." };
    const firmId = firmFor(cell(row, "firm"), defaultFirm); if (!firmId) return { error: "A valid handling firm is required." };
    const services = splitValues(cell(row, "services"));
    return { record: { id: crypto.randomUUID(), importReference: clean(cell(row, "clientReference")) || crypto.randomUUID(), createdAt: new Date().toISOString(), importedAt: new Date().toISOString(), importSource: "Excel", companyName, tradingName: clean(cell(row, "tradingName")), firmId, primarySector, branchLocation, regulators: splitValues(cell(row, "regulators")), pieStatus: bool(cell(row, "pieStatus")), isSacco: normalise(primarySector) === "financialservices" && /sacco/i.test(`${companyName} ${cell(row, "regulators")}`), clientCategory: clean(cell(row, "clientCategory")) || "Corporate", leadSource: clean(cell(row, "leadSource")) || "Import", contact: { name: clean(cell(row, "contactName")), jobTitle: clean(cell(row, "jobTitle")), email: clean(cell(row, "email")), phone: clean(cell(row, "phone")), decisionRole: clean(cell(row, "decisionRole")) || "Day-to-Day Contact" }, services, engagementValue: numberOrNull(cell(row, "engagementValue")), billingFrequency: clean(cell(row, "billingFrequency")) || "One-off", pipelineStage: clean(cell(row, "pipelineStage")) || "Lead", incorporationDate: dateIso(cell(row, "incorporationDate")), smeAuditExempt: bool(cell(row, "smeAuditExempt")), smeAuditExemptionBasis: "", engagementLetter: "", notes: "Imported from Excel. Validate KYC, scope and engagement gate before activation.", taxProfile: null, eqrCompleted: false, reportSigned: false, tasks: [] } };
  }
  function makeLink(row) {
    const staffId = clean(cell(row, "staffId")).toUpperCase(), reference = clean(cell(row, "clientReference"));
    const staff = selectedStaff().find(item => item.staffId === staffId); if (!staff) return { error: `Staff ID ${staffId || "(blank)"} was not found. Import the staff roster first.` };
    const matches = selectedClients().filter(client => [client.id, client.importReference, client.companyName, client.tradingName].some(value => duplicateKey(value) && duplicateKey(value) === duplicateKey(reference)));
    if (matches.length !== 1) return { error: matches.length ? `Client reference ${reference} matches more than one client.` : `Client reference ${reference || "(blank)"} was not found. Import clients first.` };
    const client = matches[0], indicatedFirm = firmFor(cell(row, "firm"), client.firmId); if (indicatedFirm !== client.firmId) return { error: `Client ${client.companyName} is already locked to a different handling firm.` };
    const start = dateIso(cell(row, "plannedStartDate")), end = dateIso(cell(row, "plannedEndDate")); if (start && end && end < start) return { error: "Planned End Date cannot be before Planned Start Date." };
    return { record: { id: crypto.randomUUID(), staffId, clientId: client.id, clientReference: client.importReference, clientName: client.companyName, firmId: client.firmId, roleOnClient: clean(cell(row, "roleOnClient")) || staff.position, plannedStartDate: start, plannedEndDate: end, allocationPercentage: numberOrNull(cell(row, "allocation")) || null, source: "Excel staff–client import", linkedAt: new Date().toISOString() } };
  }
  function prepare() {
    const missing = requiredMissing(); if (missing.length) return { error: `Map the required field(s): ${missing.join(", ")}.` };
    const defaultFirm = document.getElementById("bulkDefaultFirm")?.value || firms()[0]?.id || "";
    const existing = state.type === "staff" ? selectedStaff() : state.type === "clients" ? selectedClients() : selectedLinks();
    const newRecords = [], errors = [], duplicates = []; const inFile = new Set();
    state.rows.forEach((row, index) => {
      const candidate = state.type === "staff" ? makeStaff(row) : state.type === "clients" ? makeClient(row, defaultFirm) : makeLink(row);
      if (candidate.error) { errors.push({ row: index + 2, message: candidate.error }); return; }
      const record = candidate.record;
      const key = state.type === "staff" ? record.staffId : state.type === "clients" ? duplicateKey(record.companyName) : `${record.staffId}:${record.clientId}`;
      const exists = state.type === "staff" ? existing.some(item => item.staffId === record.staffId || item.loginId === record.loginId) : state.type === "clients" ? existing.some(item => [item.companyName, item.tradingName, item.importReference].some(value => duplicateKey(value) && [record.companyName, record.tradingName, record.importReference].some(next => duplicateKey(next) && duplicateKey(next) === duplicateKey(value)))) : existing.some(item => item.staffId === record.staffId && item.clientId === record.clientId);
      if (inFile.has(key) || exists) { duplicates.push({ row: index + 2, label: state.type === "staff" ? record.staffId : state.type === "clients" ? record.companyName : `${record.staffId} → ${record.clientName}` }); return; }
      inFile.add(key); newRecords.push(record);
    });
    return { records: newRecords, errors, duplicates };
  }
  function reviewImport() {
    const result = prepare(); if (result.error) return notice(result.error, true); state.prepared = result;
    const host = document.getElementById("bulkImportReview"); if (!host) return;
    const label = state.type === "staff" ? "staff profiles" : state.type === "clients" ? "client records" : "staff–client links";
    host.innerHTML = `<div class="bulk-review"><h4>Import review</h4><div class="bulk-review-grid"><span><b>${result.records.length}</b> ready to import</span><span><b>${result.duplicates.length}</b> duplicate rows skipped</span><span><b>${result.errors.length}</b> invalid rows skipped</span></div>${result.errors.length ? `<details><summary>View invalid rows</summary><ul>${result.errors.slice(0, 25).map(item => `<li>Row ${item.row}: ${safe(item.message)}</li>`).join("")}</ul></details>` : ""}${result.duplicates.length ? `<details><summary>View duplicate rows</summary><ul>${result.duplicates.slice(0, 25).map(item => `<li>Row ${item.row}: ${safe(item.label)}</li>`).join("")}</ul></details>` : ""}<label class="checkbox-line bulk-confirm"><input id="bulkConfirmImport" type="checkbox" />I confirm that the mapped records are authorised for this private ERP workspace.</label><button class="btn primary" id="bulkConfirmButton" type="button" ${result.records.length ? "" : "disabled"}>Confirm and import ${result.records.length} ${label}</button></div>`;
    host.querySelector("#bulkConfirmButton")?.addEventListener("click", confirmImport);
  }
  function confirmImport() {
    const confirmed = document.getElementById("bulkConfirmImport")?.checked; if (!confirmed) return notice("Tick the confirmation before importing the mapped records.", true);
    const result = state.prepared; if (!result?.records?.length) return;
    const key = state.type === "staff" ? KEYS.staff : state.type === "clients" ? KEYS.clients : KEYS.links;
    saveJson(key, [...parseJson(key), ...result.records]);
    const label = state.type === "staff" ? "staff profiles" : state.type === "clients" ? "client records" : "staff–client links";
    notice(`${result.records.length} ${label} imported in this browser. ${state.type === "clients" ? "Reload the ERP to show them in Clients." : state.type === "staff" ? "The staff roster is ready for setup-link selection." : "Links are saved for allocation and future engagement setup."}`);
    const review = document.getElementById("bulkImportReview"); if (review) review.innerHTML += `<div class="actions"><button type="button" class="btn secondary" id="bulkRefreshWorkspace">Refresh ERP workspace</button></div>`;
    document.getElementById("bulkRefreshWorkspace")?.addEventListener("click", () => window.location.reload());
    if (state.type === "staff" && window.pclStaffAccessPreview?.render) window.setTimeout(() => window.pclStaffAccessPreview.render(), 80);
  }
  function downloadTemplate() {
    const header = fieldSets[state.type].map(field => field.label); const example = state.type === "staff" ? ["AP0001", "Example Staff", "Audit Assistant", "1500", "4000", "2026-01-01", "2027-12-31", "Contract", "Billable", "Assigned firms"] : state.type === "clients" ? ["CL-0001", "Example Client Limited", "Example Trading", "ACPA", "SME/Startup", "Nairobi", "KRA", "No", "Corporate", "Referral", "Jane Example", "Finance Director", "", "", "Decision Maker", "Tax Compliance (VAT, PAYE, Income Tax)", "", "Monthly Retainer", "Lead", "", "No"] : ["AP0001", "CL-0001", "Audit Assistant", "ACPA", "", "", "100"];
    const csv = [header, example].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n"); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `PCL_${state.type}_import_template.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  function onFile(file) {
    if (!file) return; notice("Reading the workbook locally. No spreadsheet data is uploaded from this browser.");
    ensureXlsx().then(() => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = event => resolve(event.target.result); reader.onerror = () => reject(new Error("Could not read the selected file.")); reader.readAsArrayBuffer(file); })).then(buffer => { state.workbook = window.XLSX.read(buffer, { type: "array" }); if (!state.workbook.SheetNames.length) throw new Error("No worksheets were found."); readSheet(state.workbook.SheetNames[0]); notice(`Workbook ready. Choose the worksheet, check the field mapping, then review the import.`); }).catch(error => notice(`${error.message} Try again after checking the file format or connection.`, true));
  }
  function panelHtml() {
    return `<section class="section bulk-import-section" id="bulkDataImport"><div class="section-heading"><h3>Bulk staff and client import</h3><span class="hint">Map an Excel worksheet before importing it into this browser-local ERP preview.</span></div><div class="bulk-import-notice" id="bulkImportNotice">Use one workbook with separate Staff, Clients and Staff–Client Links sheets, or upload files one at a time. Imported data is never committed to the public website.</div><div class="bulk-upload-row"><label class="bulk-file-label">Excel file (.xlsx, .xls, .csv)<input id="bulkImportFile" type="file" accept=".xlsx,.xls,.csv" /></label><div><b>Required import order</b><br><span class="hint">1. Staff roster, 2. Client master, 3. Staff–client links. Links validate Staff ID, Client reference and locked handling firm.</span></div></div><div id="bulkImportMapping"></div></section>`;
  }
  function inject() {
    const staffSelected = Array.from(document.querySelectorAll("[data-settings-menu='staff']")).some(button => button.classList.contains("active"));
    const body = document.getElementById("settingsBody"); if (!body || !staffSelected || body.querySelector("#bulkDataImport")) return;
    const anchor = body.querySelector(".staff-invite-flow");
    if (anchor) anchor.insertAdjacentHTML("beforebegin", panelHtml()); else body.insertAdjacentHTML("beforeend", panelHtml());
    document.getElementById("bulkImportFile")?.addEventListener("change", event => onFile(event.target.files?.[0])); renderMapping();
  }
  function scheduleInject() { window.setTimeout(inject, 100); }
  document.addEventListener("click", event => { if (event.target.closest("[data-settings-menu='staff']")) scheduleInject(); }, true);
  new MutationObserver(scheduleInject).observe(document.body, { childList: true, subtree: true });
  const style = document.createElement("style");
  style.textContent = `.bulk-import-section{margin-top:20px}.bulk-import-notice{margin:10px 0 14px;padding:10px 12px;border:1px solid #c8dfd0;border-radius:7px;background:#f3fbf6;color:#245b3d;font-size:12px}.bulk-import-notice.error{border-color:#dfb7b7;background:#fff3f3;color:#922f2f}.bulk-upload-row{display:grid;grid-template-columns:minmax(260px,.7fr) minmax(300px,1.3fr);gap:14px;align-items:end;padding:14px;border:1px solid #dfe8e2;border-radius:9px;background:#f8fbf9}.bulk-file-label input{padding:7px;background:#fff}.bulk-import-type{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:15px 0}.bulk-import-meta{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0;padding:9px 11px;border-radius:7px;background:#f2f6f4;color:#516158;font-size:12px}.bulk-map-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.bulk-map-row{display:grid;grid-template-columns:minmax(145px,.8fr) minmax(160px,1.2fr);gap:8px;align-items:center;padding:7px 9px;border:1px solid #e1e9e4;border-radius:7px;background:white}.bulk-map-row select{margin:0;min-height:34px}.bulk-map-row b{color:#b33232}.bulk-import-preview{margin-top:16px}.bulk-import-preview h4,.bulk-review h4{margin:0 0 8px;font-size:13px}.bulk-import-preview .table-wrap{max-height:240px}.bulk-review{margin-top:15px;padding:14px;border:1px solid #bdd8c7;border-radius:9px;background:#f6fcf8}.bulk-review-grid{display:flex;gap:11px;flex-wrap:wrap;margin:8px 0 12px}.bulk-review-grid span{padding:7px 9px;border-radius:6px;background:#fff;border:1px solid #d8e7dd;font-size:12px}.bulk-review details{margin:8px 0;font-size:12px}.bulk-review li{margin:4px 0}.bulk-confirm{margin:12px 0}.bulk-import-empty{padding:16px;border:1px dashed #becbc3;border-radius:8px;color:#6c7b72;font-size:12px}@media(max-width:850px){.bulk-upload-row,.bulk-import-type,.bulk-map-grid{grid-template-columns:1fr}.bulk-map-row{grid-template-columns:1fr}}`;
  document.head.append(style);
})();
