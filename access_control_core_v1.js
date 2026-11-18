// accessControl.js – staff roles, per-staff access, handling firms and billing rates for the PCL ERP.
// Follows "PCL ERP Staff Roles and Access Rights UAT Guide" (staging, 2 Nov 2026).
//
// Model:  ROLE (template, ceiling)  ->  per-staff OVERRIDES (may only remove rights, or grant rights
//         the role's ceiling allows)  ->  FIRM + PROJECT scope  ->  MAKER-CHECKER on every approval.
// The server evaluates can() on every request; hiding buttons is presentation only.

// ---------------------------------------------------------------------------
// 1. ROLES (the five UAT roles)
// ---------------------------------------------------------------------------
const ROLES = ["PARTNER", "MANAGER", "SUPERVISOR", "ASSISTANT", "INTERN"];
const ROLE_LABEL = {
  PARTNER: "Engagement Partner", MANAGER: "Manager", SUPERVISOR: "Audit Supervisor",
  ASSISTANT: "Audit Assistant", INTERN: "Intern",
};
const RANK = { PARTNER: 5, MANAGER: 4, SUPERVISOR: 3, ASSISTANT: 2, INTERN: 1 };

// ---------------------------------------------------------------------------
// 2. FEATURE AREAS x ACTIONS
//    V view · C create/prepare · E edit · D delete · U upload · S submit for review
//    A approve/review/return · P post/lock · X export
// ---------------------------------------------------------------------------
const ACTIONS = { V: "View", C: "Create / prepare", E: "Edit", D: "Delete", U: "Upload", S: "Submit", A: "Approve / review", P: "Post / lock", X: "Export" };

const AREAS = [
  // key, label, group, applicable actions
  ["leads", "Leads", "Practice", "VCEDX"],
  ["clients", "Clients & KYC", "Practice", "VCEDX"],
  ["projects", "Projects & schedules", "Practice", "VCEDX"],
  ["tasks", "Tasks & task documents", "Practice", "VCEUS"],
  ["billing_wip", "Billing & WIP (billable rates)", "Practice", "VCEX"],
  ["billing_cost", "Cost rates & margins", "Practice", "VE"],
  ["invoices", "Client invoices", "Practice", "VCESAX"],
  ["import_sources", "Import sources (sales, purchases, payroll, bank)", "Client accounting", "VUSDX"],
  ["account_mapping", "Account mappings (TB & purchase codes)", "Client accounting", "VCESAX"],
  ["opening_tb", "Opening TB & journals", "Client accounting", "VCESAPX"],
  ["ledger", "Client ledger", "Client accounting", "VX"],
  ["vat_recon", "Sales & VAT reconciliation", "Client accounting", "VCESAPX"],
  ["payroll", "Payroll & PAYE", "Client accounting", "VCESAPX"],
  ["bank_analysis", "Bank analysis", "Client accounting", "VCESAX"],
  ["financials", "Financial statements & iTax schedules", "Client accounting", "VCSAX"],
  ["audit_workpapers", "Audit working papers", "Audit & assurance", "VCEUSAX"],
  ["audit_framework", "Audit framework confirmation", "Audit & assurance", "VA"],
  ["audit_final", "Final audit file approval", "Audit & assurance", "VSA"],
  ["evidence", "Evidence & reports", "Audit & assurance", "VUX"],
  ["staff", "Staff & access", "Administration", "VCED"],
  ["firms", "Handling firms", "Administration", "VCE"],
  ["settings", "Settings", "Administration", "VE"],
];
const AREA = Object.fromEntries(AREAS.map(([k, l, g, a]) => [k, { key: k, label: l, group: g, actions: a }]));

