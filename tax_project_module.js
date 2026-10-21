/*
 * Tax Project Workspace V2
 *
 * Browser-preview implementation of the controlled Engagement -> Tax
 * Obligation -> Tax Period model. Production must enforce the same controls
 * through authenticated APIs, PostgreSQL constraints and object storage.
 */
(() => {
  const storage = {
    projects: "pcl-crm-tax-period-projects-v2",
    batches: "pcl-crm-tax-import-batches-v2",
    importRows: "pcl-crm-tax-import-rows-v2",
    tasks: "pcl-crm-tax-project-tasks-v2",
    filings: "pcl-crm-tax-filing-submissions-v2",
    taskEvidence: "pcl-crm-tax-task-evidence-v2"
  };

  const positions = ["Tax Assistant", "Tax Supervisor", "Tax Manager", "Engagement Partner", "Authorized Tax Filer"];
  const obligations = {
    VAT: {
      label: "VAT",
      frequency: "Monthly",
      statutoryDue: "20th of the following month",
      expectedSources: ["SALES_ETIMS_Z", "PURCHASES_ETIMS", "BANK_STATEMENT"],
      sourceLabels: {SALES_ETIMS_Z: "Sales / eTIMS / Z report", PURCHASES_ETIMS: "Purchases / eTIMS", BANK_STATEMENT: "Bank statement"}
    },
    PAYE: {
      label: "PAYE",
      frequency: "Monthly",
      statutoryDue: "9th of the following month",
      expectedSources: ["PAYROLL_INPUT"],
      sourceLabels: {PAYROLL_INPUT: "Payroll input / P10 schedule"}
    },
    WHT: {
      label: "Withholding Tax",
      frequency: "Monthly",
      statutoryDue: "Configured from the obligation profile",
      expectedSources: ["WHT_SCHEDULE"],
      sourceLabels: {WHT_SCHEDULE: "WHT schedule and certificates"}
    },
    INCOME_TAX: {
      label: "Income Tax",
      frequency: "Annual",
      statutoryDue: "Six months after the financial year end",
      expectedSources: ["TB_SCHEDULES"],
      sourceLabels: {TB_SCHEDULES: "Trial balance and annual tax schedules"}
    }
  };

  let projects = loadRecords(storage.projects);
  let batches = loadRecords(storage.batches);
  let importRows = loadRecords(storage.importRows);
  let tasks = loadRecords(storage.tasks);
  let filings = loadRecords(storage.filings);
  let taskEvidence = loadRecords(storage.taskEvidence);

  const dateKey = value => String(value || "").slice(0, 10);
  const isoToday = () => operationDate();
  const projectById = id => projects.find(project => project.id === id);
  const sourceLabel = code => Object.values(obligations).find(item => item.sourceLabels[code])?.sourceLabels[code] || code;
  const currentRole = () => document.getElementById("taxProjectPreviewRole")?.value || "Tax Assistant";
  const taxClientFor = engagement => clients.find(client => normaliseName(client.companyName) === normaliseName(engagement?.companyName)) || null;
  const taxProfileFor = client => client?.taxProfile || null;
  const normalisePin = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const validTaxpayerPin = value => /^[A-Z]\d{9}[A-Z]$/.test(normalisePin(value));
  const isTaxProjectEngagement = engagement => Boolean(engagement && isTaxEngagement(engagement));
  const activeTaxEngagements = () => activeEngagements().filter(isTaxProjectEngagement);
  const projectBatches = project => batches.filter(batch => batch.projectId === project.id && batch.status !== "Superseded");
  const projectTasks = project => tasks.filter(task => task.projectId === project.id);
  const projectFilings = project => filings.filter(filing => filing.projectId === project.id);
  const isLocked = project => Boolean(project.lockedAt || ["Filed", "Amended"].includes(project.status));
  const approved = (project, stage) => project.approvals?.some(item => item.stage === stage && item.status === "Approved");
  const isExcelWorkbook = file => Boolean(file?.name && /\.(xlsx|xlsm)$/i.test(file.name));
  const isPdfEvidence = file => Boolean(file?.name && /\.pdf$/i.test(file.name));

  async function hashUpload(file) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashText(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  // Lightweight XLSX/XLSM reader for the browser preview. It reads values only,
  // never formulas or macros, and stores only a row fingerprint in local storage.
  // The production importer must repeat this in a server-side transaction.
  function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
      if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break; }
    }
    if (eocd < 0) throw new Error("This workbook is not a valid XLSX/XLSM ZIP file.");
    const total = view.getUint16(eocd + 10, true);
    let cursor = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let count = 0; count < total; count += 1) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("The workbook ZIP directory is invalid.");
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      entries.set(name, {method, compressedSize, localOffset});
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return {bytes, entries};
  }

  async function unzipText(archive, name) {
    const entry = archive.entries.get(name);
    if (!entry) return "";
    const view = new DataView(archive.bytes.buffer, archive.bytes.byteOffset, archive.bytes.byteLength);
    const start = entry.localOffset;
    if (view.getUint32(start, true) !== 0x04034b50) throw new Error("The workbook contains an invalid file entry.");
    const nameLength = view.getUint16(start + 26, true);
    const extraLength = view.getUint16(start + 28, true);
    const payload = archive.bytes.slice(start + 30 + nameLength + extraLength, start + 30 + nameLength + extraLength + entry.compressedSize);
    let output;
    if (entry.method === 0) output = payload;
    else if (entry.method === 8 && "DecompressionStream" in window) {
      const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      output = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error("This browser cannot read the compressed XLSX/XLSM workbook. Use a current browser or upload through the server importer.");
    return new TextDecoder().decode(output);
  }

  const xmlDocument = text => new DOMParser().parseFromString(text, "application/xml");
  const normaliseCell = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const headerKey = value => normaliseCell(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  const cellColumnIndex = reference => {
    const letters = String(reference || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
    return [...letters].reduce((result, letter) => (result * 26) + letter.charCodeAt(0) - 64, 0) - 1;
  };

  async function readWorkbookRows(file) {
    const archive = zipEntries(new Uint8Array(await file.arrayBuffer()));
    const workbookXml = await unzipText(archive, "xl/workbook.xml");
    const relationshipXml = await unzipText(archive, "xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relationshipXml) throw new Error("The workbook does not contain an Excel worksheet structure.");
    const relationshipMap = new Map([...xmlDocument(relationshipXml).querySelectorAll("Relationship")].map(node => [node.getAttribute("Id"), node.getAttribute("Target")]));
    const firstSheet = [...xmlDocument(workbookXml).querySelectorAll("sheet")].find(node => node.getAttribute("state") !== "hidden" && node.getAttribute("state") !== "veryHidden");
    const target = relationshipMap.get(firstSheet?.getAttribute("r:id"));
    const sheetPath = target ? `xl/${target.replace(/^\//, "").replace(/^xl\//, "")}` : [...archive.entries.keys()].find(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
    if (!sheetPath) throw new Error("No readable worksheet was found in the uploaded workbook.");
    const sharedXml = await unzipText(archive, "xl/sharedStrings.xml");
    const sharedValues = sharedXml ? [...xmlDocument(sharedXml).querySelectorAll("si")].map(node => normaliseCell([...node.querySelectorAll("t")].map(text => text.textContent).join(""))) : [];
    const sheetXml = await unzipText(archive, sheetPath);
    const sheetDocument = xmlDocument(sheetXml);
    const sheetRows = [...sheetDocument.querySelectorAll("sheetData > row")].map(row => {
      const values = [];
      [...row.querySelectorAll("c")].forEach(cell => {
        const type = cell.getAttribute("t");
        const raw = cell.querySelector("v")?.textContent || "";
        const inline = cell.querySelector("is") ? [...cell.querySelectorAll("is t")].map(node => node.textContent).join("") : "";
        const value = type === "s" ? sharedValues[Number(raw)] : type === "inlineStr" ? inline : raw;
        values[cellColumnIndex(cell.getAttribute("r"))] = normaliseCell(value);
      });
      return {rowNumber: Number(row.getAttribute("r") || 0), values};
    }).filter(row => row.values.some(Boolean));
    if (sheetRows.length < 2) throw new Error("The first visible worksheet needs a header row and at least one data row.");
    const [headerRow, ...dataRows] = sheetRows;
    const headers = headerRow.values.map((value, index) => normaliseCell(value) || `Column ${index + 1}`);
    const usableRows = dataRows.filter(row => row.values.some(Boolean)).map(row => ({rowNumber: row.rowNumber, values: headers.map((_, index) => normaliseCell(row.values[index]))}));
    if (!usableRows.length) throw new Error("No data rows were found below the worksheet header.");
    return {sheetName: firstSheet?.getAttribute("name") || sheetPath.split("/").pop(), headers, rows: usableRows};
  }

  async function fingerprintImportedRow(headers, values) {
    const preferred = ["transactionid", "referencenumber", "reference", "refnum", "instrumentnum", "invoicenumber", "documentnumber", "vouchernumber", "receiptno"];
    const indexed = headers.map((header, index) => ({key: headerKey(header), value: normaliseCell(values[index])}));
    const identity = preferred.map(key => indexed.find(item => item.key === key)?.value).filter(Boolean);
    const body = identity.length ? identity : indexed.filter(item => item.value).map(item => `${item.key}:${item.value}`);
    return hashText(body.join("|"));
  }

  function persist() {
    localStorage.setItem(storage.projects, JSON.stringify(projects));
    localStorage.setItem(storage.batches, JSON.stringify(batches));
    localStorage.setItem(storage.importRows, JSON.stringify(importRows));
    localStorage.setItem(storage.tasks, JSON.stringify(tasks));
    localStorage.setItem(storage.filings, JSON.stringify(filings));
    localStorage.setItem(storage.taskEvidence, JSON.stringify(taskEvidence));
    saveClients();
    saveLifecycleRecords();
    window.dispatchEvent(new CustomEvent("pcl:tax-projects-updated"));
  }

  // A read-only summary bridge for the personal dashboard. It carries no
  // workbook rows, KRA PINs, evidence files or QR content. The production
  // equivalent is a server-side query constrained by the signed-in user.
  window.pclTaxProjectWorkspace = {
    dashboardSnapshot({firmId = ""} = {}) {
      const scopedProjects = projects.filter(project => !firmId || project.firmId === firmId);
      const scopedProjectIds = new Set(scopedProjects.map(project => project.id));
      const projectFor = id => scopedProjects.find(project => project.id === id);
      const projectTasks = tasks.filter(task => scopedProjectIds.has(task.projectId)).map(task => {
        const project = projectFor(task.projectId);
        return {
          id: task.id,
          engagementId: project?.engagementId || null,
          firmId: project?.firmId || null,
          clientName: project?.clientName || "Archived tax client",
          projectReference: project?.projectReference || "",
          projectStatus: project?.status || "",
          title: task.title,
          assignedPosition: task.assignedPosition,
          dueDate: task.dueDate,
          status: task.status
        };
      });
      const obligations = scopedProjects.flatMap(project => (project.obligations || []).map(obligation => ({
        firmId: project.firmId,
        projectId: project.id,
        projectReference: project.projectReference,
        clientName: project.clientName,
        code: obligation.code,
        status: obligation.status
      })));
      const pendingUploads = projectTasks.filter(task => /upload|collect|gather/i.test(String(task.title || "")) && !["Completed", "Filed", "Cancelled"].includes(task.status));
      const activities = [
        ...scopedProjects.map(project => ({kind: "tax", at: project.createdAt, label: "Tax Project opened for " + project.clientName})),
        ...batches.filter(batch => scopedProjectIds.has(batch.projectId)).map(batch => {
          const project = projectFor(batch.projectId);
          return {kind: "tax", at: batch.createdAt, label: (batch.recordCount || 0) + " new tax item(s) accepted for " + (project?.clientName || "a tax project")};
        }),
        ...filings.filter(filing => scopedProjectIds.has(filing.projectId)).map(filing => {
          const project = projectFor(filing.projectId);
          return {kind: "tax", at: filing.filedAt, label: "Tax filing recorded for " + (project?.clientName || "a tax project")};
        })
      ];
      return {tasks: projectTasks, obligations, pendingUploads, activities};
    }
  };

  function notice(message, isError = false) {
    const target = document.getElementById("taxProjectNotice");
    if (!target) return;
    target.textContent = message;
    target.classList.add("show");
    target.classList.toggle("tax-project-error", isError);
    clearTimeout(notice.timer);
    notice.timer = setTimeout(() => target.classList.remove("show"), 8000);
  }

  function alertPosition(code, project, recipient, message) {
    if (typeof writeAlert === "function") writeAlert(code, project.id, recipient, `${project.clientName}: ${message}`);
  }

  function addMonths(value, months) {
    const current = new Date(`${dateKey(value)}T00:00:00Z`);
    current.setUTCDate(1);
    current.setUTCMonth(current.getUTCMonth() + months);
    return current.toISOString().slice(0, 10);
  }

  function endOfMonth(monthValue) {
    const [year, month] = String(monthValue || "").split("-").map(Number);
    if (!year || !month) return "";
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }

  function monthStart(monthValue) {
    return /^\d{4}-\d{2}$/.test(String(monthValue || "")) ? `${monthValue}-01` : "";
  }

  function monthLabel(start, end) {
    const startDate = new Date(`${dateKey(start)}T00:00:00Z`);
    const endDate = new Date(`${dateKey(end)}T00:00:00Z`);
    const first = startDate.toLocaleDateString("en-KE", {month: "long", year: "numeric", timeZone: "UTC"});
    const last = endDate.toLocaleDateString("en-KE", {month: "short", year: "numeric", timeZone: "UTC"});
    return first === last ? first : `${first} to ${last}`;
  }

  function mondayOnOrBefore(value) {
    const date = new Date(`${dateKey(value)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }

  function weeklyStarts(project) {
    const result = [];
    let cursor = mondayOnOrBefore(project.periodStart);
    const end = new Date(`${project.periodEnd}T00:00:00Z`).getTime();
    while (new Date(`${cursor}T00:00:00Z`).getTime() <= end) {
      result.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return result;
  }

  function registrationSupports(client, code) {
    const registrations = taxProfileFor(client)?.registrations || [];
    const mapping = {VAT: "VAT", PAYE: "PAYE", WHT: "Withholding Tax (WHT)", INCOME_TAX: "Corporation Tax"};
    return registrations.includes(mapping[code]);
  }

  function defaultObligations(client, periodKind) {
    const allowed = periodKind === "Annual" ? ["INCOME_TAX"] : ["VAT", "PAYE", "WHT"];
    return allowed.filter(code => registrationSupports(client, code));
  }

  function periodForForm(data) {
    const kind = data.get("periodKind");
    if (kind === "Monthly") {
      const start = monthStart(data.get("periodMonth"));
      return {kind, start, end: endOfMonth(data.get("periodMonth"))};
    }
    return {kind, start: dateKey(data.get("annualPeriodStart")), end: dateKey(data.get("annualPeriodEnd"))};
  }

  function approvalRecord(project, stage, position, note = "") {
    project.approvals = project.approvals || [];
    project.approvals.push({id: crypto.randomUUID(), stage, position, status: "Approved", note, approvedAt: new Date().toISOString()});
  }

  function configuredSources(project, obligation) {
    const config = obligations[obligation.code];
    if (!config) return [];
    if (project.periodKind === "Monthly" && obligation.code === "VAT") {
      return weeklyStarts(project).flatMap(weekStart => config.expectedSources.map(source => ({source, periodKey: weekStart, label: `${sourceLabel(source)} · week of ${weekStart}`})));
    }
    return config.expectedSources.map(source => ({source, periodKey: project.periodStart, label: sourceLabel(source)}));
  }

  function readiness(project) {
    if (project.identityStatus !== "Verified") return {ready: false, missing: ["Tax Manager client identity approval"]};
    const missing = [];
    project.obligations.forEach(obligation => {
      configuredSources(project, obligation).forEach(expected => {
        const batch = projectBatches(project).find(item => item.obligationCode === obligation.code && item.sourceType === expected.source && item.periodKey === expected.periodKey && item.status === "Accepted");
        if (!batch) missing.push(`${obligations[obligation.code].label}: ${expected.label}`);
      });
    });
    return {ready: missing.length === 0, missing};
  }

  function createProjectTasks(project) {
    if (projectTasks(project).length) return;
    const templates = {
      VAT: [
        ["Upload VAT source data", "Tax Assistant", 2], ["Classify purchase and exception data", "Tax Assistant", 3],
        ["Reconcile sales, eTIMS and bank", "Tax Assistant", 4], ["Prepare VAT3 working paper", "Tax Assistant", 6],
        ["Review VAT3 working paper", "Tax Supervisor", 8], ["Authorise VAT3 filing", "Tax Manager", 10]
      ],
      PAYE: [
        ["Upload payroll input", "Tax Assistant", 1], ["Prepare PAYE working paper", "Tax Assistant", 2],
        ["Review PAYE and payroll schedules", "Tax Supervisor", 4], ["Authorise PAYE filing", "Tax Manager", 6]
      ],
      WHT: [
        ["Collect WHT schedule and certificates", "Tax Assistant", 3], ["Review WHT deductions", "Tax Supervisor", 6], ["Authorise WHT filing", "Tax Manager", 8]
      ],
      INCOME_TAX: [
        ["Gather trial balance and annual schedules", "Tax Assistant", 90], ["Prepare annual income-tax computation", "Tax Assistant", 120],
        ["Review annual income-tax computation", "Tax Supervisor", 140], ["Authorise annual return", "Tax Manager", 150]
      ]
    };
    project.obligations.forEach(obligation => {
      (templates[obligation.code] || []).forEach(([title, assignedPosition, offsetDays]) => {
        const base = obligation.code === "INCOME_TAX" ? project.periodEnd : project.periodEnd;
        tasks.push({id: crypto.randomUUID(), projectId: project.id, obligationCode: obligation.code, title, assignedPosition, dueDate: addDays(base, offsetDays), status: "Pending", createdAt: new Date().toISOString()});
      });
    });
  }

  function createProject(data) {
    const engagement = engagementById(data.get("engagementId"));
    const client = taxClientFor(engagement);
    const period = periodForForm(data);
    const selectedObligations = data.getAll("obligationCode");
    const taxpayerPin = normalisePin(data.get("taxpayerPin"));
    const confirmedName = data.get("confirmedLegalName");
    if (!engagement || !isTaxProjectEngagement(engagement)) throw new Error("Choose an active Tax Compliance engagement. The client and handling firm are inherited from it.");
    if (!client) throw new Error("The selected engagement is not linked to a saved client profile. Create or correct the client profile before opening a Tax Project.");
    if (!kycDocumentsVerified(engagement)) throw new Error("The Engagement Letter, Certificate of Incorporation, KRA PIN and CR12 must be Manager-verified before a Tax Project can be opened.");
    if (!period.start || !period.end || period.end < period.start) throw new Error("Enter a valid tax period.");
    if (!selectedObligations.length) throw new Error("Select at least one obligation for this period.");
    if (!validTaxpayerPin(taxpayerPin)) throw new Error("Enter the verified taxpayer KRA PIN in the expected letter–nine digits–letter format.");
    if (normaliseName(confirmedName) !== normaliseName(client.companyName)) throw new Error("Type the client legal name exactly as shown in the selected client record to confirm identity.");
    const profile = taxProfileFor(client) || {};
    if (profile.taxpayerPin && normalisePin(profile.taxpayerPin) !== taxpayerPin) throw new Error("The taxpayer PIN does not match the verified client tax identity. Stop and resolve the client record before continuing.");
    if (projects.some(project => project.engagementId === engagement.id && project.periodStart === period.start && project.periodEnd === period.end && project.periodKind === period.kind && project.status !== "Amended")) throw new Error("A Tax Project already exists for this client, engagement and reporting period. Open the existing project rather than creating a duplicate.");
    const project = {
      id: crypto.randomUUID(),
      projectReference: `TAX/${String(new Date().getUTCFullYear())}/${String(projects.length + 1).padStart(4, "0")}`,
      engagementId: engagement.id,
      clientId: client.id,
      firmId: engagement.firmId,
      clientName: client.companyName,
      taxpayerPin,
      periodKind: period.kind,
      periodStart: period.start,
      periodEnd: period.end,
      status: "Identity Review",
      identityStatus: "Pending",
      identityLockedAt: null,
      requiresClientConfirmation: data.get("requiresClientConfirmation") === "on",
      requiresPartnerApproval: data.get("requiresPartnerApproval") === "on",
      obligations: selectedObligations.map(code => ({code, label: obligations[code].label, frequency: obligations[code].frequency, status: "Not Started"})),
      approvals: [],
      createdByRole: currentRole(),
      createdAt: new Date().toISOString(),
      revisionNo: 1
    };
    projects.push(project);
    alertPosition("TAX_PROJECT_IDENTITY_REVIEW", project, "Tax Manager", `verify the selected client identity, KRA PIN and obligation scope for ${monthLabel(period.start, period.end)}.`);
    persist();
    return project;
  }

  function requireRole(expected, project, message) {
    if (currentRole() !== expected) throw new Error(`${message} This action is restricted to ${expected}.`);
    if (project.createdByRole === expected) throw new Error(`Segregation of duties prevents ${expected} from approving a Tax Project created by the same position.`);
  }

  function approveIdentity(project) {
    requireRole("Tax Manager", project, "Client identity approval is unavailable.");
    const engagement = engagementById(project.engagementId);
    const client = taxClientFor(engagement);
    if (!client || !kycDocumentsVerified(engagement)) throw new Error("The client KYC and engagement verification gate is incomplete.");
    client.taxProfile = client.taxProfile || {};
    if (client.taxProfile.taxpayerPin && normalisePin(client.taxProfile.taxpayerPin) !== project.taxpayerPin) throw new Error("The PIN conflicts with the verified client tax profile.");
    client.taxProfile.taxpayerPin = project.taxpayerPin;
    client.taxProfile.taxIdentityVerifiedAt = new Date().toISOString();
    client.taxProfile.taxIdentityVerifiedByPosition = "Tax Manager";
    project.identityStatus = "Verified";
    project.identityLockedAt = new Date().toISOString();
    project.status = "Data Collection";
    approvalRecord(project, "CLIENT_IDENTITY", "Tax Manager", "Client, legal name, KRA PIN, engagement and handling firm confirmed.");
    createProjectTasks(project);
    alertPosition("TAX_PROJECT_DATA_COLLECTION", project, "Tax Assistant", "client identity and obligation scope are approved; begin controlled source intake.");
    persist();
  }

  async function recordBatch(data) {
    const project = projectById(data.get("projectId"));
    if (!project || project.status !== "Data Collection" || isLocked(project)) throw new Error("Select an identity-approved Tax Project that is in Data Collection.");
    if (!["Tax Assistant", "Tax Manager"].includes(currentRole())) throw new Error("Only Tax Assistant or Tax Manager may record a controlled source batch.");
    const obligation = project.obligations.find(item => item.code === data.get("obligationCode"));
    const sourceType = data.get("sourceType");
    const periodKey = dateKey(data.get("batchPeriodKey"));
    const workbook = data.get("workingPaperFile");
    let fileReference = data.get("fileReference").trim();
    let fileHash = data.get("fileHash").trim().toLowerCase();
    const noActivity = data.get("noActivity") === "on";
    if (!obligation || !obligations[obligation.code].expectedSources.includes(sourceType)) throw new Error("Choose a source permitted for the selected obligation.");
    if (!periodKey) throw new Error("Select the batch week or reporting-period date.");
    if (noActivity && !fileReference) throw new Error("Record the evidence reference or reason supporting a No Activity declaration.");
    if (!noActivity && !isExcelWorkbook(workbook)) throw new Error("For row-level duplicate checking, source workbooks must be Excel .xlsx or .xlsm files.");
    let importSummary = {sheetName: "No activity", totalRows: 0, acceptedRows: 0, duplicateRows: 0, rows: []};
    if (!noActivity) {
      fileReference = fileReference || workbook.name;
      fileHash = fileHash || await hashUpload(workbook);
      const workbookRows = await readWorkbookRows(workbook);
      const seenFingerprints = new Set(importRows.filter(row => row.firmId === project.firmId && row.clientId === project.clientId && row.sourceType === sourceType).map(row => row.rowFingerprint));
      const seenInWorkbook = new Set();
      const acceptedRows = [], duplicates = [];
      for (const row of workbookRows.rows) {
        const rowFingerprint = await fingerprintImportedRow(workbookRows.headers, row.values);
        if (seenFingerprints.has(rowFingerprint) || seenInWorkbook.has(rowFingerprint)) duplicates.push({...row, rowFingerprint});
        else {seenInWorkbook.add(rowFingerprint); acceptedRows.push({...row, rowFingerprint});}
      }
      if (!acceptedRows.length) throw new Error(`No new items were uploaded. All ${duplicates.length} row(s) already exist for this client and source.`);
      importSummary = {sheetName: workbookRows.sheetName, totalRows: workbookRows.rows.length, acceptedRows: acceptedRows.length, duplicateRows: duplicates.length, rows: acceptedRows};
    }
    if (noActivity && batches.some(batch => batch.projectId === project.id && batch.obligationCode === obligation.code && batch.sourceType === sourceType && batch.periodKey === periodKey && batch.noActivity && batch.status !== "Superseded")) throw new Error("A No Activity declaration already exists for this obligation, source and period.");
    const batch = {id: crypto.randomUUID(), projectId: project.id, engagementId: project.engagementId, clientId: project.clientId, firmId: project.firmId, obligationCode: obligation.code, sourceType, periodKey, fileReference, fileHash, worksheetName: importSummary.sheetName, sourceRowCount: importSummary.totalRows, recordCount: importSummary.acceptedRows, duplicateRowCount: importSummary.duplicateRows, noActivity, status: "Accepted", createdByRole: currentRole(), createdAt: new Date().toISOString()};
    batches.push(batch);
    importRows.push(...importSummary.rows.map(row => ({id: crypto.randomUUID(), batchId: batch.id, projectId: project.id, clientId: project.clientId, firmId: project.firmId, sourceType, sourceRowNumber: row.rowNumber, rowFingerprint: row.rowFingerprint, createdAt: new Date().toISOString()})));
    persist();
    return batch;
  }

  async function recordTaskEvidence(data) {
    const project = projectById(data.get("projectId"));
    const task = tasks.find(item => item.id === data.get("taskId") && item.projectId === project?.id);
    const evidence = data.get("taskEvidenceFile");
    if (!project || isLocked(project)) throw new Error("Choose an open Tax Project.");
    if (!task) throw new Error("Choose a task that belongs to the selected Tax Project.");
    if (!isPdfEvidence(evidence)) throw new Error("Tax task evidence must be a PDF document. Working papers and schedules belong in the Excel source upload.");
    if (![task.assignedPosition, "Tax Manager"].includes(currentRole())) throw new Error("Only the assigned position or Tax Manager may attach task evidence.");
    const fileHash = await hashUpload(evidence);
    if (taskEvidence.some(item => item.projectId === project.id && item.fileHash === fileHash)) throw new Error("This PDF is already attached to the Tax Project.");
    taskEvidence.push({id: crypto.randomUUID(), projectId: project.id, taskId: task.id, clientId: project.clientId, firmId: project.firmId, fileName: evidence.name, fileHash, uploadedByRole: currentRole(), uploadedAt: new Date().toISOString()});
    persist();
  }

  function submitForReview(project) {
    if (currentRole() !== "Tax Assistant") throw new Error("Only Tax Assistant may submit collected data for technical review.");
    if (project.status !== "Data Collection") throw new Error("The Tax Project must be in Data Collection before submission.");
    const controls = readiness(project);
    if (!controls.ready) throw new Error(`The project cannot move to review. Outstanding source batches: ${controls.missing.slice(0, 5).join("; ")}${controls.missing.length > 5 ? "…" : ""}`);
    project.status = "In Review";
    project.obligations.forEach(obligation => obligation.status = "In Review");
    project.submittedByRole = currentRole();
    project.submittedAt = new Date().toISOString();
    alertPosition("TAX_PROJECT_TECHNICAL_REVIEW", project, "Tax Supervisor", "all required source batches are recorded and the working paper is ready for technical review.");
    persist();
  }

  function approveTechnicalReview(project) {
    requireRole("Tax Supervisor", project, "Technical review approval is unavailable.");
    if (project.status !== "In Review") throw new Error("The Tax Project must be submitted for review first.");
    approvalRecord(project, "TECHNICAL_REVIEW", "Tax Supervisor", "Source batches, reconciliations and working-paper exceptions reviewed.");
    project.status = project.requiresClientConfirmation ? "Awaiting Client Confirmation" : "Manager Approval";
    project.obligations.forEach(obligation => obligation.status = project.status);
    alertPosition("TAX_PROJECT_MANAGER_APPROVAL", project, "Tax Manager", project.requiresClientConfirmation ? "technical review is complete; record the authorised client confirmation before filing approval." : "technical review is complete; approve the project for filing.");
    persist();
  }

  function recordClientConfirmation(project) {
    if (currentRole() !== "Tax Manager") throw new Error("Only Tax Manager may record an authorised client confirmation.");
    if (project.status !== "Awaiting Client Confirmation") throw new Error("This project is not awaiting a client confirmation.");
    const reference = window.prompt("Enter the Communication Hub reference for the client confirmation:");
    if (!reference) return;
    project.clientConfirmationReference = reference.trim();
    project.clientConfirmedAt = new Date().toISOString();
    project.status = "Manager Approval";
    approvalRecord(project, "CLIENT_CONFIRMATION", "Tax Manager", `Client confirmation recorded through Communication Hub reference ${project.clientConfirmationReference}.`);
    persist();
  }

  function approveForFiling(project) {
    requireRole("Tax Manager", project, "Filing approval is unavailable.");
    if (project.status !== "Manager Approval" || !approved(project, "TECHNICAL_REVIEW")) throw new Error("Technical review and any required client confirmation must be complete before filing approval.");
    approvalRecord(project, "FILING_AUTHORIZATION", "Tax Manager", "Project approved for filing subject to any Partner escalation.");
    if (project.requiresPartnerApproval) {
      project.status = "Partner Approval";
      alertPosition("TAX_PROJECT_PARTNER_APPROVAL", project, "Engagement Partner", "approve the flagged high-risk Tax Project before filing.");
    } else {
      project.status = "Ready for Filing";
      project.obligations.forEach(obligation => obligation.status = "Ready for Filing");
      alertPosition("TAX_PROJECT_READY_FOR_FILING", project, "Authorized Tax Filer", "the project is ready for iTax filing; record the iTax reference and actual filing date.");
    }
    persist();
  }

  function approvePartner(project) {
    requireRole("Engagement Partner", project, "Partner approval is unavailable.");
    if (project.status !== "Partner Approval" || !approved(project, "FILING_AUTHORIZATION")) throw new Error("Tax Manager filing approval is required before Partner escalation approval.");
    approvalRecord(project, "PARTNER_ESCALATION", "Engagement Partner", "High-risk or PEP escalation cleared for filing.");
    project.status = "Ready for Filing";
    project.obligations.forEach(obligation => obligation.status = "Ready for Filing");
    alertPosition("TAX_PROJECT_READY_FOR_FILING", project, "Authorized Tax Filer", "the project is ready for iTax filing; record the iTax reference and actual filing date.");
    persist();
  }

  function recordFiling(project, obligationCode) {
    if (currentRole() !== "Authorized Tax Filer") throw new Error("Only Authorized Tax Filer may record a submission.");
    if (project.status !== "Ready for Filing") throw new Error("The Tax Project is not authorised for filing.");
    const obligation = project.obligations.find(item => item.code === obligationCode);
    if (!obligation || obligation.status === "Filed") throw new Error("This obligation is unavailable for filing.");
    const filingReference = window.prompt(`Enter the iTax acknowledgement reference for ${obligations[obligationCode].label}:`);
    if (!filingReference) return;
    const filingDate = dateKey(window.prompt("Enter the actual filing date (YYYY-MM-DD):", isoToday()));
    const filingDateValue = new Date(`${filingDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filingDate) || Number.isNaN(filingDateValue.getTime()) || filingDateValue.toISOString().slice(0, 10) !== filingDate) throw new Error("Enter a valid filing date in YYYY-MM-DD format.");
    if (filingDate > isoToday()) throw new Error("The filing date cannot be in the future.");
    filings.push({id: crypto.randomUUID(), projectId: project.id, obligationCode, filingReference: filingReference.trim(), filingDate, filedByRole: currentRole(), filedAt: new Date().toISOString()});
    obligation.status = "Filed";
    if (project.obligations.every(item => item.status === "Filed")) {
      project.status = "Filed";
      project.lockedAt = new Date().toISOString();
      approvalRecord(project, "FILING_EVIDENCE", "Authorized Tax Filer", "All selected obligations have an iTax reference and actual filing date recorded.");
      alertPosition("TAX_PROJECT_PERIOD_LOCKED", project, "Tax Manager", "all selected obligations are filed and the period is locked.");
    }
    persist();
  }

  function amendProject(project) {
    if (currentRole() !== "Tax Manager") throw new Error("Only Tax Manager may open an amendment.");
    if (project.status !== "Filed") throw new Error("Only a filed Tax Project may be amended.");
    const reason = window.prompt("State the amendment reason. The original filing remains locked:");
    if (!reason) return;
    const revision = Math.max(...projects.filter(item => item.engagementId === project.engagementId && item.periodStart === project.periodStart && item.periodEnd === project.periodEnd).map(item => item.revisionNo || 1)) + 1;
    const amendment = {...project, id: crypto.randomUUID(), projectReference: `${project.projectReference}/AMD-${revision}`, status: "Data Collection", lockedAt: null, amendedFromId: project.id, amendmentReason: reason.trim(), revisionNo: revision, createdByRole: "Tax Manager", createdAt: new Date().toISOString(), approvals: [{id: crypto.randomUUID(), stage: "AMENDMENT_OPENED", position: "Tax Manager", status: "Approved", note: reason.trim(), approvedAt: new Date().toISOString()}], obligations: project.obligations.map(item => ({...item, status: "Not Started"}))};
    projects.push(amendment);
    createProjectTasks(amendment);
    project.status = "Amended";
    persist();
    return amendment;
  }

  function projectIdentityText(project) {
    return `<b>${escapeHtml(project.clientName)}</b> · KRA PIN ${escapeHtml(project.taxpayerPin)}<br><span class="hint">${escapeHtml(firmLabel(project.firmId))} · ${escapeHtml(monthLabel(project.periodStart, project.periodEnd))} · ${escapeHtml(project.periodKind)} · ${escapeHtml(project.projectReference)}</span>`;
  }

  function actionButtons(project) {
    const role = currentRole();
    if (project.status === "Identity Review" && role === "Tax Manager") return `<button data-tax-project-action="approve-identity" data-id="${project.id}">Approve client identity</button>`;
    if (project.status === "Data Collection" && role === "Tax Assistant") return `<button data-tax-project-action="submit-review" data-id="${project.id}">Submit for review</button>`;
    if (project.status === "In Review" && role === "Tax Supervisor") return `<button data-tax-project-action="technical-approve" data-id="${project.id}">Approve technical review</button>`;
    if (project.status === "Awaiting Client Confirmation" && role === "Tax Manager") return `<button data-tax-project-action="client-confirmation" data-id="${project.id}">Record client confirmation</button>`;
    if (project.status === "Manager Approval" && role === "Tax Manager") return `<button data-tax-project-action="manager-approve" data-id="${project.id}">Approve for filing</button>`;
    if (project.status === "Partner Approval" && role === "Engagement Partner") return `<button data-tax-project-action="partner-approve" data-id="${project.id}">Approve Partner escalation</button>`;
    if (project.status === "Filed" && role === "Tax Manager") return `<button data-tax-project-action="amend" data-id="${project.id}">Open controlled amendment</button>`;
    return "";
  }

  function renderProjectRegister() {
    const target = document.getElementById("taxProjectRegister");
    if (!target) return;
    const role = currentRole();
    if (!projects.length) {
      target.innerHTML = '<div class="empty">No Tax Projects yet. Select a verified Tax Compliance engagement, then create its first VAT, PAYE, WHT or annual income-tax period.</div>';
      return;
    }
    target.innerHTML = projects.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(project => {
      const control = readiness(project);
      const obligationCards = project.obligations.map(obligation => {
        const filing = projectFilings(project).find(item => item.obligationCode === obligation.code);
        const fileControl = role === "Authorized Tax Filer" && project.status === "Ready for Filing" && obligation.status !== "Filed" ? `<button data-tax-project-action="file" data-id="${project.id}" data-obligation="${obligation.code}">Record filing</button>` : "";
        return `<li><b>${escapeHtml(obligation.label)}</b> <span class="status-pill ${obligation.status === "Filed" ? "" : "review"}">${escapeHtml(obligation.status)}</span>${filing ? `<br><span class="hint">iTax: ${escapeHtml(filing.filingReference)} · Filed: ${escapeHtml(filing.filingDate || dateKey(filing.filedAt))}</span>` : ""}${fileControl}</li>`;
      }).join("");
      const approvals = (project.approvals || []).map(item => `<li>${escapeHtml(item.stage.replace(/_/g, " "))} · ${escapeHtml(item.position)} · ${escapeHtml(item.approvedAt.slice(0, 10))}</li>`).join("") || "<li>Awaiting first approval</li>";
      const missing = control.ready ? "All expected source batches are accepted." : `Outstanding: ${escapeHtml(control.missing.slice(0, 3).join("; "))}${control.missing.length > 3 ? "…" : ""}`;
      return `<article class="tax-project-card ${isLocked(project) ? "locked" : ""}"><div class="tax-project-heading"><div>${projectIdentityText(project)}</div><span class="status-pill ${project.status === "Filed" ? "" : project.status.includes("Approval") || project.status === "In Review" ? "review" : "partial"}">${escapeHtml(project.status)}</span></div><div class="tax-project-columns"><div><h4>Obligation periods</h4><ul>${obligationCards}</ul></div><div><h4>Controls</h4><p class="hint">${missing}</p><p class="hint">Identity: ${escapeHtml(project.identityStatus)}${project.requiresClientConfirmation ? " · Client confirmation required" : ""}${project.requiresPartnerApproval ? " · Partner escalation required" : ""}</p><div class="client-actions">${actionButtons(project)}</div></div><div><h4>Approval trail</h4><ul>${approvals}</ul></div></div></article>`;
    }).join("");
  }

  function renderBatchRegister() {
    const target = document.getElementById("taxProjectBatchTable");
    if (!target) return;
    target.innerHTML = batches.length ? batches.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(batch => {
      const project = projectById(batch.projectId);
      const counts = batch.noActivity ? "No activity declaration" : `${batch.recordCount || 0} new item(s), ${batch.duplicateRowCount || 0} duplicate(s) skipped, ${batch.sourceRowCount || 0} row(s) read`;
      return `<tr><td><b>${escapeHtml(project?.clientName || "Archived client")}</b><br><span class="hint">${escapeHtml(project?.projectReference || "—")}</span></td><td>${escapeHtml(obligations[batch.obligationCode]?.label || batch.obligationCode)}<br><span class="hint">${escapeHtml(sourceLabel(batch.sourceType))}</span></td><td>${escapeHtml(batch.periodKey)}</td><td>${batch.noActivity ? "No activity declaration" : escapeHtml(batch.fileReference)}<br><span class="hint">${escapeHtml(batch.worksheetName || "Workbook")} · ${escapeHtml(counts)}</span></td><td><span class="status-pill">${escapeHtml(batch.status)}</span></td></tr>`;
    }).join("") : '<tr><td colspan="5" class="hint">No controlled source batches recorded.</td></tr>';
  }

  function renderTaskRegister() {
    const target = document.getElementById("taxProjectTaskTable");
    if (!target) return;
    target.innerHTML = tasks.length ? tasks.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(task => {
      const project = projectById(task.projectId);
      return `<tr><td>${escapeHtml(project?.clientName || "Archived client")}<br><span class="hint">${escapeHtml(obligations[task.obligationCode]?.label || task.obligationCode)}</span></td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.assignedPosition)}</td><td>${escapeHtml(task.dueDate)}</td><td><span class="status-pill ${task.status === "Completed" ? "" : "review"}">${escapeHtml(task.status)}</span></td></tr>`;
    }).join("") : '<tr><td colspan="5" class="hint">Tasks are generated when a Tax Manager verifies the client identity and obligation scope.</td></tr>';
  }

  function renderTaskEvidenceRegister() {
    const target = document.getElementById("taxTaskEvidenceTable");
    if (!target) return;
    target.innerHTML = taskEvidence.length ? taskEvidence.slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map(evidence => {
      const project = projectById(evidence.projectId);
      const task = tasks.find(item => item.id === evidence.taskId);
      return `<tr><td><b>${escapeHtml(project?.clientName || "Archived client")}</b><br><span class="hint">${escapeHtml(project?.projectReference || "—")}</span></td><td>${escapeHtml(task?.title || "Archived task")}</td><td>${escapeHtml(evidence.fileName)}<br><span class="hint">${escapeHtml(evidence.fileHash.slice(0, 20))}…</span></td><td>${escapeHtml(evidence.uploadedByRole)}<br><span class="hint">${new Date(evidence.uploadedAt).toLocaleString("en-KE")}</span></td></tr>`;
    }).join("") : '<tr><td colspan="4" class="hint">No PDF task evidence has been attached.</td></tr>';
  }

  function setMetric(id, value) {
    const target = document.getElementById(id);
    if (target) target.textContent = value;
  }

  function refreshProjectForm() {
    const engagementSelect = document.getElementById("taxProjectEngagement");
    if (!engagementSelect) return;
    const prior = engagementSelect.value;
    engagementSelect.innerHTML = `<option value="">Select Tax Compliance engagement…</option>${activeTaxEngagements().map(engagement => {
      const client = taxClientFor(engagement);
      const pin = taxProfileFor(client)?.taxpayerPin;
      return `<option value="${escapeHtml(engagement.id)}">${escapeHtml(engagement.companyName)}${pin ? ` · ${escapeHtml(pin)}` : " · PIN not verified"} · ${escapeHtml(firmLabel(engagement.firmId))}</option>`;
    }).join("")}`;
    if ([...engagementSelect.options].some(option => option.value === prior)) engagementSelect.value = prior;
    const engagement = engagementById(engagementSelect.value);
    const client = taxClientFor(engagement);
    const profile = taxProfileFor(client) || {};
    const identity = document.getElementById("taxProjectIdentityPreview");
    if (identity) identity.innerHTML = engagement && client ? `<b>Selected client:</b> ${escapeHtml(client.companyName)}<br><b>Handling firm:</b> ${escapeHtml(firmLabel(engagement.firmId))}<br><b>Verified PIN:</b> ${escapeHtml(profile.taxpayerPin || "Not yet recorded — Tax Manager approval will establish it.")}<br><span class="hint">The selected engagement is the only source of client and firm identity for this Tax Project.</span>` : "Select an active Tax Compliance engagement. The Tax Project will inherit its client, firm and KYC gate.";
    const pinInput = document.getElementById("taxProjectTaxpayerPin");
    if (pinInput) {pinInput.value = profile.taxpayerPin || ""; pinInput.readOnly = Boolean(profile.taxpayerPin);}
    const annualStart = document.getElementById("taxProjectAnnualStart"), annualEnd = document.getElementById("taxProjectAnnualEnd");
    if (annualStart && !annualStart.value) annualStart.value = profile.financialYearStart || `${new Date().getUTCFullYear()}-01-01`;
    if (annualEnd && !annualEnd.value) annualEnd.value = profile.financialYearEnd || `${new Date().getUTCFullYear()}-12-31`;
    refreshObligationChoices();
  }

  function refreshObligationChoices() {
    const kind = document.getElementById("taxProjectPeriodKind")?.value || "Monthly";
    const engagement = engagementById(document.getElementById("taxProjectEngagement")?.value);
    const client = taxClientFor(engagement);
    const target = document.getElementById("taxProjectObligations");
    const defaults = defaultObligations(client, kind);
    const choices = kind === "Annual" ? ["INCOME_TAX"] : ["VAT", "PAYE", "WHT"];
    if (target) target.innerHTML = choices.map(code => `<label><input type="checkbox" name="obligationCode" value="${code}" ${defaults.includes(code) ? "checked" : ""} />${escapeHtml(obligations[code].label)} <span class="hint">${escapeHtml(obligations[code].frequency)}</span></label>`).join("");
    document.querySelectorAll("[data-tax-period-input]").forEach(node => node.hidden = node.dataset.taxPeriodInput !== kind);
  }

  function refreshBatchForm() {
    const projectSelect = document.getElementById("taxBatchProject");
    if (!projectSelect) return;
    const prior = projectSelect.value;
    const candidates = projects.filter(project => project.status === "Data Collection" && !isLocked(project));
    projectSelect.innerHTML = `<option value="">Select identity-approved Tax Project…</option>${candidates.map(project => `<option value="${project.id}">${escapeHtml(project.clientName)} · ${escapeHtml(monthLabel(project.periodStart, project.periodEnd))} · ${escapeHtml(project.projectReference)}</option>`).join("")}`;
    if ([...projectSelect.options].some(option => option.value === prior)) projectSelect.value = prior;
    const project = projectById(projectSelect.value);
    const obligationSelect = document.getElementById("taxBatchObligation");
    if (obligationSelect) {
      const previousObligation = obligationSelect.value;
      obligationSelect.innerHTML = `<option value="">Select obligation…</option>${(project?.obligations || []).map(obligation => `<option value="${obligation.code}">${escapeHtml(obligation.label)} · ${escapeHtml(obligation.frequency)}</option>`).join("")}`;
      if ([...obligationSelect.options].some(option => option.value === previousObligation)) obligationSelect.value = previousObligation;
    }
    refreshBatchSources();
  }

  function refreshBatchSources() {
    const project = projectById(document.getElementById("taxBatchProject")?.value);
    const obligationCode = document.getElementById("taxBatchObligation")?.value;
    const sourceSelect = document.getElementById("taxBatchSource");
    if (!sourceSelect) return;
    const config = obligations[obligationCode];
    sourceSelect.innerHTML = `<option value="">Select source…</option>${(config?.expectedSources || []).map(code => `<option value="${code}">${escapeHtml(sourceLabel(code))}</option>`).join("")}`;
    const periodKey = document.getElementById("taxBatchPeriodKey");
    if (periodKey && project && !periodKey.value) periodKey.value = obligationCode === "VAT" ? mondayOnOrBefore(project.periodStart) : project.periodStart;
  }

  function refreshTaskEvidenceForm() {
    const projectSelect = document.getElementById("taxTaskEvidenceProject");
    const taskSelect = document.getElementById("taxTaskEvidenceTask");
    if (!projectSelect || !taskSelect) return;
    const prior = projectSelect.value;
    const candidates = projects.filter(project => !isLocked(project));
    projectSelect.innerHTML = `<option value="">Select open Tax Project…</option>${candidates.map(project => `<option value="${project.id}">${escapeHtml(project.clientName)} · ${escapeHtml(project.projectReference)}</option>`).join("")}`;
    if ([...projectSelect.options].some(option => option.value === prior)) projectSelect.value = prior;
    const project = projectById(projectSelect.value);
    taskSelect.innerHTML = `<option value="">Select task…</option>${projectTasks(project || {}).map(task => `<option value="${task.id}">${escapeHtml(task.title)} · ${escapeHtml(task.assignedPosition)}</option>`).join("")}`;
  }

  function render() {
    setMetric("taxProjectActive", projects.filter(project => !["Filed", "Amended"].includes(project.status)).length);
    setMetric("taxProjectReview", projects.filter(project => ["Identity Review", "In Review", "Manager Approval", "Partner Approval", "Awaiting Client Confirmation"].includes(project.status)).length);
    setMetric("taxProjectReady", projects.filter(project => project.status === "Ready for Filing").length);
    setMetric("taxProjectLocked", projects.filter(project => Boolean(project.lockedAt)).length);
    refreshProjectForm();
    refreshBatchForm();
    refreshTaskEvidenceForm();
    renderProjectRegister();
    renderBatchRegister();
    renderTaskRegister();
    renderTaskEvidenceRegister();
  }

  async function handleAction(button) {
    const project = projectById(button.dataset.id);
    if (!project) return;
    try {
      const action = button.dataset.taxProjectAction;
      if (action === "approve-identity") approveIdentity(project);
      if (action === "submit-review") submitForReview(project);
      if (action === "technical-approve") approveTechnicalReview(project);
      if (action === "client-confirmation") recordClientConfirmation(project);
      if (action === "manager-approve") approveForFiling(project);
      if (action === "partner-approve") approvePartner(project);
      if (action === "file") await recordFiling(project, button.dataset.obligation);
      if (action === "amend") amendProject(project);
      render();
      if (typeof renderDashboard === "function") renderDashboard();
      notice(action === "file" ? "iTax reference and actual filing date recorded. A filing PDF is not required." : "Tax Project action completed.");
    } catch (error) {notice(error.message, true);}
  }

  function inject() {
    if (document.getElementById("tax-projects")) return;
    const nav = document.querySelector(".tabs");
    const shell = document.querySelector(".shell");
    if (!nav || !shell) return;
    const tab = document.createElement("button");
    const section = document.createElement("section");
    const before = nav.querySelector("[data-tab='recurring-task-engine']") || nav.querySelector("[data-tab='operations']");
    tab.className = "tab";
    tab.type = "button";
    tab.dataset.tab = "tax-projects";
    tab.innerHTML = '<svg class="nav-icon" aria-hidden="true"><use href="#icon-briefcase" /></svg>Tax projects';
    section.id = "tax-projects";
    section.className = "tab-panel";
    section.innerHTML = `
      <div class="intro"><div><h2>Tax Projects</h2><p>Controlled tax work by engagement, statutory obligation and reporting period. Select the verified client through its Tax Compliance engagement; no source batch, approval or filing can move to another client or firm.</p></div><label class="tax-role-switch">Preview position<select id="taxProjectPreviewRole">${positions.map(position => `<option>${position}</option>`).join("")}</select></label></div>
      <div class="notice" id="taxProjectNotice" role="status"></div>
      <div class="metric-grid"><div class="card metric-card"><b id="taxProjectActive">0</b><span>Open Tax Projects</span></div><div class="card metric-card"><b id="taxProjectReview">0</b><span>Awaiting approval</span></div><div class="card metric-card"><b id="taxProjectReady">0</b><span>Ready for filing</span></div><div class="card metric-card"><b id="taxProjectLocked">0</b><span>Filed and locked</span></div></div>
      <div class="operations-layout"><form id="taxProjectForm" class="card form-card"><div class="section-heading"><h3>Open Tax Project</h3><span class="hint">Client and firm are inherited, never typed independently</span></div><div class="grid"><label class="full">Verified Tax Compliance engagement <span>*</span><select required name="engagementId" id="taxProjectEngagement"></select></label><div class="full tax-project-identity" id="taxProjectIdentityPreview"></div><label>Period type <select name="periodKind" id="taxProjectPeriodKind"><option value="Monthly">Monthly VAT / PAYE / WHT</option><option value="Annual">Annual Income Tax</option></select></label><label data-tax-period-input="Monthly">Reporting month <span>*</span><input required type="month" name="periodMonth" id="taxProjectMonth" /></label><label data-tax-period-input="Annual" hidden>Financial year start <span>*</span><input type="date" name="annualPeriodStart" id="taxProjectAnnualStart" /></label><label data-tax-period-input="Annual" hidden>Financial year end <span>*</span><input type="date" name="annualPeriodEnd" id="taxProjectAnnualEnd" /></label><label>Verified KRA PIN <span>*</span><input required name="taxpayerPin" id="taxProjectTaxpayerPin" placeholder="P000000000A" /></label><label>Confirm legal name exactly <span>*</span><input required name="confirmedLegalName" id="taxProjectConfirmName" placeholder="Legal registered name" /></label><div class="full"><label>Obligations in this period <span>*</span></label><div class="choice-list" id="taxProjectObligations"></div></div><label class="checkbox-line full"><input type="checkbox" name="requiresClientConfirmation" />Client confirmation required before filing</label><label class="checkbox-line full"><input type="checkbox" name="requiresPartnerApproval" />High-risk / PEP escalation requires Engagement Partner approval</label></div><div class="actions"><button class="btn primary" type="submit">Create controlled Tax Project</button></div></form><div class="card side-card"><div class="section-heading"><h3>Approval policy</h3><span class="hint">No self-approval</span></div><ol class="tax-project-policy"><li>Tax Assistant creates and collects controlled batches.</li><li>Tax Manager verifies the client, KRA PIN, engagement and obligation scope.</li><li>Tax Supervisor approves technical review.</li><li>Tax Manager authorises filing; Partner approval is added for high-risk work.</li><li>Authorized Tax Filer records the iTax acknowledgement reference and actual filing date. A filing PDF is optional and never blocks the filing record.</li></ol><p class="hint">The role switch is a browser-preview demonstration. Production uses authenticated position-based permissions.</p></div></div>
      <div class="operations-layout"><form id="taxBatchForm" class="card form-card"><div class="section-heading"><h3>Upload source workbook</h3><span class="hint">Reads rows, accepts new items only, staging never posts to the TB or return</span></div><div class="grid"><label class="full">Tax Project <span>*</span><select required name="projectId" id="taxBatchProject"></select></label><label>Obligation <span>*</span><select required name="obligationCode" id="taxBatchObligation"></select></label><label>Source <span>*</span><select required name="sourceType" id="taxBatchSource"></select></label><label>Week start / period key <span>*</span><input required type="date" name="batchPeriodKey" id="taxBatchPeriodKey" /></label><label class="full">Excel working paper / schedule <span>*</span><input type="file" name="workingPaperFile" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" /></label><label class="full">Vault reference <input name="fileReference" placeholder="Optional controlled Vault reference; filename is recorded automatically" /></label><label class="full">File hash <input name="fileHash" placeholder="Optional; calculated automatically if blank" /></label><label class="checkbox-line full"><input type="checkbox" name="noActivity" />No activity for this source/week — record the controlled reason above; no workbook is required</label></div><div class="actions"><button class="btn primary" type="submit">Read workbook and accept new items</button></div></form><div class="card side-card"><div class="section-heading"><h3>Row-level import rules</h3><span class="hint">Duplicate rows are skipped automatically</span></div><ul class="tax-project-policy"><li>Upload an <b>.xlsx</b> or <b>.xlsm</b> workbook with a header row. Legacy <b>.xls</b> must first be saved as .xlsx.</li><li>The importer uses transaction/reference fields where available, otherwise the normalised row values, to identify duplicates.</li><li>Only new rows are accepted. The result shows total rows read, new rows and duplicates skipped.</li><li>Client support and other documentary evidence remains PDF-only and separate from the workbook import.</li></ul></div></div>
      <div class="operations-layout"><form id="taxTaskEvidenceForm" class="card form-card"><div class="section-heading"><h3>Attach task evidence</h3><span class="hint">PDF evidence is linked to a specific tax task</span></div><div class="grid"><label class="full">Tax Project <span>*</span><select required name="projectId" id="taxTaskEvidenceProject"></select></label><label class="full">Task <span>*</span><select required name="taskId" id="taxTaskEvidenceTask"></select></label><label class="full">PDF documentary evidence <span>*</span><input required type="file" name="taskEvidenceFile" accept=".pdf,application/pdf" /></label></div><div class="actions"><button class="btn primary" type="submit">Attach PDF evidence</button></div></form><div class="card side-card"><div class="section-heading"><h3>Evidence controls</h3><span class="hint">Audit-ready, task-specific records</span></div><ul class="tax-project-policy"><li>The assigned position or Tax Manager attaches evidence.</li><li>Each PDF is SHA-256 hashed before it is registered.</li><li>Filed project evidence stays locked; corrections use an amendment.</li></ul></div></div>
      <div class="section"><div class="section-heading"><h3>Tax Project register</h3><span class="hint">The client identity, firm and period remain visible at every approval stage</span></div><div id="taxProjectRegister" class="tax-project-register"></div></div>
      <div class="section"><div class="section-heading"><h3>Controlled source batches</h3><span class="hint">Accepted batches feed the working-paper review; they are not live postings</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Client / project</th><th>Obligation / source</th><th>Week / period</th><th>Evidence</th><th>Status</th></tr></thead><tbody id="taxProjectBatchTable"></tbody></table></div></div>
      <div class="section"><div class="section-heading"><h3>Obligation-driven task plan</h3><span class="hint">Task recurrence is generated from each obligation, not from one generic engagement status</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Client / obligation</th><th>Task</th><th>Assigned position</th><th>Due date</th><th>Status</th></tr></thead><tbody id="taxProjectTaskTable"></tbody></table></div></div>
      <div class="section"><div class="section-heading"><h3>PDF task evidence register</h3><span class="hint">Evidence is retained separately from Excel calculations and schedules</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Client / project</th><th>Task</th><th>PDF evidence</th><th>Uploaded by</th></tr></thead><tbody id="taxTaskEvidenceTable"></tbody></table></div></div>`;
    if (before) nav.insertBefore(tab, before); else nav.append(tab);
    shell.append(section);
    tab.addEventListener("click", () => {document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button === tab));document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel === section));render();});
    document.getElementById("taxProjectPreviewRole").addEventListener("change", render);
    document.getElementById("taxProjectEngagement").addEventListener("change", refreshProjectForm);
    document.getElementById("taxProjectPeriodKind").addEventListener("change", refreshObligationChoices);
    document.getElementById("taxBatchProject").addEventListener("change", refreshBatchForm);
    document.getElementById("taxBatchObligation").addEventListener("change", refreshBatchSources);
    document.getElementById("taxTaskEvidenceProject").addEventListener("change", refreshTaskEvidenceForm);
    document.getElementById("taxProjectForm").addEventListener("submit", event => {event.preventDefault();try {const project = createProject(new FormData(event.currentTarget));event.currentTarget.reset();document.getElementById("taxProjectMonth").value = isoToday().slice(0, 7);render();notice(`${project.projectReference} created. It is awaiting Tax Manager identity approval.`);} catch (error) {notice(error.message, true);}});
    document.getElementById("taxBatchForm").addEventListener("submit", async event => {event.preventDefault();try {const batch = await recordBatch(new FormData(event.currentTarget));event.currentTarget.reset();render();notice(batch.noActivity ? "No Activity declaration accepted." : `${batch.recordCount} new item(s) uploaded. ${batch.duplicateRowCount} duplicate row(s) skipped from ${batch.sourceRowCount} row(s) read.`);} catch (error) {notice(error.message, true);}});
    document.getElementById("taxTaskEvidenceForm").addEventListener("submit", async event => {event.preventDefault();try {await recordTaskEvidence(new FormData(event.currentTarget));event.currentTarget.reset();render();notice("PDF task evidence attached and hashed.");} catch (error) {notice(error.message, true);}});
    document.getElementById("taxProjectRegister").addEventListener("click", async event => {const button = event.target.closest("button[data-tax-project-action]"); if (button) await handleAction(button);});
    document.head.insertAdjacentHTML("beforeend", `<style>
      .tax-role-switch{min-width:195px;font-size:.85rem}.tax-project-identity{padding:13px;border:1px solid #dfe8e3;border-radius:8px;background:#f7faf8;line-height:1.55}.tax-project-register{display:grid;gap:14px}.tax-project-card{background:#fff;border:1px solid #dfe8e3;border-left:5px solid #2d7558;border-radius:10px;padding:16px}.tax-project-card.locked{border-left-color:#4b7298;background:#fbfcfe}.tax-project-heading{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.tax-project-columns{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:18px;margin-top:14px}.tax-project-columns h4{margin:0 0 7px}.tax-project-columns ul,.tax-project-policy{margin:0;padding-left:20px}.tax-project-columns li,.tax-project-policy li{margin:6px 0}.tax-project-columns button{margin:7px 0 0}.tax-project-error{background:#fbe8e8!important;color:#8b2828!important}@media(max-width:800px){.tax-project-columns{grid-template-columns:1fr}.tax-project-heading{display:block}.tax-role-switch{width:100%;margin-top:12px}}
    </style>`);
    document.getElementById("taxProjectMonth").value = isoToday().slice(0, 7);
    render();
  }

  inject();
  // The main dashboard may initialise before this deferred Tax Project module.
  // Notify it once the read-only workspace bridge is available so the logged-in
  // user's task, filing and pending-upload cards immediately include tax work.
  window.dispatchEvent(new CustomEvent("pcl:tax-projects-updated"));
})();
