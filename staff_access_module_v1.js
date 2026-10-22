/*
  Staff, contract and access preview.
  Authentication belongs on the secure backend. This public browser preview
  deliberately contains no names, staff IDs, contact details, passwords, OTPs,
  reset links or rates. Profiles added here stay only in this browser.
*/
(function () {
  "use strict";

  const storageKey = "pcl-staff-directory-preview-v2";
  const previewKey = "pcl-unified-shell-preview-v1";
  let editingId = null;
  let editingSnapshot = null;
  let currentHost = null;
  const rights = {
    "Engagement Partner": "All authorised firms, all clients and engagements, financial WIP, approvals and PIE/EQR sign-off. System settings remain restricted to System Administrators.",
    "Manager": "Assigned firms and teams, client and engagement management, timesheet approval and engagement financials for assigned work. No system settings or final Partner sign-off.",
    "Audit Supervisor": "Assigned projects, fieldwork tasks, documents and team coordination. Engagement fees, rates, invoices and exports are hidden.",
    "Audit Assistant": "Read-only assigned client details, assigned tasks and personal time. No fees, rates, client-list export, deletion or work outside assigned engagements.",
    "Intern": "Only tasks explicitly assigned to the intern and documents attached to those tasks. No client contacts, financial data, client lists or exports."
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[char]));
  const read = () => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const staff = JSON.parse(raw);
    if (!Array.isArray(staff)) throw new Error("Invalid staff directory");
    return staff;
  };
  const save = staff => localStorage.setItem(storageKey, JSON.stringify(staff));
  const dateLabel = value => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Not set";
  const staffList = () => read().sort((a, b) => String(a.staffId).localeCompare(String(b.staffId)));
  const employmentTypes = ["Permanent", "Contract", "Internship", "Consultant"];
  const billingStatuses = ["Billable", "Partially billable", "Non-billable"];
  const scopes = {
    firmScope: ["Assigned firms", "All firms"],
    clientScope: ["Assigned clients", "All clients in firm scope"],
    projectScope: ["Assigned tasks", "Assigned projects", "All projects in firm scope"]
  };
  const fieldLabels = {
    fullName: "Full name", loginId: "Login ID", position: "Staff category", employmentType: "Employment type",
    billingStatus: "Billing status", firmScope: "Firm scope", clientScope: "Client scope", projectScope: "Project scope",
    contractStartDate: "Contract start", contractEndDate: "Contract end", standardCostRate: "Cost rate",
    billableRate: "Billable rate", effectiveDate: "Rate effective date"
  };
  // Mirrors the shell's preview controls only; this is not authentication.
  function canEditStaff() {
    try {
      const preview = JSON.parse(localStorage.getItem(previewKey) || "{}");
      return ["Engagement Partner", "Manager"].includes(preview.category || "Engagement Partner");
    } catch (_) { return false; }
  }
  function optionList(values, selected) {
    const items = selected && !values.includes(selected) ? [selected, ...values] : values;
    return items.map(value => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function changeHistoryHtml(staff) {
    const history = Array.isArray(staff?.changeHistory) ? staff.changeHistory : [];
    if (!history.length) return "";
    return `<details class="staff-edit-history"><summary>Local profile change history (${history.length})</summary><p class="hint">Browser-local history, not a secure audit log. Job assignments and historical timesheets are not rewritten.</p><ul>${history.slice().reverse().map(entry => `<li><b>${escapeHtml(entry.changedAt)}</b><ul>${(entry.changes || []).map(change => `<li>${escapeHtml(fieldLabels[change.field] || change.field)}: ${escapeHtml(change.before ?? "Not set")} → ${escapeHtml(change.after ?? "Not set")}</li>`).join("")}</ul></li>`).join("")}</ul></details>`;
  }
  function staffFormHtml(staff) {
    const editing = Boolean(staff);
    const value = (key, fallback = "") => staff?.[key] ?? fallback;
    const input = (key, label, type = "text", extra = "", fallback = "") => `<label>${label}<input name="${key}" type="${type}" value="${escapeHtml(value(key, fallback))}" ${extra} /></label>`;
    const select = (key, label, values, fallback) => `<label>${label}<select required name="${key}">${optionList(values, value(key, fallback))}</select></label>`;
    return `<div class="section staff-add-section" id="staffProfileEditor"><div class="section-heading"><h3>${editing ? "Edit staff profile" : "Add staff member"}</h3><span class="hint">${editing ? "Save updates to this staff member, without creating a duplicate." : "These same controls apply to every future staff member."}</span></div>
      <form id="staffUserForm" class="firm-profile-grid">
      ${input("staffId", "Staff ID *", "text", `required ${editing ? 'readonly aria-describedby="staffIdentityNote"' : 'placeholder="e.g. AP0013"'}`)}
      ${input("loginId", "Login ID *", "text", 'required maxlength="80"', value("staffId"))}
      ${input("fullName", "Full name *", "text", 'required maxlength="160"')}
      ${select("position", "Staff category *", Object.keys(rights), "Audit Assistant")}
      ${select("employmentType", "Employment type *", employmentTypes, "Contract")}
      ${select("billingStatus", "Billing status *", billingStatuses, "Billable")}
      ${select("firmScope", "Firm scope *", scopes.firmScope, "Assigned firms")}
      ${input("contractStartDate", "Contract start date", "date")}
      ${input("contractEndDate", "Contract end date (required for Contract / Intern)", "date")}
      ${select("clientScope", "Client scope *", scopes.clientScope, "Assigned clients")}
      ${select("projectScope", "Project scope *", scopes.projectScope, "Assigned tasks")}
      ${input("standardCostRate", "Standard cost rate (KES/hr, pending approval)", "number", 'min="0" step="0.01"')}
      ${input("billableRate", "Billable rate (KES/hr, pending approval)", "number", 'min="0" step="0.01"')}
      ${input("effectiveDate", "Rate effective date", "date")}
      <p class="hint full" id="staffIdentityNote">${editing ? "Staff ID is fixed so client links, assignments and time records remain attached. " : "Staff ID will be used as the default Login ID. "}Rates remain subject to Finance approval. Saved profile changes do not recalculate historical WIP or change real login access.</p>
      <div class="full staff-rights-preview" id="newStaffRightsPreview" aria-live="polite">Rights preview: ${escapeHtml(rights[value("position", "Audit Assistant")] || "Select a recognised category.")}</div>
      <div class="full staff-edit-feedback" id="staffFormFeedback" role="status" aria-live="polite"></div>
      <div class="actions full"><button class="btn primary" type="submit">${editing ? "Save staff changes" : "Create staff profile"}</button>${editing ? '<button class="btn secondary" type="button" id="staffCancelEdit">Cancel</button>' : ""}</div></form>${changeHistoryHtml(staff)}</div>`;
  }
  function beginEdit(staffId) {
    if (!canEditStaff()) return setNotice("Only Engagement Partners and Managers may manage staff profiles in this preview.", true);
    let staff;
    try { staff = read().find(item => item.staffId === staffId); } catch (_) { return setNotice("The local staff directory could not be read. Nothing was changed.", true); }
    if (!staff) return setNotice("This staff profile no longer exists. Refresh the directory.", true);
    editingId = staffId;
    editingSnapshot = JSON.stringify(staff);
    render();
    document.getElementById("staffProfileEditor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector('#staffUserForm [name="fullName"]')?.focus({ preventScroll: true });
  }
  function formNotice(message, error = true) {
    const target = document.getElementById("staffFormFeedback");
    if (target) { target.textContent = message; target.className = `full staff-edit-feedback${error ? " error" : ""}`; }
  }
  function saveProfile(form) {
    if (!canEditStaff()) return formNotice("Only Engagement Partners and Managers may manage staff profiles. Nothing was saved.");
    const data = Object.fromEntries(new FormData(form).entries());
    data.staffId = String(data.staffId || "").trim().toUpperCase();
    data.loginId = String(data.loginId || "").trim().toUpperCase();
    data.fullName = String(data.fullName || "").trim();
    if (!data.staffId || !data.loginId || !data.fullName) return formNotice("Staff ID, Login ID and Full name are required.");
    let saved;
    try { saved = read(); } catch (_) { return formNotice("The local staff directory could not be read. Nothing was changed."); }
    const index = editingId === null ? -1 : saved.findIndex(item => item.staffId === editingId);
    const original = index >= 0 ? saved[index] : null;
    if (editingId !== null && (!original || JSON.stringify(original) !== editingSnapshot)) return formNotice("This profile changed elsewhere. Cancel and reopen it before saving, so other changes are not overwritten.");
    if (editingId !== null && data.staffId !== editingId) return formNotice("Staff ID cannot be changed. Existing assignments and history use this identifier.");
    if (saved.some((item, i) => i !== index && String(item.staffId).toUpperCase() === data.staffId)) return formNotice("A staff profile already uses this Staff ID. Click that name to edit it.");
    if (saved.some((item, i) => i !== index && String(item.loginId || item.staffId || "").toUpperCase() === data.loginId)) return formNotice("A staff profile already uses this Login ID. Choose a unique Login ID.");
    if (!Object.hasOwn(rights, data.position) || !employmentTypes.includes(data.employmentType) || !billingStatuses.includes(data.billingStatus)) return formNotice("Choose a recognised staff category, employment type and billing status.");
    for (const [key, values] of Object.entries(scopes)) {
      if (!values.includes(data[key]) && data[key] !== original?.[key]) return formNotice(`Choose a valid ${fieldLabels[key].toLowerCase()}.`);
    }
    for (const key of ["contractStartDate", "contractEndDate", "effectiveDate"]) {
      if (data[key] && !validDate(data[key])) return formNotice("Enter valid dates in year-month-day format.");
    }
    if ((data.employmentType === "Contract" || data.employmentType === "Internship" || data.position === "Intern") && !data.contractEndDate) return formNotice("Contract staff and interns need an end date.");
    if (data.contractStartDate && data.contractEndDate && data.contractEndDate < data.contractStartDate) return formNotice("Contract end date cannot be earlier than the contract start date.");
    for (const key of ["standardCostRate", "billableRate"]) {
      const raw = String(data[key] ?? "").trim();
      data[key] = raw === "" ? null : Number(raw);
      if (data[key] !== null && (!Number.isFinite(data[key]) || data[key] < 0)) return formNotice("Rates must be blank or a non-negative number.");
    }
    if ((data.standardCostRate !== null || data.billableRate !== null) && !data.effectiveDate) return formNotice("Enter a rate effective date when a rate is specified.");
    const fields = Object.keys(fieldLabels);
    const changes = original ? fields.filter(key => (original[key] ?? "") !== (data[key] ?? "")).map(key => ({ field: key, before: original[key] ?? null, after: data[key] ?? null })) : [];
    if (original && !changes.length) return formNotice("No changes to save.", false);
    const changedAt = new Date().toISOString();
    const updated = { ...(original || {}), ...data, updatedAt: changedAt };
    if (original) {
      updated.changeHistory = [...(Array.isArray(original.changeHistory) ? original.changeHistory : []), { changedAt, source: "Local profile editor (not authenticated)", changes }];
      if (changes.some(change => ["standardCostRate", "billableRate", "effectiveDate"].includes(change.field))) updated.rateStatus = "Pending Finance approval";
      saved[index] = updated;
    } else {
      saved.push({ ...updated, createdAt: changedAt, accountStatus: "Setup link required", rateStatus: "Pending Finance approval" });
    }
    try { save(saved); } catch (_) { return formNotice("Could not save in this browser. Storage may be full or unavailable. Your entered changes remain in the form."); }
    const wasEditing = editingId !== null;
    editingId = null;
    editingSnapshot = null;
    render();
    setNotice(wasEditing ? "Staff profile updated in this browser. Category, billing and scope previews have refreshed. Linked records and account status were preserved. Live permissions require the secure backend." : "Staff profile created in this browser. A secure backend is required to generate a real setup link; no password or token was created here.");
    window.dispatchEvent(new CustomEvent("pcl:staff-directory-updated", { detail: { staffId: data.staffId } }));
  }

  function accountLabel(staff) {
    if (staff.accountStatus === "Inactive" || staff.accountStatus === "Locked" || staff.accountStatus === "Active") return staff.accountStatus;
    if (!staff.loginId) return "Login ID required";
    return staff.accountStatus || "Setup link required";
  }
  function setNotice(message, isError) {
    const target = document.getElementById("staffAccessNotice");
    if (!target) return;
    target.textContent = message;
    target.className = `staff-access-notice${isError ? " error" : ""}`;
  }
  function linkControls(staff) {
    if (!staff.loginId || staff.accountStatus === "Inactive") return "—";
    return `<button class="btn secondary staff-link" data-link-type="setup" data-staff-id="${escapeHtml(staff.staffId)}">Generate setup link</button> <button class="btn secondary staff-link" data-link-type="reset" data-staff-id="${escapeHtml(staff.staffId)}">Generate reset link</button>`;
  }

  function render() {
    const body = staffPanelIsSelected() ? document.getElementById("settingsBody") : document.getElementById("staffDirectoryBody");
    if (!body) return;
    if (currentHost && currentHost !== body && currentHost.querySelector("#staffUserForm")) currentHost.replaceChildren();
    currentHost = body;
    if (!canEditStaff()) { body.replaceChildren(); return; }
    let staff;
    try { staff = staffList(); } catch (_) { body.innerHTML = '<p class="staff-access-notice error">The local staff directory could not be read. Existing stored data has not been changed.</p>'; return; }
    const editingStaff = staff.find(item => item.staffId === editingId);
    body.innerHTML = `
      <div class="settings-note">Staff IDs are the default Login IDs. One-time setup and password-reset links are copied by an authorised administrator and shared through an approved channel. This preview never creates or stores a password, OTP, contact detail, link token or approved rate.</div>
      <div class="section-heading"><h3>Staff users and contract register</h3><span class="hint">Contract status, billing status and access rights are separate controls.</span></div>
      <div id="staffAccessNotice" class="staff-access-notice" role="status" aria-live="polite">Click a staff name to edit their profile. Records and changes stay in this browser; connect the secure backend for a shared live directory.</div>
      <div class="staff-summary-grid"><div><b>${staff.length}</b><span>Local staff profiles</span></div><div><b>${staff.filter(item => item.employmentType === "Contract").length}</b><span>Contract staff</span></div><div><b>${staff.filter(item => item.billingStatus === "Billable").length}</b><span>Billable staff</span></div><div><b>${staff.filter(item => accountLabel(item) === "Active").length}</b><span>Active accounts</span></div></div>
      <div class="table-wrap staff-directory-table"><table class="data-table settings-table"><thead><tr><th>Staff member</th><th>Employment and billing</th><th>Contract term</th><th>Account setup</th><th>Access rights</th><th>Link controls</th></tr></thead><tbody>${staff.length ? staff.map(item => `<tr><td><button type="button" class="staff-name-edit" data-edit-staff="${escapeHtml(item.staffId)}" aria-label="Edit ${escapeHtml(item.fullName)}">${escapeHtml(item.fullName)}</button><br><span class="hint">${escapeHtml(item.staffId)} · ${escapeHtml(item.position)}</span></td><td><span class="permission-tag">${escapeHtml(item.employmentType)}</span> <span class="permission-tag">${escapeHtml(item.billingStatus)}</span><br><span class="hint">Rate: ${escapeHtml(item.rateStatus || "Pending Finance approval")}</span></td><td>${dateLabel(item.contractStartDate)}<br><span class="hint">to ${dateLabel(item.contractEndDate)}</span></td><td><span class="staff-account-status ${accountLabel(item).toLowerCase().replace(/[^a-z]+/g, "-")}">${escapeHtml(accountLabel(item))}</span><br><span class="hint">Login ID: ${escapeHtml(item.loginId || "Not set")}</span></td><td><span class="hint">${escapeHtml(rights[item.position] || "Rights not configured")}</span></td><td>${linkControls(item)}</td></tr>`).join("") : '<tr><td colspan="6" class="hint">No staff profile is stored in this browser. Create one below or connect the secure staff directory.</td></tr>'}</tbody></table></div>
      ${staffFormHtml(editingStaff)}
      <div class="section staff-invite-flow"><h3>One-time link and password-reset rule</h3><ol><li>Admin creates the profile and sets the Login ID, position, contract status, billing status and scopes.</li><li>Admin chooses <b>Generate setup link</b> or <b>Generate reset link</b>. The secure backend returns a single-use URL and displays a <b>Copy link</b> control once.</li><li>Admin pastes the link to the staff member through an approved channel. No email or SMS sending is required by the ERP.</li><li>The staff member opens the link, confirms their Login ID, sets their own password and completes two-factor authentication.</li><li>The link expires after 15 minutes. A reset revokes all previous reset links and active sessions. Contract expiry changes the account to Inactive while retained records remain available for audit history.</li></ol></div>`;

    const form = body.querySelector("#staffUserForm");
    const position = form?.elements.position;
    const rightsPreview = body.querySelector("#newStaffRightsPreview");
    const staffIdInput = form?.elements.staffId;
    const loginIdInput = form?.elements.loginId;
    position?.addEventListener("change", () => { rightsPreview.textContent = `Rights: ${rights[position.value]}`; });
    staffIdInput?.addEventListener("input", () => { if (!loginIdInput.value) loginIdInput.value = staffIdInput.value.toUpperCase(); });
    form?.addEventListener("submit", event => {
      event.preventDefault();
      saveProfile(form);
    });
    body.querySelectorAll("[data-edit-staff]").forEach(button => button.addEventListener("click", () => beginEdit(button.dataset.editStaff)));
    body.querySelector("#staffCancelEdit")?.addEventListener("click", () => {
      const prior = editingId;
      editingId = null;
      editingSnapshot = null;
      render();
      Array.from(body.querySelectorAll("[data-edit-staff]")).find(button => button.dataset.editStaff === prior)?.focus();
      setNotice("Edit cancelled. No changes were saved.");
    });
    body.querySelectorAll("[data-link-type]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.linkType === "reset" ? "password-reset" : "first-login setup";
      setNotice(`The ${action} link must be generated by the secure backend. It must return one single-use URL with a Copy link button, a 15-minute expiry and a hashed token. No link is generated in this public preview.`, true);
    }));
  }

  const style = document.createElement("style");
  style.textContent = `.staff-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0 18px}.staff-summary-grid>div{padding:13px;border:1px solid #dbe7df;border-radius:9px;background:#f9fcfa}.staff-summary-grid b{display:block;font-size:23px;color:#14563e}.staff-summary-grid span{font-size:11px;color:#637168}.staff-access-notice{margin:12px 0;padding:10px 12px;border:1px solid #cde0d4;border-radius:7px;background:#f4fbf6;color:#1f6045;font-size:12px}.staff-access-notice.error{border-color:#dfb7b7;background:#fdf2f2;color:#962f2f}.staff-directory-table td{vertical-align:top}.staff-directory-table .hint{line-height:1.45}.staff-account-status{display:inline-block;padding:3px 7px;border-radius:999px;background:#edf2f0;color:#4e5d55;font-size:11px;font-weight:700}.staff-account-status.setup-link-required{background:#fff4d9;color:#8a5c09}.staff-account-status.active{background:#e4f5ea;color:#17613e}.staff-add-section{margin-top:22px}.staff-rights-preview{padding:11px 13px;border:1px solid #d7e4dc;border-radius:7px;background:#f8fbf9;color:#4a5d53;font-size:12px}.staff-invite-flow{margin-top:18px;padding:15px 18px;border-radius:9px;background:#f8faf9;border:1px solid #dfe8e2}.staff-invite-flow h3{margin-top:0}.staff-invite-flow ol{margin:0;padding-left:20px;color:#536158;font-size:12px;line-height:1.65}.staff-link{font-size:11px;margin:2px}@media(max-width:900px){.staff-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.staff-summary-grid{grid-template-columns:1fr}}`;
  style.textContent += `.staff-name-edit{border:0;background:transparent;color:var(--brand-dark,#07523c);font:inherit;font-weight:700;text-align:left;padding:0;text-decoration:underline;text-underline-offset:3px}.staff-name-edit:hover{color:#0b6b4f}.staff-name-edit:focus-visible{outline:2px solid #0b6b4f;outline-offset:4px;border-radius:3px}.staff-edit-feedback:empty{display:none}.staff-edit-feedback{padding:10px;border:1px solid #b8cec0;border-radius:7px;color:#245b3d}.staff-edit-feedback.error{color:#962f2f;background:#fff4f4;border-color:#dfb7b7}.staff-edit-history{margin-top:15px;padding:12px;background:#f8faf9;border:1px solid #dfe8e2;border-radius:8px}.staff-edit-history summary{cursor:pointer;font-weight:700}.staff-edit-history li{margin:5px 0;overflow-wrap:anywhere}#staffProfileEditor{scroll-margin-top:16px}#staffUserForm input[readonly]{background:#f2f5f3;color:#637168}`;
  document.head.append(style);
  function staffPanelIsSelected() {
    return Array.from(document.querySelectorAll("[data-settings-menu='staff']")).some(button => button.classList.contains("active") && button.closest(".tab-panel")?.classList.contains("active"));
  }
  function queueRender() {
    window.setTimeout(() => { if (staffPanelIsSelected()) render(); }, 40);
  }
  document.addEventListener("click", event => { if (event.target.closest("[data-settings-menu='staff']")) queueRender(); }, true);
  document.addEventListener("click", event => { if (event.target.closest("[data-settings-menu='staff']")) queueRender(); });
  const settingsObserver = new MutationObserver(() => {
    const body = document.getElementById("settingsBody");
    if (body && staffPanelIsSelected() && body.dataset.staffAccessLoaded !== "true") {
      body.dataset.staffAccessLoaded = "true";
      queueRender();
    }
  });
  settingsObserver.observe(document.body, { childList: true, subtree: true });
  function ensureStaffDirectory() {
    const hr = document.getElementById("hr");
    if (!hr) return;
    let host = document.getElementById("staffDirectoryBody");
    if (!canEditStaff()) { host?.remove(); return; }
    if (!host) { host = document.createElement("section"); host.id = "staffDirectoryBody"; host.className = "card side-card"; hr.prepend(host); }
    if (hr.classList.contains("active") && !staffPanelIsSelected() && !host.querySelector("#staffUserForm")) render();
  }
  new MutationObserver(ensureStaffDirectory).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener("change", () => { ensureStaffDirectory(); if (!canEditStaff() && currentHost?.querySelector("#staffUserForm")) currentHost.replaceChildren(); });
  ensureStaffDirectory();
  window.pclStaffAccessPreview = { render, staffList };
})();
