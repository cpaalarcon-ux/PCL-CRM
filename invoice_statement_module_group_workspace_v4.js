(() => {
  "use strict";

  const statementStorageKey = "pcl-crm-customer-statements-v1";
  const groupRelationshipFirmId = "__GROUP_RELATIONSHIP__";
  let statementSnapshots = safeLoad(statementStorageKey);
  let activeStatementId = null;

  function safeLoad(key) {
    try { const stored = localStorage.getItem(key); return stored ? JSON.parse(stored) : []; }
    catch (_) { return []; }
  }
  function saveStatements() {
    localStorage.setItem(statementStorageKey, JSON.stringify(statementSnapshots));
    if (typeof saveOperations === "function") saveOperations();
    window.dispatchEvent(new CustomEvent("pcl:invoices-statements-updated"));
  }
  function invoiceEngagement(invoice) { return typeof engagementById === "function" ? engagementById(invoice.engagementId) : null; }
  function invoiceFirmId(invoice) { return invoice.firmId || invoiceEngagement(invoice)?.firmId || ""; }
  function invoiceClientKey(invoice) { return invoice.clientId || `company:${String(invoiceEngagement(invoice)?.companyName || "unlinked").trim().toLowerCase()}`; }
  function invoiceClientName(invoice) { return invoiceEngagement(invoice)?.companyName || invoice.contactSnapshot?.companyName || "Archived client"; }
  function invoiceFirmName(invoice) { return invoice.firmName || (typeof firmLabel === "function" ? firmLabel(invoiceFirmId(invoice)) : "Firm not set"); }
  function gross(invoice) { return typeof invoiceGross === "function" ? invoiceGross(invoice) : Number(invoice.amountBilled || 0) + Number(invoice.vatAmount || 0); }
  function validPayments(invoice, asAt = "", includeReview = true) {
    const rows = (typeof invoicePayments === "undefined" ? [] : invoicePayments).filter(payment => payment.invoiceId === invoice.id && payment.status !== "Rejected" && (includeReview || payment.status === "Matched"));
    return asAt ? rows.filter(payment => payment.dateReceived <= asAt) : rows;
  }
  function paidAmount(invoice, asAt = "", includeReview = true) { return validPayments(invoice, asAt, includeReview).reduce((sum, payment) => sum + Number(payment.amountReceived || 0), 0); }
  function hasInvoiceReferencePrefix(invoice, reference) { return typeof paymentReferenceStartsWithInvoice === "function" ? paymentReferenceStartsWithInvoice(invoice.invoiceNumber, reference) : String(reference || "").trim().toUpperCase().startsWith(String(invoice.invoiceNumber || "").trim().toUpperCase()); }
  function paymentMethodLabel(value) { return ({ CASH: "Cash", MPESA: "M-Pesa", BANK_TRANSFER: "Bank Transfer", CHEQUE: "Cheque" })[value] || "Bank Transfer"; }
  function invoiceStatus(invoice) {
    const value = typeof calculatedInvoiceStatus === "function" ? calculatedInvoiceStatus(invoice) : invoice.status;
    if (invoice.invoiceType === "Credit Note") return "Credit Note";
    if (value === "Issued") return "Unpaid";
    if (value === "Partially Paid") return "Partial";
    if (value === "Reconciliation Review") return "Review";
    return value || "Draft";
  }
  function invoiceMatchesStatus(invoice, filter) { return !filter || invoiceStatus(invoice).toUpperCase().replaceAll(" ", "_") === filter; }
  function isPostedInvoice(invoice) { return !["Draft", "Cancelled"].includes(invoiceStatus(invoice)); }
  function isCreditNote(invoice) { return invoice.invoiceType === "Credit Note"; }
  function format(value) { return typeof formatKes === "function" ? formatKes(value) : `KES ${Number(value || 0).toLocaleString()}`; }
  function esc(value) { return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char])); }
  function today() { return typeof operationDate === "function" ? operationDate() : new Date().toISOString().slice(0, 10); }
  function firstOfMonth(date = today()) { return `${date.slice(0, 7)}-01`; }
  function setText(id, value) { const node = document.getElementById(id); if (node) node.textContent = value; }
  function showNotice(message, error = false) {
    const notice = document.getElementById("invoiceStatementNotice");
    if (!notice) return;
    notice.textContent = message;
    notice.classList.add("show");
    notice.style.background = error ? "#fbe8e8" : "";
    notice.style.borderColor = error ? "#d8aaaa" : "";
    notice.style.color = error ? "#8b2828" : "";
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => notice.classList.remove("show"), 8500);
  }
  function scopedInvoices() {
    const firm = document.getElementById("invoiceRegisterFirm")?.value || "";
    const status = document.getElementById("invoiceRegisterStatus")?.value || "";
    const search = String(document.getElementById("invoiceRegisterSearch")?.value || "").trim().toLowerCase();
    return (typeof invoices === "undefined" ? [] : invoices).filter(invoice => {
      const text = [invoice.invoiceNumber, invoiceClientName(invoice), invoiceFirmName(invoice), invoice.serviceDescription, invoice.paymentReference].join(" ").toLowerCase();
      return (!firm || invoiceFirmId(invoice) === firm) && invoiceMatchesStatus(invoice, status) && (!search || text.includes(search));
    }).sort((a, b) => String(b.dateIssued || "").localeCompare(String(a.dateIssued || "")));
  }
  function isGroupRelationshipView(firmId) { return firmId === groupRelationshipFirmId; }
  function clientOptions(firmId) {
    const unique = new Map();
    (typeof invoices === "undefined" ? [] : invoices).filter(invoice => !firmId || isGroupRelationshipView(firmId) || invoiceFirmId(invoice) === firmId).forEach(invoice => {
      const key = invoiceClientKey(invoice);
      if (!unique.has(key)) unique.set(key, { key, name: invoiceClientName(invoice), firmId: invoiceFirmId(invoice) });
    });
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function syncStatementClientOptions() {
    const firm = document.getElementById("statementFirm");
    const client = document.getElementById("statementClient");
    if (!firm || !client) return;
    const previous = client.value;
    client.innerHTML = `<option value="">Select client with invoice activity…</option>${clientOptions(firm.value).map(item => `<option value="${esc(item.key)}">${esc(item.name)}</option>`).join("")}`;
    if ([...client.options].some(option => option.value === previous)) client.value = previous;
  }
  function statementFirmOptions(selectId, includeAll = false, includeRelationshipSummary = false) {
    const target = document.getElementById(selectId);
    if (!target) return;
    const old = target.value;
    const firms = typeof activeFirms === "function" ? activeFirms() : [];
    const relationshipOption = includeRelationshipSummary ? `<option value="${groupRelationshipFirmId}">All firms — relationship summary</option>` : "";
    target.innerHTML = `${includeAll ? '<option value="">All firms</option>' : '<option value="">Select issuing firm…</option>'}${relationshipOption}${firms.map(firm => `<option value="${esc(firm.id)}">${esc(firmLabel(firm.id))}</option>`).join("")}`;
    if ([...target.options].some(option => option.value === old)) target.value = old;
  }
  function statementTransactions({ firmId, clientKey, startDate, endDate }) {
    const sourceInvoices = (typeof invoices === "undefined" ? [] : invoices).filter(invoice => (isGroupRelationshipView(firmId) || invoiceFirmId(invoice) === firmId) && invoiceClientKey(invoice) === clientKey && isPostedInvoice(invoice));
    const rows = [];
    sourceInvoices.forEach(invoice => {
      const issuedByFirmId = invoiceFirmId(invoice), issuedByFirmName = invoiceFirmName(invoice);
      rows.push({ date: invoice.dateIssued, sequence: 1, kind: isCreditNote(invoice) ? "Credit Note" : "Invoice", reference: invoice.invoiceNumber, description: invoice.serviceDescription || "Professional services", debit: isCreditNote(invoice) ? 0 : gross(invoice), credit: isCreditNote(invoice) ? gross(invoice) : 0, invoiceId: invoice.id, firmId: issuedByFirmId, firmName: issuedByFirmName });
      validPayments(invoice, "", false).forEach(payment => rows.push({ date: payment.dateReceived, sequence: 2, kind: "Payment", reference: payment.paymentReference || `PAY/${String(payment.id).slice(0, 8)}`, description: `Client payment · ${paymentMethodLabel(payment.paymentMethod)}`, debit: 0, credit: Number(payment.amountReceived || 0), invoiceId: invoice.id, paymentId: payment.id, firmId: issuedByFirmId, firmName: issuedByFirmName }));
    });
    const allRows = rows.filter(row => row.date && row.date <= endDate).sort((a, b) => `${a.date}-${a.sequence}-${a.reference}`.localeCompare(`${b.date}-${b.sequence}-${b.reference}`));
    let opening = 0;
    allRows.filter(row => row.date < startDate).forEach(row => { opening += Number(row.debit) - Number(row.credit); });
    let running = opening;
    const periodRows = allRows.filter(row => row.date >= startDate).map(row => ({ ...row, balance: (running += Number(row.debit) - Number(row.credit)) }));
    const firmBalances = {};
    allRows.forEach(row => { const bucket = firmBalances[row.firmId] || { firmId: row.firmId, firmName: row.firmName, balance: 0 }; bucket.balance += Number(row.debit) - Number(row.credit); firmBalances[row.firmId] = bucket; });
    return { sourceInvoices, opening, periodRows, closing: running, firmBalances: Object.values(firmBalances) };
  }
  function agingSummary(sourceInvoices, asAt) {
    const buckets = { current: 0, days31to60: 0, days60plus: 0 };
    sourceInvoices.filter(invoice => !isCreditNote(invoice) && invoice.dateIssued <= asAt).forEach(invoice => {
      const balance = Math.max(0, gross(invoice) - paidAmount(invoice, asAt, false));
      if (!balance) return;
      const age = Math.max(0, Math.floor((new Date(`${asAt}T00:00:00Z`) - new Date(`${invoice.dateIssued}T00:00:00Z`)) / 86400000));
      if (age <= 30) buckets.current += balance;
      else if (age <= 60) buckets.days31to60 += balance;
      else buckets.days60plus += balance;
    });
    return buckets;
  }
  function statementReference(kind = "FIRM") {
    const year = today().slice(0, 4);
    const prefix = `${kind === "GROUP" ? "GRS" : "STM"}/${year}/`;
    const high = statementSnapshots.reduce((value, item) => Math.max(value, Number(String(item.reference || "").replace(prefix, "")) || 0), 0);
    return `${prefix}${String(high + 1).padStart(4, "0")}`;
  }
  async function integrityHash(value) {
    if (!window.crypto?.subtle) return "Browser preview hash unavailable";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  async function generateStatement() {
    const firmId = document.getElementById("statementFirm")?.value || "";
    const clientKey = document.getElementById("statementClient")?.value || "";
    const startDate = document.getElementById("statementStart")?.value || "";
    const endDate = document.getElementById("statementEnd")?.value || "";
    if (!firmId || !clientKey || !startDate || !endDate || endDate < startDate) { showNotice("Select an issuing firm or the all-firms relationship summary, client and valid statement date range.", true); return; }
    const customer = clientOptions(firmId).find(item => item.key === clientKey);
    const result = statementTransactions({ firmId, clientKey, startDate, endDate });
    const sourceInvoice = result.sourceInvoices[0];
    const relationshipSummary = isGroupRelationshipView(firmId);
    const snapshot = {
      id: crypto.randomUUID(), reference: statementReference(relationshipSummary ? "GROUP" : "FIRM"), firmId, firmName: relationshipSummary ? "Practice Group relationship summary" : (sourceInvoice ? invoiceFirmName(sourceInvoice) : (typeof firmLabel === "function" ? firmLabel(firmId) : "Firm")), clientKey, clientName: customer?.name || "Client", engagementId: sourceInvoice?.engagementId || null,
      periodStart: startDate, periodEnd: endDate, statementDate: today(), currency: "KES", openingBalance: result.opening, closingBalance: result.closing, lines: result.periodRows, aging: agingSummary(result.sourceInvoices, endDate),
      generatedByPosition: "Practice Administration", status: "GENERATED", createdAt: new Date().toISOString(), deliveryEvents: [], legalStatement: !relationshipSummary, statementKind: relationshipSummary ? "GROUP_RELATIONSHIP_SUMMARY" : "FIRM_STATEMENT", firmBalances: result.firmBalances, sourceFirmIds: [...new Set(result.sourceInvoices.map(invoiceFirmId))]
    };
    snapshot.integrityHash = await integrityHash({ ...snapshot, integrityHash: undefined, deliveryEvents: [] });
    statementSnapshots.push(snapshot);
    activeStatementId = snapshot.id;
    saveStatements();
    render();
    showNotice(relationshipSummary ? `${snapshot.reference} generated as a group relationship summary. It displays each issuing firm and is not a legal firm statement.` : `${snapshot.reference} generated as an immutable firm statement snapshot. Use Print / Save PDF or Email to Client.`);
  }
  function currentStatement() { return statementSnapshots.find(item => item.id === activeStatementId) || statementSnapshots.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null; }
  function statusClass(status) { return ["Paid"].includes(status) ? "" : ["Partial", "Review"].includes(status) ? "partial" : ["Overdue", "Unpaid"].includes(status) ? "overdue" : "neutral"; }
  function renderInvoiceRegister() {
    const rows = scopedInvoices();
    const target = document.getElementById("invoiceStatementRows");
    if (!target) return;
    target.innerHTML = rows.length ? rows.map(invoice => {
      const status = invoiceStatus(invoice), balance = Math.max(0, gross(invoice) - paidAmount(invoice));
      return `<tr><td><b>${esc(invoice.invoiceNumber)}</b><br><span class="hint">${esc(invoice.serviceDescription || "Professional services")}</span></td><td>${esc(invoiceClientName(invoice))}</td><td>${esc(invoiceFirmName(invoice))}</td><td>${esc(invoice.dateIssued || "—")}<br><span class="hint">Due: ${esc(invoice.dueDate || "—")}</span></td><td>${format(gross(invoice))}</td><td>${format(balance)}</td><td><span class="status-pill ${statusClass(status)}">${esc(status)}</span></td><td><div class="invoice-statement-actions"><button type="button" data-invoice-statement-action="statement" data-id="${esc(invoice.id)}">Statement</button>${["Unpaid", "Partial", "Review", "Overdue"].includes(status) ? `<button type="button" data-invoice-statement-action="reconcile" data-id="${esc(invoice.id)}">Auto-reconcile</button>` : ""}<button type="button" data-invoice-statement-action="email" data-id="${esc(invoice.id)}">Email</button></div></td></tr>`;
    }).join("") : '<tr><td colspan="8" class="hint">No invoices match the selected firm, status or search term.</td></tr>';
    setText("invoiceStatementShowing", `Showing ${rows.length} invoice${rows.length === 1 ? "" : "s"}`);
    setText("invoiceStatementTotal", format(rows.reduce((sum, invoice) => sum + gross(invoice), 0)));
    setText("invoiceStatementOutstanding", format(rows.reduce((sum, invoice) => sum + Math.max(0, gross(invoice) - paidAmount(invoice)), 0)));
    setText("invoiceStatementOverdue", rows.filter(invoice => invoiceStatus(invoice) === "Overdue").length);
    setText("invoiceStatementPaid", rows.filter(invoice => invoiceStatus(invoice) === "Paid").length);
  }
  function renderStatementPreview() {
    const target = document.getElementById("statementPreview");
    if (!target) return;
    const statement = currentStatement();
    if (!statement) { target.innerHTML = '<div class="empty">Select a firm or all-firms relationship summary, client and period, then generate a controlled snapshot.</div>'; return; }
    const relationshipSummary = statement.legalStatement === false || statement.statementKind === "GROUP_RELATIONSHIP_SUMMARY";
    const amount = value => `${value < 0 ? "CR " : "DR "}${format(Math.abs(value))}`;
    const firmColumn = relationshipSummary ? "<th>Issuing firm</th>" : "";
    const firmCell = line => relationshipSummary ? `<td>${esc(line.firmName || "Firm")}</td>` : "";
    const firmBreakdown = relationshipSummary ? `<div class="statement-aging"><b>Balance by issuing firm</b>${(statement.firmBalances || []).map(item => `<span>${esc(item.firmName)}: ${amount(item.balance)}</span>`).join("") || "<span>No firm movements.</span>"}</div>` : "";
    const deliveryAction = relationshipSummary ? "" : `<button type="button" data-statement-action="email" data-id="${esc(statement.id)}">Email client</button>`;
    const controlNote = relationshipSummary ? "This is a cross-firm relationship summary. Each invoice, payment and balance remains attributable to its issuing firm. It is not a tax invoice or legal firm statement." : "This is an immutable firm statement. Delivery is logged through the Communication Hub; payments awaiting reconciliation are excluded until matched.";
    target.innerHTML = `<div class="statement-heading"><div><span class="status-pill neutral">${esc(statement.reference)}</span><h3>${relationshipSummary ? "Client relationship summary" : "Statement of account"}</h3><p><b>${relationshipSummary ? "View:" : "Issued by:"}</b> ${esc(statement.firmName)}<br><b>Client:</b> ${esc(statement.clientName)}<br><b>Period:</b> ${esc(statement.periodStart)} to ${esc(statement.periodEnd)} · <b>Currency:</b> KES</p></div><div class="statement-actions"><button type="button" data-statement-action="print" data-id="${esc(statement.id)}">Print / Save PDF</button>${deliveryAction}</div></div><div class="statement-balance"><span>Opening balance <b>${amount(statement.openingBalance)}</b></span><span>Closing balance <b>${amount(statement.closingBalance)}</b></span></div>${firmBreakdown}<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Reference</th>${firmColumn}<th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${statement.lines.length ? statement.lines.map(line => `<tr><td>${esc(line.date)}</td><td>${esc(line.reference)}</td>${firmCell(line)}<td>${esc(line.description)}</td><td>${line.debit ? format(line.debit) : "—"}</td><td>${line.credit ? format(line.credit) : "—"}</td><td>${format(line.balance)}</td></tr>`).join("") : `<tr><td colspan="${relationshipSummary ? 7 : 6}" class="hint">No posted invoice, payment or credit-note movements in this period.</td></tr>`}</tbody></table></div><p class="hint">Integrity hash: ${esc(statement.integrityHash)}. ${controlNote}</p>`;
  }
  function renderStatementHistory() {
    const target = document.getElementById("statementHistoryRows");
    if (!target) return;
    target.innerHTML = statementSnapshots.length ? statementSnapshots.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(item => `<tr><td><b>${esc(item.reference)}</b><br><span class="hint">${esc(item.statementDate)}</span></td><td>${esc(item.clientName)}</td><td>${esc(item.firmName)}</td><td>${esc(item.periodStart)} to ${esc(item.periodEnd)}</td><td>${format(item.closingBalance)}</td><td><span class="status-pill neutral">${esc(item.status)}</span></td><td><button type="button" data-statement-history="view" data-id="${esc(item.id)}">View</button> <button type="button" data-statement-history="print" data-id="${esc(item.id)}">Print</button></td></tr>`).join("") : '<tr><td colspan="7" class="hint">No statement snapshots have been generated.</td></tr>';
  }
  function refreshPaymentInvoiceOptions() {
    const target = document.getElementById("receivablePaymentInvoice");
    if (!target) return;
    const previous = target.value;
    const open = (typeof invoices === "undefined" ? [] : invoices).filter(invoice => !["Paid", "Cancelled", "Credit Note"].includes(invoiceStatus(invoice)));
    target.innerHTML = `<option value="">Select open invoice…</option>${open.map(invoice => `<option value="${esc(invoice.id)}">${esc(invoice.invoiceNumber)} · ${esc(invoiceClientName(invoice))} · balance ${esc(format(Math.max(0, gross(invoice) - paidAmount(invoice))))}</option>`).join("")}`;
    if ([...target.options].some(option => option.value === previous)) target.value = previous;
  }
  function render() { statementFirmOptions("invoiceRegisterFirm", true); statementFirmOptions("statementFirm", false, true); syncStatementClientOptions(); refreshPaymentInvoiceOptions(); renderInvoiceRegister(); renderStatementPreview(); renderStatementHistory(); }
  function recordPayment(form) {
    const data = new FormData(form), invoice = (typeof invoices === "undefined" ? [] : invoices).find(item => item.id === data.get("invoiceId"));
    const amount = Number(data.get("amount") || 0), received = data.get("dateReceived"), reference = data.get("paymentReference").trim();
    if (!invoice || !amount || !received || !reference) { showNotice("Select an invoice and provide the receipt amount, date, payment method and reference.", true); return; }
    if (!hasInvoiceReferencePrefix(invoice, reference)) { showNotice(`Receipt reference must begin with invoice number ${invoice.invoiceNumber}.`, true); return; }
    const balance = Math.max(0, gross(invoice) - paidAmount(invoice));
    if (amount > balance + 0.01) { showNotice(`The receipt exceeds the remaining invoice balance of ${format(balance)}. Record a credit note or refund through the approved finance process.`, true); return; }
    const normalise = value => typeof normaliseReference === "function" ? normaliseReference(value) : String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const receiptReference = normalise(reference), invoiceReference = normalise(invoice.paymentReference || invoice.invoiceNumber);
    const matched = receiptReference.includes(invoiceReference) || invoiceReference.includes(receiptReference);
    invoicePayments.push({ id: crypto.randomUUID(), invoiceId: invoice.id, amountReceived: amount, dateReceived: received, paymentReference: reference, paymentMethod: data.get("paymentMethod") || "BANK_TRANSFER", status: matched ? "Matched" : "Review", createdAt: new Date().toISOString(), source: "RECEIVABLES_CENTRE", sourceSystem: "ERP" });
    invoice.status = typeof calculatedInvoiceStatus === "function" ? calculatedInvoiceStatus(invoice) : invoice.status;
    if (invoice.status === "Paid") invoice.datePaid = received;
    if (typeof syncFinancialBillingStatus === "function") syncFinancialBillingStatus(invoice.engagementId);
    if (!matched && typeof writeAlert === "function") writeAlert("PAYMENT_RECONCILIATION_REVIEW", invoice.id, "Practice Administration", `Receipt ${reference} needs reconciliation against ${invoice.invoiceNumber}.`);
    saveStatements(); form.reset(); render();
    showNotice(matched ? `Payment recorded and matched to ${invoice.invoiceNumber}.` : `Payment recorded for review. Its reference does not yet match ${invoice.invoiceNumber}.`, !matched);
  }
  function autoReconcile(invoice) {
    const reviews = (typeof invoicePayments === "undefined" ? [] : invoicePayments).filter(payment => payment.invoiceId === invoice.id && payment.status === "Review");
    let matched = 0;
    reviews.forEach(payment => {
      const paymentKey = typeof normaliseReference === "function" ? normaliseReference(payment.paymentReference) : String(payment.paymentReference || "");
      const invoiceKey = typeof normaliseReference === "function" ? normaliseReference(invoice.paymentReference || invoice.invoiceNumber) : String(invoice.paymentReference || invoice.invoiceNumber);
      if (paymentKey.includes(invoiceKey) || invoiceKey.includes(paymentKey)) { payment.status = "Matched"; matched += 1; }
    });
    if (matched) { invoice.status = typeof calculatedInvoiceStatus === "function" ? calculatedInvoiceStatus(invoice) : invoice.status; if (invoice.status === "Paid") invoice.datePaid = today(); saveStatements(); render(); showNotice(`${matched} payment record(s) matched against ${invoice.invoiceNumber}. A production backend must confirm the authoritative reconciliation result.`); }
    else showNotice(`No locally recorded payment reference could be matched to ${invoice.invoiceNumber}. Send this item to the finance reconciliation queue.`, true);
  }
  function prepareStatementForInvoice(invoice) {
    document.getElementById("statementFirm").value = invoiceFirmId(invoice);
    syncStatementClientOptions();
    document.getElementById("statementClient").value = invoiceClientKey(invoice);
    document.getElementById("statementStart").value = firstOfMonth(invoice.dateIssued || today());
    document.getElementById("statementEnd").value = today();
    document.getElementById("statementGenerator").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function emailInvoice(invoice) {
    const contact = invoice.contactSnapshot || (typeof linkedContactForTaxProject === "function" ? linkedContactForTaxProject(invoiceEngagement(invoice)) : {});
    if (!contact.email) { showNotice("No primary client-contact email is recorded for this invoice.", true); return; }
    const body = `Invoice ${invoice.invoiceNumber} for ${format(gross(invoice))} is due on ${invoice.dueDate || "the agreed due date"}. Payment reference: ${invoice.paymentReference || invoice.invoiceNumber}.`;
    if (typeof recordInvoiceCommunication === "function") recordInvoiceCommunication(invoice, "EMAIL", contact.email, body);
    saveStatements();
    if (typeof renderCommunicationHub === "function") renderCommunicationHub();
    window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`Invoice ${invoice.invoiceNumber}`)}&body=${encodeURIComponent(body)}`;
    showNotice(`Invoice email opened for ${contact.email}; the communication was logged.`);
  }
  function emailStatement(statement) {
    if (statement.legalStatement === false) { showNotice("A group relationship summary is not issued by one legal firm. Generate the relevant firm statement before emailing the client.", true); return; }
    const invoice = (typeof invoices === "undefined" ? [] : invoices).find(item => item.engagementId === statement.engagementId && invoiceFirmId(item) === statement.firmId);
    const contact = invoice?.contactSnapshot || (invoice && typeof linkedContactForTaxProject === "function" ? linkedContactForTaxProject(invoiceEngagement(invoice)) : {});
    if (!invoice || !contact?.email) { showNotice("The selected statement has no eligible primary client-contact email. Record one before sending.", true); return; }
    const body = `Please find Statement ${statement.reference} for ${statement.periodStart} to ${statement.periodEnd}. Closing balance: ${format(statement.closingBalance)}. This statement is issued by ${statement.firmName}.`;
    try {
      const activity = typeof logCommunication === "function" ? logCommunication({ subject: `Statement ${statement.reference}`, communicationType: "Email", activityType: "Statement issued", direction: "Outbound", body, staffId: "Practice Administration", status: "No Action Required", leadId: invoice.leadId, engagementId: invoice.engagementId, clientId: invoice.clientId, contactId: invoice.contactId, invoiceId: invoice.id, firmId: statement.firmId, serviceOffered: "Statement of account", branchLocation: invoiceEngagement(invoice)?.branchLocation || "", attachmentReference: `STATEMENT:${statement.reference}`, purpose: "Client statement of account", signatoryReference: "Practice Administration" }) : null;
      statement.status = "EMAILED";
      statement.deliveryEvents.push({ at: new Date().toISOString(), channel: "EMAIL", recipient: contact.email, communicationId: activity?.id || null });
      saveStatements();
      if (typeof renderCommunicationHub === "function") renderCommunicationHub();
      render();
      window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(`Statement ${statement.reference}`)}&body=${encodeURIComponent(body)}`;
      showNotice(`Statement email opened for ${contact.email}; its delivery activity was logged in the Communication Hub.`);
    } catch (error) { showNotice(error.message, true); }
  }
  function printStatement(statement) {
    const rows = statement.lines.map(line => `<tr><td>${esc(line.date)}</td><td>${esc(line.reference)}</td><td>${esc(line.description)}</td><td>${line.debit ? format(line.debit) : ""}</td><td>${line.credit ? format(line.credit) : ""}</td><td>${format(line.balance)}</td></tr>`).join("");
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) { showNotice("Allow pop-ups to print or save this statement as a PDF.", true); return; }
    popup.document.write(`<!doctype html><html><head><title>${esc(statement.reference)}</title><style>body{font:12px Arial,sans-serif;color:#1d3028;margin:32px}h1{font-size:20px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:8px;border-bottom:1px solid #ccd8d1;text-align:left}th{background:#edf5f0}.totals{display:flex;gap:36px;margin:18px 0;font-size:13px}.aging{margin-top:20px;padding:12px;background:#f5f8f6}@media print{body{margin:16px}}</style></head><body><h1>Statement of Account</h1><p><b>Reference:</b> ${esc(statement.reference)}<br><b>Issued by:</b> ${esc(statement.firmName)}<br><b>Client:</b> ${esc(statement.clientName)}<br><b>Period:</b> ${esc(statement.periodStart)} to ${esc(statement.periodEnd)}<br><b>Currency:</b> KES</p><div class="totals"><span><b>Opening balance:</b> ${format(statement.openingBalance)}</span><span><b>Closing balance:</b> ${format(statement.closingBalance)}</span></div><table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No movements in the selected period.</td></tr>'}</tbody></table><div class="aging"><b>Aging at ${esc(statement.periodEnd)}</b><br>0–30: ${format(statement.aging.current)} &nbsp; | &nbsp; 31–60: ${format(statement.aging.days31to60)} &nbsp; | &nbsp; 60+: ${format(statement.aging.days60plus)}<br><small>Integrity hash: ${esc(statement.integrityHash)}</small></div></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  }
  function csvValue(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
  function exportCsv() {
    const header = ["Invoice Number", "Client", "Firm", "Invoice Date", "Due Date", "Total KES", "Balance KES", "Status"];
    const data = scopedInvoices().map(invoice => [invoice.invoiceNumber, invoiceClientName(invoice), invoiceFirmName(invoice), invoice.dateIssued, invoice.dueDate, gross(invoice).toFixed(2), Math.max(0, gross(invoice) - paidAmount(invoice)).toFixed(2), invoiceStatus(invoice)]);
    const blob = new Blob([[header, ...data].map(row => row.map(csvValue).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `pcl-invoices-${today()}.csv`; link.click(); URL.revokeObjectURL(url);
    showNotice("Filtered invoice register exported to CSV.");
  }
  function createInvoice() {
    const tab = document.querySelector('.tab[data-tab="operations"]');
    tab?.click();
    setTimeout(() => document.getElementById("invoiceEngagement")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }
  function inject() {
    if (document.getElementById("invoices-statements")) return;
    const nav = document.querySelector(".tabs"), shell = document.querySelector(".shell");
    if (!nav || !shell) return;
    const tab = document.createElement("button"), section = document.createElement("section"), before = nav.querySelector('[data-tab="operations"]');
    tab.className = "tab"; tab.type = "button"; tab.dataset.tab = "invoices-statements";
    tab.innerHTML = '<svg class="nav-icon" aria-hidden="true"><use href="#icon-briefcase" /></svg>Receivables Centre';
    section.id = "invoices-statements"; section.className = "tab-panel";
    section.innerHTML = `<div class="intro"><div><h2>Finance &amp; Receivables</h2><p>One shared receivables workspace for invoices, payments, firm statements and client relationship summaries. Every invoice and payment keeps the locked issuing firm from its engagement. Statutory tax compliance remains in Tax Projects.</p></div><div class="actions"><button class="btn secondary" type="button" data-invoice-page-action="create">+ Create invoice</button><button class="btn secondary" type="button" data-invoice-page-action="export">Export CSV</button></div></div><div class="notice" id="invoiceStatementNotice" role="status"></div><div class="metric-grid"><div class="card metric-card"><b id="invoiceStatementTotal">KES 0</b><span>Invoice total in view</span></div><div class="card metric-card"><b id="invoiceStatementOutstanding">KES 0</b><span>Outstanding balance</span></div><div class="card metric-card"><b id="invoiceStatementOverdue">0</b><span>Overdue invoices</span></div><div class="card metric-card"><b id="invoiceStatementPaid">0</b><span>Paid invoices</span></div></div><section class="section"><div class="section-heading"><div><h3>Invoice register</h3><span id="invoiceStatementShowing" class="hint">Showing 0 invoices. The firm column remains visible in the all-firms view.</span></div></div><div class="invoice-filter-bar"><label>Firm view<select id="invoiceRegisterFirm"></select></label><label>Status<select id="invoiceRegisterStatus"><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Partial</option><option value="PAID">Paid</option><option value="OVERDUE">Overdue</option><option value="CANCELLED">Cancelled</option><option value="CREDIT_NOTE">Credit Note</option></select></label><label class="invoice-search">Search<input id="invoiceRegisterSearch" placeholder="Invoice number, client or payment reference" /></label></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Invoice</th><th>Client</th><th>Firm</th><th>Invoice / due date</th><th>Total</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody id="invoiceStatementRows"></tbody></table></div></section><section class="section"><div class="operations-layout"><form id="receivablePaymentForm" class="card form-card"><div class="section-heading"><h3>Record client payment</h3><span class="hint">Receipts update the invoice balance and flow into statements.</span></div><div class="grid"><label class="full">Invoice <span>*</span><select required name="invoiceId" id="receivablePaymentInvoice"></select></label><label>Amount received (KES) <span>*</span><input required name="amount" type="number" min="0.01" step="0.01" /></label><label>Date received <span>*</span><input required name="dateReceived" type="date" /></label><label>Payment method <span>*</span><select required name="paymentMethod"><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option><option value="BANK_TRANSFER">Bank Transfer</option><option value="CHEQUE">Cheque</option></select></label><label class="full">Payment reference <span>*</span><input required name="paymentReference" placeholder="Begin with invoice number — then payment reference" /></label></div><div class="actions"><button class="btn primary" type="submit">Record payment and reconcile</button></div></form><article class="card side-card"><div class="section-heading"><h3>Payment controls</h3><span class="hint">Controlled receivables</span></div><ul class="tax-project-policy"><li>The payment must be linked to one firm-bound invoice.</li><li>Cash, M-Pesa, Bank Transfer and Cheque are recorded separately.</li><li>A matching reference is reconciled automatically. A non-matching payment is recorded for Practice Administration review.</li><li>Overpayments are blocked. Use an approved credit note or refund process instead.</li><li>Payments, credit notes and invoices are included in the client statement running balance.</li></ul></article></div></section><section id="statementGenerator" class="section statement-generator"><div class="section-heading"><div><h3>Statements &amp; client relationship summaries</h3><span class="hint">Choose one issuing firm for a legal statement. Choose All firms — relationship summary for a combined client view that retains each issuing firm and cannot be emailed as one legal statement.</span></div></div><div class="invoice-filter-bar statement-filter"><label>Statement type / issuing firm <select id="statementFirm"></select></label><label>Client <select id="statementClient"></select></label><label>From <input type="date" id="statementStart" /></label><label>To <input type="date" id="statementEnd" /></label><div class="statement-generate-action"><button class="btn primary" type="button" data-invoice-page-action="generate">Generate</button></div></div><div id="statementPreview" class="card statement-preview"></div></section><section class="section"><div class="section-heading"><h3>Statement and relationship-summary register</h3><span class="hint">Each snapshot is retained as generated. Delivery metadata may be appended only to a legal firm statement.</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Reference / date</th><th>Client</th><th>Firm / summary</th><th>Period</th><th>Closing balance</th><th>Status</th><th>Action</th></tr></thead><tbody id="statementHistoryRows"></tbody></table></div></section>`;
    if (before) nav.insertBefore(tab, before); else nav.append(tab);
    shell.append(section);
    if (typeof installPaymentMethodControl === "function") installPaymentMethodControl(document.getElementById("receivablePaymentForm"));
    else { const reference = document.querySelector('#receivablePaymentForm [name="paymentReference"]'), method = document.createElement("label"); method.innerHTML = 'Payment method <span>*</span><select required name="paymentMethod"><option value="CASH">Cash</option><option value="MPESA">M-Pesa</option><option value="BANK_TRANSFER" selected>Bank Transfer</option><option value="CHEQUE">Cheque</option></select>'; reference?.closest("label")?.before(method); }
    const receiptReference = document.querySelector('#receivablePaymentForm [name="paymentReference"]');
    if (receiptReference) { receiptReference.placeholder = "Begin with the invoice number — then cash, M-Pesa, bank or cheque reference"; receiptReference.closest("label").childNodes[0].nodeValue = "Receipt reference "; }
    section.querySelector('[data-invoice-page-action="create"]').textContent = "+ Register invoice";
    tab.addEventListener("click", () => { document.querySelectorAll(".tab").forEach(button => button.classList.toggle("active", button === tab)); document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel === section)); render(); });
    document.getElementById("invoiceRegisterFirm").addEventListener("change", render);
    document.getElementById("invoiceRegisterStatus").addEventListener("change", render);
    document.getElementById("invoiceRegisterSearch").addEventListener("input", render);
    window.addEventListener("pcl:firm-view-change", event => {
      const selectedFirm = event.detail?.firmId || "";
      const registerFirm = document.getElementById("invoiceRegisterFirm");
      if (registerFirm && [...registerFirm.options].some(option => option.value === selectedFirm)) registerFirm.value = selectedFirm;
      render();
    });
    document.getElementById("statementFirm").addEventListener("change", syncStatementClientOptions);
    document.getElementById("receivablePaymentInvoice").addEventListener("change", event => { const invoice = invoices.find(item => item.id === event.target.value); if (invoice && receiptReference) receiptReference.value = `${invoice.invoiceNumber} — `; });
    document.getElementById("receivablePaymentForm").addEventListener("submit", event => { event.preventDefault(); recordPayment(event.currentTarget); });
    section.addEventListener("click", async event => {
      const actionButton = event.target.closest("[data-invoice-page-action]");
      if (actionButton) { const action = actionButton.dataset.invoicePageAction; if (action === "create") createInvoice(); if (action === "export") exportCsv(); if (action === "generate") await generateStatement(); return; }
      const invoiceButton = event.target.closest("[data-invoice-statement-action]");
      if (invoiceButton) { const invoice = invoices.find(item => item.id === invoiceButton.dataset.id); if (!invoice) return; const action = invoiceButton.dataset.invoiceStatementAction; if (action === "statement") prepareStatementForInvoice(invoice); if (action === "reconcile") autoReconcile(invoice); if (action === "email") emailInvoice(invoice); return; }
      const statementButton = event.target.closest("[data-statement-action], [data-statement-history]");
      if (statementButton) { const statement = statementSnapshots.find(item => item.id === statementButton.dataset.id); if (!statement) return; const action = statementButton.dataset.statementAction || statementButton.dataset.statementHistory; if (action === "view") { activeStatementId = statement.id; renderStatementPreview(); document.getElementById("statementPreview").scrollIntoView({ behavior: "smooth", block: "start" }); } if (action === "print") printStatement(statement); if (action === "email") emailStatement(statement); }
    });
    document.head.insertAdjacentHTML("beforeend", `<style>.invoice-filter-bar{display:grid;grid-template-columns:180px 180px minmax(220px,1fr);gap:12px;align-items:end;margin:12px 0 16px}.invoice-filter-bar label{display:grid;gap:5px;font-size:12px;color:var(--muted)}.invoice-filter-bar input,.invoice-filter-bar select{min-height:38px}.invoice-search{min-width:0}.invoice-statement-actions,.statement-actions{display:flex;flex-wrap:wrap;gap:6px}.invoice-statement-actions button,.statement-actions button{padding:5px 7px;font-size:11px;background:#fff;border:1px solid #b9c7bf;border-radius:5px;color:#254337}.statement-generator{background:#f8fbf9;border-radius:10px;padding:18px}.statement-filter{grid-template-columns:1fr 1.35fr 165px 165px auto}.statement-generate-action{align-self:end}.statement-preview{margin-top:16px;padding:20px}.statement-heading{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.statement-heading h3{margin:8px 0}.statement-heading p{line-height:1.55;margin-bottom:0}.statement-balance,.statement-aging{display:flex;flex-wrap:wrap;gap:18px;margin:16px 0;padding:12px;background:#f1f8f3;border-radius:7px}.statement-aging{font-size:12px;align-items:center}.statement-aging b{margin-right:10px}@media(max-width:900px){.invoice-filter-bar,.statement-filter{grid-template-columns:1fr 1fr}.statement-generate-action{grid-column:1/-1}.statement-heading{display:block}.statement-actions{margin-top:12px}}@media(max-width:580px){.invoice-filter-bar,.statement-filter{grid-template-columns:1fr}}</style>`);
    document.getElementById("statementStart").value = firstOfMonth();
    document.getElementById("statementEnd").value = today();
    render();
  }

  inject();
  window.addEventListener("pcl:tax-projects-updated", render);
})();