// Role defaults ("ceiling" = most a staff member in that role can ever be given).
// Codes: string of action letters. Default = granted on creation; Ceiling = may be granted by override.
const R = (dflt, ceil = dflt) => ({ dflt, ceil });
const ROLE_MATRIX = {
  PARTNER: {
    leads: R("VCEDX"), clients: R("VCEDX"), projects: R("VCEDX"), tasks: R("VCEUS"), billing_wip: R("VCEX"),
    billing_cost: R("VE"), invoices: R("VCESAX"), import_sources: R("VUSDX"), account_mapping: R("VCESAX"),
    opening_tb: R("VCESAPX"), ledger: R("VX"), vat_recon: R("VCESAPX"), payroll: R("VCESAPX"), bank_analysis: R("VCESAX"),
    financials: R("VCSAX"), audit_workpapers: R("VCEUSAX"), audit_framework: R("VA"), audit_final: R("VSA"),
    evidence: R("VUX"), staff: R("VCED"), firms: R("VCE"), settings: R("VE"),
  },
  MANAGER: {
    leads: R("VCEDX"), clients: R("VCEDX"), projects: R("VCEDX"), tasks: R("VCEUS"), billing_wip: R("VCEX"),
    billing_cost: R("V", "VE"), invoices: R("VCESAX"), import_sources: R("VUSDX"), account_mapping: R("VCESAX"),
    opening_tb: R("VCESAPX"), ledger: R("VX"), vat_recon: R("VCESAPX"), payroll: R("VCESAPX"), bank_analysis: R("VCESAX"),
    financials: R("VCSAX"), audit_workpapers: R("VCEUSAX"), audit_framework: R("V"), audit_final: R("VS"),
    evidence: R("VUX"), staff: R("VCE"), firms: R("V"), settings: R("VE"),
  },
  SUPERVISOR: {
    leads: R("V", "VCE"), clients: R("V", "VCE"), projects: R("VCEX"), tasks: R("VCEUS"), billing_wip: R("V", "VC"),
    billing_cost: R(""), invoices: R("", "V"), import_sources: R("VUSX", "VUSDX"), account_mapping: R("VCESX"),
    opening_tb: R("VCESX"), ledger: R("VX"), vat_recon: R("VCESX", "VCESAX"), payroll: R("VCESX", "VCESAX"),
    bank_analysis: R("VCESX", "VCESAX"), financials: R("VCSX"), audit_workpapers: R("VCEUSX"), audit_framework: R("V"),
    audit_final: R("V"), evidence: R("VUX"), staff: R(""), firms: R(""), settings: R(""),
  },
  ASSISTANT: {
    leads: R(""), clients: R("V"), projects: R("V"), tasks: R("VCEUS"), billing_wip: R("", "VC"), billing_cost: R(""),
    invoices: R(""), import_sources: R("VUS"), account_mapping: R("VCES"), opening_tb: R("VCES"), ledger: R("V"),
    vat_recon: R("VCES"), payroll: R("VCES"), bank_analysis: R("VCES"), financials: R("V", "VC"),
    audit_workpapers: R("VCEUS"), audit_framework: R(""), audit_final: R(""), evidence: R("VU"),
    staff: R(""), firms: R(""), settings: R(""),
  },
  INTERN: {
    leads: R(""), clients: R("V"), projects: R("V"), tasks: R("VCE"), billing_wip: R(""), billing_cost: R(""), invoices: R(""),
    import_sources: R(""), account_mapping: R(""), opening_tb: R(""), ledger: R(""), vat_recon: R(""), payroll: R(""),
    bank_analysis: R(""), financials: R(""), audit_workpapers: R(""), audit_framework: R(""), audit_final: R(""),
    evidence: R(""), staff: R(""), firms: R(""), settings: R(""),
  },
};

// Hard rules no override can change (UAT guide)
const HARD = {
  partnerOnly: [["audit_final", "A"], ["audit_framework", "A"], ["firms", "C"], ["firms", "E"], ["billing_cost", "E"]],
  approveRoles: ["PARTNER", "MANAGER"],          // approval of accounting / audit work
  internBlocked: ["ledger", "audit_workpapers", "audit_framework", "audit_final", "import_sources", "account_mapping"],
};

