/*
  Staff, contract and access preview.
  Authentication belongs on the secure backend. This public browser preview
  deliberately contains no names, staff IDs, contact details, passwords, OTPs,
  reset links or rates. Profiles added here stay only in this browser.
*/
(function () {
  "use strict";

  const storageKey = "pcl-staff-directory-preview-v2";
  const rights = {
    "Engagement Partner": "All authorised firms, all clients and engagements, financial WIP, approvals and PIE/EQR sign-off. System settings remain restricted to System Administrators.",
    "Manager": "Assigned firms and teams, client and engagement management, timesheet approval and engagement financials for assigned work. No system settings or final Partner sign-off.",
    "Audit Supervisor": "Assigned projects, fieldwork tasks, documents and team coordination. Engagement fees, rates, invoices and exports are hidden.",
    "Audit Assistant": "Read-only assigned client details, assigned tasks and personal time. No fees, rates, client-list export, deletion or work outside assigned engagements.",
    "Intern": "Only tasks explicitly assigned to the intern and documents attached to those tasks. No client contacts, financial data, client lists or exports."
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[char]));
  const read = () => { try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch (_) { return []; } };
  const save = staff => localStorage.setItem(storageKey, JSON.stringify(staff));
  const dateLabel = value => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Not set";
  const staffList = () => read().sort((a, b) => a.staffId.localeCompare(b.staffId));

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
    const body = document.getElementById("settingsBody");
    if (!body) return;
    const staff = staffList();
    body.innerHTML = `
      <div class="settings-note">Staff IDs are the default Login IDs. One-time setup and password-reset links are copied by an authorised administrator and shared through an approved channel. This preview never creates or stores a password, OTP, contact detail, link token or approved rate.</div>
      <div class="section-heading"><h3>Staff users and contract register</h3><span class="hint">Contract status, billing status and access rights are separate controls.</span></div>
      <div id="staffAccessNotice" class="staff-access-notice">No staff records are published in this public preview. Add profiles here for local workflow testing, or connect the secure backend for the live directory.</div>
      <div class="staff-summary-grid"><div><b>${staff.length}</b><span>Local staff profiles</span></div><div><b>${staff.filter(item => item.employmentType === "Contract").length}</b><span>Contract staff</span></div><div><b>${staff.filter(item => item.billingStatus === "Billable").length}</b><span>Billable staff</span></div><div><b>${staff.filter(item => accountLabel(item) === "Active").length}</b><span>Active accounts</span></div></div>
      <div class="table-wrap staff-directory-table"><table class="data-table settings-table"><thead><tr><th>Staff member</th><th>Employment and billing</th><th>Contract term</th><th>Account setup</th><th>Access rights</th><th>Link controls</th></tr></thead><tbody>${staff.length ? staff.map(item => `<tr><td><b>${escapeHtml(item.fullName)}</b><br><span class="hint">${escapeHtml(item.staffId)} · ${escapeHtml(item.position)}</span></td><td><span class="permission-tag">${escapeHtml(item.employmentType)}</span> <span class="permission-tag">${escapeHtml(item.billingStatus)}</span><br><span class="hint">Rate: ${escapeHtml(item.rateStatus || "Pending Finance approval")}</span></td><td>${dateLabel(item.contractStartDate)}<br><span class="hint">to ${dateLabel(item.contractEndDate)}</span></td><td><span class="staff-account-status ${accountLabel(item).toLowerCase().replace(/[^a-z]+/g, "-")}">${escapeHtml(accountLabel(item))}</span><br><span class="hint">Login ID: ${escapeHtml(item.loginId || "Not set")}</span></td><td><span class="hint">${escapeHtml(rights[item.position] || "Rights not configured")}</span></td><td>${linkControls(item)}</td></tr>`).join("") : '<tr><td colspan="6" class="hint">No staff profile is stored in this browser. Create one below or connect the secure staff directory.</td></tr>'}</tbody></table></div>
      <div class="section staff-add-section"><div class="section-heading"><h3>Add staff member</h3><span class="hint">These same controls apply to every future staff member.</span></div><form id="staffUserForm" class="firm-profile-grid"><label>Staff ID <span>*</span><input required name="staffId" placeholder="e.g. AP0013" /></label><label>Login ID <span>*</span><input required name="loginId" placeholder="Usually the same as Staff ID" /></label><label>Full name <span>*</span><input required name="fullName" placeholder="Staff member's name" /></label><label>Staff category <span>*</span><select required name="position"><option>Engagement Partner</option><option>Manager</option><option>Audit Supervisor</option><option selected>Audit Assistant</option><option>Intern</option></select></label><label>Employment type <span>*</span><select required name="employmentType"><option>Permanent</option><option selected>Contract</option><option>Internship</option><option>Consultant</option></select></label><label>Billing status <span>*</span><select required name="billingStatus"><option selected>Billable</option><option>Partially billable</option><option>Non-billable</option></select></label><label>Firm scope <span>*</span><select required name="firmScope"><option selected>Assigned firms</option><option>All firms</option></select></label><label>Contract start date <input required type="date" name="contractStartDate" value="2026-01-01" /></label><label>Contract end date <input type="date" name="contractEndDate" value="2027-12-31" /></label><label>Client scope <span>*</span><select required name="clientScope"><option selected>Assigned clients</option><option>All clients in firm scope</option></select></label><label>Project scope <span>*</span><select required name="projectScope"><option selected>Assigned tasks</option><option>Assigned projects</option><option>All projects in firm scope</option></select></label><div class="full staff-rights-preview" id="newStaffRightsPreview">Rights: ${escapeHtml(rights["Audit Assistant"])}</div><div class="actions full"><button class="btn primary" type="submit">Create staff profile</button></div></form></div>
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
      const data = Object.fromEntries(new FormData(form).entries());
      data.staffId = data.staffId.trim().toUpperCase(); data.loginId = data.loginId.trim().toUpperCase(); data.fullName = data.fullName.trim();
      if (staff.some(item => item.staffId === data.staffId)) return setNotice("A staff profile already uses this Staff ID. Update that profile instead of creating a duplicate.", true);
      if (staff.some(item => item.loginId.toUpperCase() === data.loginId)) return setNotice("A staff profile already uses this Login ID. Choose a unique Login ID.", true);
      if (data.employmentType === "Contract" && !data.contractEndDate) return setNotice("A contract staff member needs a contract end date so account access can close correctly.", true);
      if (data.contractEndDate && data.contractEndDate < data.contractStartDate) return setNotice("Contract end date cannot be earlier than the contract start date.", true);
      const saved = read(); saved.push({ ...data, accountStatus: "Setup link required", rateStatus: "Pending Finance approval" }); save(saved); render();
      setNotice("Staff profile created. Generate a one-time setup link from the secure backend, then copy and paste it to the staff member. No password or token was created in this browser.");
    });
    body.querySelectorAll("[data-link-type]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.linkType === "reset" ? "password-reset" : "first-login setup";
      setNotice(`The ${action} link must be generated by the secure backend. It must return one single-use URL with a Copy link button, a 15-minute expiry and a hashed token. No link is generated in this public preview.`, true);
    }));
  }

  const style = document.createElement("style");
  style.textContent = `.staff-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0 18px}.staff-summary-grid>div{padding:13px;border:1px solid #dbe7df;border-radius:9px;background:#f9fcfa}.staff-summary-grid b{display:block;font-size:23px;color:#14563e}.staff-summary-grid span{font-size:11px;color:#637168}.staff-access-notice{margin:12px 0;padding:10px 12px;border:1px solid #cde0d4;border-radius:7px;background:#f4fbf6;color:#1f6045;font-size:12px}.staff-access-notice.error{border-color:#dfb7b7;background:#fdf2f2;color:#962f2f}.staff-directory-table td{vertical-align:top}.staff-directory-table .hint{line-height:1.45}.staff-account-status{display:inline-block;padding:3px 7px;border-radius:999px;background:#edf2f0;color:#4e5d55;font-size:11px;font-weight:700}.staff-account-status.setup-link-required{background:#fff4d9;color:#8a5c09}.staff-account-status.active{background:#e4f5ea;color:#17613e}.staff-add-section{margin-top:22px}.staff-rights-preview{padding:11px 13px;border:1px solid #d7e4dc;border-radius:7px;background:#f8fbf9;color:#4a5d53;font-size:12px}.staff-invite-flow{margin-top:18px;padding:15px 18px;border-radius:9px;background:#f8faf9;border:1px solid #dfe8e2}.staff-invite-flow h3{margin-top:0}.staff-invite-flow ol{margin:0;padding-left:20px;color:#536158;font-size:12px;line-height:1.65}.staff-link{font-size:11px;margin:2px}@media(max-width:900px){.staff-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.staff-summary-grid{grid-template-columns:1fr}}`;
  document.head.append(style);
  function staffPanelIsSelected() {
    return Array.from(document.querySelectorAll("[data-settings-menu='staff']")).some(button => button.classList.contains("active"));
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
  window.pclStaffAccessPreview = { render, staffList };
})();
