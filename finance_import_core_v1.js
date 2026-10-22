/* Pure import rules. No client data, network calls or financial posting. */
(function (root) {
  "use strict";
  const clean = value => String(value ?? "").trim();
  const nameKey = value => clean(value).replace(/\s+/g, " ").toLocaleLowerCase("en-KE");
  const money = value => {
    if (value === null || value === undefined || clean(value) === "") return null;
    const raw = clean(value).replace(/,/g, "");
    if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Amount must be a number with at most two decimals.");
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(cents)) throw new Error("Amount is outside the supported range.");
    return cents;
  };
  function date(value) {
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : clean(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("Date must be an ISO date or an Excel date cell.");
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error("Invalid date.");
    return text;
  }
  function matchClient(name, clients) {
    const key = nameKey(name);
    const found = clients.filter(c => !c.deletedAt && key && [c.companyName, c.tradingName, ...(c.previousNames || [])].some(n => nameKey(n) === key));
    return found.length === 1 ? { clientId: found[0].id, linkMethod: "Exact name" } : { clientId: "", linkMethod: found.length ? "Ambiguous name" : "No exact match" };
  }
  function parseSource(row, kind, source, firmId, clients) {
    const reference = clean(row.Number), sourceClientName = clean(kind === "Payment" ? row["Customer/Vendor"] : row.Partner);
    if (!reference || !sourceClientName) throw new Error("Reference and client name are required.");
    const amountMinor = money(row[kind === "Payment" ? "Amount Signed" : "Total in Currency Signed"]);
    if (amountMinor === null) throw new Error("Amount is missing.");
    const companyAmountMinor = kind === "Payment" ? money(row["Amount Company Currency Signed"]) : null;
    const untaxedMinor = kind === "Journal" ? money(row["Untaxed Amount Signed Currency"]) : null;
    const record = {
      kind, reference, sourceClientName, currency: "KES", firmId: firmId || "",
      date: date(row[kind === "Payment" ? "Date" : "Invoice/Bill Date"]),
      amountMinor, companyAmountMinor, untaxedMinor,
      taxMinor: untaxedMinor === null ? null : amountMinor - untaxedMinor,
      sourceAmountDueMinor: kind === "Journal" ? money(row["Amount Due Signed"]) : null,
      dueDate: kind === "Journal" && row["Due Date"] ? date(row["Due Date"]) : "",
      journal: clean(row.Journal), sourceStatus: clean(row[kind === "Payment" ? "State" : "Status In Payment"]),
      documentType: kind === "Payment" ? "Payment" : "Unconfirmed",
      suggestedType: kind === "Journal" && amountMinor < 0 ? "Possible credit note / reversal" : kind,
      paymentMethod: "", allocationStatus: "Not allocated", postingStatus: "Imported history only",
      source: { ...source }, sourceFields: Object.entries(row).map(([header, value]) => ({ header, value: value instanceof Date ? value.toISOString() : value })),
      ...matchClient(sourceClientName, clients), changes: []
    };
    if (!new Set(["Payment", "Journal"]).has(kind)) throw new Error("Unsupported export type.");
    return record;
  }
  function sourceSignature(record) {
    return JSON.stringify([record.kind, record.reference.toUpperCase(), nameKey(record.sourceClientName), record.currency, record.date, record.amountMinor, record.companyAmountMinor, record.untaxedMinor, record.sourceAmountDueMinor, record.dueDate, record.journal, record.sourceStatus]);
  }
  function sameReference(a, b) {
    return a.kind === b.kind && a.reference.toUpperCase() === b.reference.toUpperCase() && (!a.firmId || !b.firmId || a.firmId === b.firmId);
  }
  function prepare(sheets, existing, clients, firmId = "") {
    const out = { records: [], duplicates: [], errors: [], conflicts: [], rowsRead: 0 };
    for (const sheet of sheets) {
      for (const input of sheet.rows) {
        out.rowsRead++;
        const source = { fileName: sheet.fileName, sheetName: sheet.sheetName, row: input.rowNumber };
        try {
          const record = parseSource(input.values, sheet.kind, source, firmId, clients);
          const matches = [...existing, ...out.records].filter(r => sameReference(r, record));
          if (matches.length) {
            if (matches.length === 1 && sourceSignature(matches[0]) === sourceSignature(record)) out.duplicates.push({ ...source, reference: record.reference });
            else out.conflicts.push({ ...source, reference: record.reference, reason: "Reference already exists with different data or an unresolved firm." });
          } else out.records.push(record);
        } catch (error) { out.errors.push({ ...source, reason: error.message }); }
      }
    }
    return out;
  }
  function needs(record, clients) {
    const missing = [];
    if (!record.clientId || !clients.some(c => c.id === record.clientId && !c.deletedAt)) missing.push("Client link");
    if (!record.firmId) missing.push("Owning firm");
    if (record.kind === "Payment") {
      if (!record.paymentMethod) missing.push("Payment method");
      if (record.companyAmountMinor !== null && record.companyAmountMinor !== record.amountMinor) missing.push("Currency amounts differ — review source");
      missing.push("Invoice allocation");
    } else {
      if (record.documentType === "Unconfirmed") missing.push("Document type");
      missing.push("Original invoice / journal review");
    }
    return missing;
  }
  function summary(records, clients) {
    const payments = records.filter(r => r.kind === "Payment"), journals = records.filter(r => r.kind === "Journal");
    return { count: records.length, payments: payments.length, journals: journals.length, paymentMinor: payments.reduce((s,r) => s+r.amountMinor,0), journalMinor: journals.reduce((s,r) => s+r.amountMinor,0), linked: records.filter(r => r.clientId && clients.some(c => c.id === r.clientId && !c.deletedAt)).length };
  }
  function amend(record, values, reason, clients, firms, category, at) {
    if (!["Engagement Partner", "Manager"].includes(category)) throw new Error("Only Engagement Partners and Managers may amend imported records.");
    if (!clean(reason)) throw new Error("Enter the reason for this update.");
    if (values.clientId && !clients.some(c => c.id === values.clientId && !c.deletedAt)) throw new Error("Select an existing client.");
    if (values.firmId && !firms.some(f => f.id === values.firmId)) throw new Error("Select an existing firm.");
    if (record.firmId && values.firmId !== record.firmId) throw new Error("The owning firm is already set. Correct it through a controlled reversal process.");
    if (!["", "Cash", "M-Pesa", "Bank", "Cheque"].includes(values.paymentMethod)) throw new Error("Invalid payment method.");
    if (!["Unconfirmed", "Credit Note", "Invoice", "Other Journal", "Payment"].includes(values.documentType)) throw new Error("Invalid document type.");
    if (record.kind === "Payment" && values.documentType !== "Payment") throw new Error("Payment type cannot be changed.");
    if (record.kind === "Journal" && values.documentType === "Payment") throw new Error("A journal cannot be classified as a payment.");
    const fields = ["clientId", "firmId", "paymentMethod", "documentType"];
    const changes = fields.filter(f => record[f] !== values[f]).map(field => ({ field, before: record[field], after: values[field] }));
    return { ...record, ...Object.fromEntries(fields.map(f => [f, values[f]])), linkMethod: values.clientId !== record.clientId ? "Manual review" : record.linkMethod, changes: changes.length ? [...record.changes, { at, category, reason: clean(reason), fields: changes }] : record.changes };
  }
  const api = { clean, nameKey, money, date, matchClient, parseSource, prepare, needs, summary, amend };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PCLFinanceImportCore = api;
})(typeof window === "undefined" ? {} : window);