// ---------------------------------------------------------------------------
// 3. EFFECTIVE RIGHTS for one staff member (role defaults + overrides, capped by ceiling and hard rules)
// ---------------------------------------------------------------------------
/** overrides = { areaKey: { grant: "A", revoke: "D" } } */
function effectiveRights(staff) {
  const out = {};
  for (const [area, { dflt, ceil }] of Object.entries(ROLE_MATRIX[staff.role])) {
    const o = staff.overrides?.[area] ?? {};
    let set = new Set(dflt);
    for (const a of o.grant ?? "") if (ceil.includes(a) && AREA[area].actions.includes(a)) set.add(a);
    for (const a of o.revoke ?? "") set.delete(a);
    for (const [ar, ac] of HARD.partnerOnly) if (ar === area && staff.role !== "PARTNER") set.delete(ac);
    if (staff.role === "INTERN" && HARD.internBlocked.includes(area)) set.clear();
    out[area] = [...set].sort((x, y) => "VCEDUSAPX".indexOf(x) - "VCEDUSAPX".indexOf(y)).join("");
  }
  return out;
}

/** Validate an override request before saving it (shown as errors on the staff screen). */
function validateOverride(editor, staff, area, grant = "", revoke = "") {
  const errors = [];
  if (!["PARTNER", "MANAGER"].includes(editor.role)) errors.push("Only a Partner or Manager can change access.");
  if (editor.role === "MANAGER" && RANK[staff.role] >= RANK.MANAGER) errors.push("A Manager cannot edit Partner or Manager accounts.");
  if (editor.id === staff.id) errors.push("You cannot change your own access.");
  const ceil = ROLE_MATRIX[staff.role][area].ceil;
  for (const a of grant) if (!ceil.includes(a)) errors.push(`${ACTIONS[a]} on ${AREA[area].label} is above the ${ROLE_LABEL[staff.role]} ceiling – change the role instead.`);
  return errors;
}

// ---------------------------------------------------------------------------
// 4. THE SERVER CHECK – call on every request
// ---------------------------------------------------------------------------
/**
 * @param staff  { id, role, status, firmIds:[], projectIds:[], overrides }
 * @param area   key from AREAS
 * @param action letter from ACTIONS
 * @param record { firmId, projectId, scope, allocatedStaffIds, taskAssigneeIds, taskReviewerIds,
 *                 preparedBy, lastEditedBy, status } (omit for menu checks)
 * @returns { ok:boolean, reason?:string }
 */
function can(staff, area, action, record) {
  if (!staff || !ROLE_MATRIX[staff.role]) return deny("Staff role is not recognised.");
  if (staff.status !== "Active") return deny("Account is suspended.");
  if (!AREA[area] || !AREA[area].actions.includes(action)) return deny("Area or action is not recognised.");
  if (!effectiveRights(staff)[area]?.includes(action)) return deny(`${ROLE_LABEL[staff.role]} cannot ${ACTIONS[action].toLowerCase()} in ${AREA[area].label}.`);
  if (record) {
    if (record.firmId && !(staff.firmIds || []).includes(record.firmId)) return deny("Record belongs to a firm you are not authorised for.");
    const taskAccess = hasTaskAccess(staff, record);
    const allocated = hasProjectAllocation(staff, record);
    const broadProjectRead = action === "V" && RANK[staff.role] >= RANK.SUPERVISOR;
    const assistantClientDirectory = staff.role === "ASSISTANT" && action === "V" && area === "clients" && !record.projectId && ["directory", "summary"].includes(record.scope);
    const assistantProjectDirectory = staff.role === "ASSISTANT" && action === "V" && area === "projects" && record.scope === "summary";

    // Partner, Manager and Supervisor roles can find every company and project in
    // their authorised firm. This read access does not grant editing authority.
    if (staff.role === "INTERN" && ["clients", "projects"].includes(area) && !taskAccess)
      return deny("Interns can open client and project details only from an assigned task.");
    if (assistantClientDirectory || assistantProjectDirectory) return { ok: true };
    if (record.projectId && !allocated && !taskAccess && !broadProjectRead)
      return deny("Record belongs to a project that is not allocated to you or assigned to your task.");
    if (record.projectId && action !== "V" && !allocated && !taskAccess)
      return deny("Work must be allocated to you or assigned to your task before you can change it.");
    if (record.scope === "detail" && staff.role === "ASSISTANT" && !allocated && !taskAccess)
      return deny("Client details and working data open when the work is allocated or a task is sent to you.");
    if (record.scope === "detail" && staff.role === "INTERN" && !taskAccess)
      return deny("Client details are available only through your assigned task.");
    if (action === "A" || action === "P") {
      if (!HARD.approveRoles.includes(staff.role) && !(area === "vat_recon" || area === "payroll" || area === "bank_analysis"))
        return deny("Only a Manager or Partner can approve this work.");
      if (record.preparedBy === staff.id || record.lastEditedBy === staff.id)
        return deny("You prepared or last edited this record – an independent reviewer must approve it.");
      if (action === "A" && !isAssignedReviewer(staff, record))
        return deny("This work was not sent to you for review.");
      if (action === "A" && record.status !== "SUBMITTED") return deny(`Only submitted work can be approved (status: ${record.status}).`);
      if (action === "P" && record.status !== "APPROVED") return deny("Only approved work can be posted or locked.");
    }
  }
  return { ok: true };
}
const deny = reason => ({ ok: false, reason });

function idsFrom(record, keys) {
  return keys.flatMap(key => {
    const value = record?.[key];
    return Array.isArray(value) ? value : value ? [value] : [];
  }).filter(Boolean).map(String);
}
function hasTaskAccess(staff, record) {
  return idsFrom(record, ["taskAccessStaffIds", "taskAssigneeIds", "assigneeIds", "taskReviewerIds", "reviewerStaffIds", "assignedStaffIds"])
    .includes(String(staff.id));
}
function isAssignedReviewer(staff, record) {
  return idsFrom(record, ["taskReviewerIds", "reviewerStaffIds", "reviewAssignedTo", "reviewerStaffId"])
    .includes(String(staff.id));
}
function hasProjectAllocation(staff, record) {
  const allocatedIds = idsFrom(record, ["allocatedStaffIds", "projectStaffIds", "assignmentStaffIds"]);
  return Boolean(record?.projectId && staff.projectIds?.includes(record.projectId)) || allocatedIds.includes(String(staff.id));
}
function eligibleReviewers(staffList, record) {
  return staffList.filter(candidate => ["PARTNER", "MANAGER"].includes(candidate.role) && candidate.status === "Active" &&
    candidate.id !== record.preparedBy && candidate.id !== record.lastEditedBy &&
    (!record.firmId || candidate.firmIds?.includes(record.firmId)) && effectiveRights(candidate).opening_tb?.includes("A"));
}

// Status lifecycle (UAT "status words")
const STATUS_FLOW = {
  STAGED: ["DRAFT"], DRAFT: ["SUBMITTED"], SUBMITTED: ["APPROVED", "RETURNED"],
  RETURNED: ["DRAFT"], APPROVED: ["POSTED"], POSTED: [],
};
const nextStatusAllowed = (from, to) => (STATUS_FLOW[from] ?? []).includes(to);

// ---------------------------------------------------------------------------
// 5. STAFF ACCOUNT ADMINISTRATION
// ---------------------------------------------------------------------------
function canAdministerStaff(editor, targetRole) {
  if (editor.role === "PARTNER") return { ok: true };
  if (editor.role === "MANAGER") return RANK[targetRole] < RANK.MANAGER ? { ok: true } : deny("A Manager cannot create or edit Partner or Manager accounts.");
  return deny("Only a Partner or Manager can manage staff.");
}
const PASSWORD_RULE = { minLength: 14, upper: true, lower: true, number: true };
const validPassword = p => p.length >= 14 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p);
const SETUP_LINK = { validHours: 24, singleUse: true, newerReplacesOlder: true };

// ---------------------------------------------------------------------------
// 6. HANDLING FIRMS
// ---------------------------------------------------------------------------
const FIRMS = [
  { code: "ACL", name: "ALARCON CONSULTANTS LTD", invoicePrefix: "INV/ACL" },
  { code: "ACPA", name: "ALARCON CERTIFIED PUBLIC ACCOUNTANTS", invoicePrefix: "INV/ACPA",
    note: "Audit opinions are issued only under the CPA firm" },
  { code: "PCL", name: "PHAM CONSULTING LTD", invoicePrefix: "INV/PCL" },
];

// ---------------------------------------------------------------------------
// 7. BILLING RATES (effective-dated, no overlaps; cost visible to Partner/Manager only)
// ---------------------------------------------------------------------------
/** rates = [{ staffId, from:"YYYY-MM-DD", to:"YYYY-MM-DD"|null, cost, billable }] */
function rateOn(rates, staffId, date) {
  const r = rates.filter(x => x.staffId === staffId && x.from <= date && (!x.to || x.to >= date));
  if (r.length > 1) throw new Error(`Overlapping rate periods for ${staffId} on ${date}`);
  return r[0] ?? null;
}
function validateRatePeriod(rates, p) {
  const errs = [];
  if (p.to && p.to < p.from) errs.push("End date is before start date.");
  if (!(p.billable >= 0) || !(p.cost >= 0)) errs.push("Rates must be zero or more.");
  for (const x of rates.filter(x => x.staffId === p.staffId && x !== p))
    if (p.from <= (x.to ?? "9999-12-31") && (p.to ?? "9999-12-31") >= x.from) errs.push(`Overlaps the period starting ${x.from}. Close it first (set its end date to the day before ${p.from}).`);
  return errs;
}
/** Time entry value: rate locked at the entry date, never re-priced after invoicing. */
function timeValue(rates, entry) {
  const r = rateOn(rates, entry.staffId, entry.date);
  if (!r) return { error: "No rate for this date – add a rate period." };
  return { cost: +(r.cost * entry.hours).toFixed(2), billable: +(r.billable * entry.hours).toFixed(2) };
}
/** What a viewer may see of a rate row. */
const rateView = (viewer, row) =>
  ["PARTNER", "MANAGER"].includes(viewer.role) ? row : { ...row, cost: undefined };

// ---------------------------------------------------------------------------
// 8. WORK ALLOCATION – requests require independent Manager / Partner approval
// ---------------------------------------------------------------------------
const ALLOCATION_STATUS = Object.freeze({ PENDING: "PENDING", APPROVED: "APPROVED", DECLINED: "DECLINED" });
const isIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const dayBefore = value => { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/** Create a request; the ERP service must persist it and append its audit event. */
function createAllocationRequest({ requester, project, reason, takeover = false, requestedStartDate, id, requestedAt }) {
  if (!requester || requester.status !== "Active") return { ok: false, reason: "An active staff account is required." };
  if (requester.role === "INTERN") return { ok: false, reason: "Interns cannot request project allocation." };
  if (!project?.id || !project?.firmId) return { ok: false, reason: "Choose a valid project." };
  if (!requester.firmIds?.includes(project.firmId)) return { ok: false, reason: "The project belongs to a firm you are not authorised for." };
  if (!String(reason || "").trim()) return { ok: false, reason: "A reason is required for an allocation request." };
  if (!isIsoDate(requestedStartDate)) return { ok: false, reason: "Enter a valid allocation start date." };
  return { ok: true, request: {
    id: id || `allocation-${requester.id}-${project.id}-${requestedStartDate}`,
    projectId: project.id, firmId: project.firmId, requesterId: requester.id, requesterRole: requester.role,
    reason: String(reason).trim(), takeover: Boolean(takeover), requestedStartDate,
    requestedAt: requestedAt || new Date().toISOString(), status: ALLOCATION_STATUS.PENDING,
  } };
}

/** Return auditable assignment changes without mutating storage. */
function decideAllocationRequest({ approver, request, decision, reason = "", effectiveDate, currentAssignments = [] }) {
  if (!approver || approver.status !== "Active" || !["PARTNER", "MANAGER"].includes(approver.role))
    return { ok: false, reason: "Only an active Manager or Engagement Partner can decide allocation requests." };
  if (approver.id === request?.requesterId) return { ok: false, reason: "You cannot approve your own allocation request." };
  if (request?.status !== ALLOCATION_STATUS.PENDING) return { ok: false, reason: "Only pending allocation requests can be decided." };
  if (!approver.firmIds?.includes(request.firmId)) return { ok: false, reason: "The request belongs to a firm you are not authorised for." };
  if (!["APPROVE", "DECLINE"].includes(decision)) return { ok: false, reason: "Choose approve or decline." };
  if (decision === "DECLINE" && !String(reason).trim()) return { ok: false, reason: "A reason is required when declining a request." };
  const decided = { ...request, status: decision === "APPROVE" ? ALLOCATION_STATUS.APPROVED : ALLOCATION_STATUS.DECLINED,
    decidedBy: approver.id, decidedByRole: approver.role, decisionReason: String(reason).trim(), decidedAt: new Date().toISOString() };
  if (decision === "DECLINE") return { ok: true, request: decided, assignmentChanges: [], draftsRemainWithOriginalOwner: true };
  if (!isIsoDate(effectiveDate) || effectiveDate < request.requestedStartDate)
    return { ok: false, reason: "The effective date must be valid and cannot be earlier than the requested start date." };
  const assignmentChanges = [];
  if (request.takeover) for (const assignment of currentAssignments) {
    if (assignment.projectId === request.projectId && assignment.staffId !== request.requesterId && !assignment.endDate) {
      if (assignment.startDate && assignment.startDate >= effectiveDate) return { ok: false, reason: "The takeover date must follow the current allocation start date." };
      assignmentChanges.push({ type: "END", assignmentId: assignment.id, projectId: request.projectId, staffId: assignment.staffId, endDate: dayBefore(effectiveDate) });
    }
  }
  assignmentChanges.push({ type: "ADD", projectId: request.projectId, firmId: request.firmId, staffId: request.requesterId,
    id: `allocation-${request.id}`, role: "PREPARER", startDate: effectiveDate, endDate: null, approvedBy: approver.id });
  return { ok: true, request: decided, assignmentChanges, draftsRemainWithOriginalOwner: true };
}

// ---------------------------------------------------------------------------
// 9. HISTORY – write one row on every create / submit / return / approve / post / access change
// ---------------------------------------------------------------------------
const historyRow = (actor, recordType, recordId, action, note = "") =>
  ({ recordType, recordId, action, actorId: actor.id, actorRole: actor.role, at: new Date().toISOString(), note });

const PCLAccessControl = Object.freeze({
  ROLES, ROLE_LABEL, ACTIONS, AREAS, ROLE_MATRIX, effectiveRights, validateOverride, can,
  nextStatusAllowed, canAdministerStaff, validPassword, PASSWORD_RULE, SETUP_LINK,
  FIRMS, rateOn, validateRatePeriod, timeValue, rateView, historyRow,
  hasTaskAccess, isAssignedReviewer, hasProjectAllocation, eligibleReviewers,
  ALLOCATION_STATUS, createAllocationRequest, decideAllocationRequest,
});
if (typeof module !== "undefined" && module.exports) module.exports = PCLAccessControl;
if (typeof globalThis !== "undefined") globalThis.PCLAccessControl = PCLAccessControl;
