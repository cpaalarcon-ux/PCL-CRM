/*
  Client visibility and work-allocation UAT panel for the browser ERP preview.
  This panel is for testing the policy; the production server must enforce it.
*/
(function () {
  "use strict";

  const previewKey = "pcl-unified-shell-preview-v1";
  const actorKey = "pcl-access-uat-actor-v1";
  const storeKey = "pcl-allocation-preview-v1";
  const labels = { PARTNER: "Engagement Partner", MANAGER: "Manager", SUPERVISOR: "Audit Supervisor", ASSISTANT: "Audit Assistant", INTERN: "Intern" };
  const roleCodes = Object.fromEntries(Object.entries(labels).map(([code, label]) => [label, code]));
  const core = () => window.PCLAccessControl;
  const esc = value => String(value ?? "").replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  const readStore = () => {
    try { const data = JSON.parse(localStorage.getItem(storeKey) || "{}"); return { requests: Array.isArray(data.requests) ? data.requests : [], assignmentChanges: Array.isArray(data.assignmentChanges) ? data.assignmentChanges : [], audit: Array.isArray(data.audit) ? data.audit : [] }; }
    catch (_) { return { requests: [], assignmentChanges: [], audit: [] }; }
  };
  const saveStore = data => localStorage.setItem(storeKey, JSON.stringify(data));
  const roleCode = role => roleCodes[role] || role || "PARTNER";
  function activeFirms() { try { return typeof window.activeFirms === "function" ? window.activeFirms() : []; } catch (_) { return []; } }
  function engagements() { try { return typeof window.activeEngagements === "function" ? window.activeEngagements() : []; } catch (_) { return []; } }
  function preview() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(actorKey) || "{}"); } catch (_) {}
    if (saved.role && saved.staffId) return saved;
    try {
      const shell = JSON.parse(localStorage.getItem(previewKey) || "{}");
      const role = shell.category || "Engagement Partner";
      return { role, staffId: shell.staffId || "PREVIEW-" + role.toUpperCase().replace(/[^A-Z0-9]+/g, "-") };
    } catch (_) { return { role: "Engagement Partner", staffId: "PREVIEW-PARTNER" }; }
  }
  function actor() {
    const current = preview();
    return { id: String(current.staffId || "").trim(), role: roleCode(current.role), status: "Active", firmIds: activeFirms().map(firm => firm.id), projectIds: [] };
  }
  function taskIds(task, keys) { return keys.flatMap(key => { const value = task?.[key]; return Array.isArray(value) ? value : value ? [value] : []; }).filter(Boolean).map(String); }
  function projectRecord(project, scope = "summary") {
    const changes = readStore().assignmentChanges.filter(change => change.projectId === project.id);
    const ended = new Set(changes.filter(change => change.type === "END").map(change => change.assignmentId));
    const resources = project.resources || {};
    const base = [resources.supervisorUserId, resources.assistantUserId].filter(Boolean).map(id => ({ id: "base-" + project.id + "-" + id, staffId: String(id) }));
    const assigned = base.filter(item => !ended.has(item.id)).map(item => item.staffId);
    const today = new Date().toISOString().slice(0, 10);
    const added = changes.filter(change => change.type === "ADD" && change.startDate <= today && !ended.has(change.id)).map(change => change.staffId);
    const tasks = Array.isArray(project.workflowTasks) ? project.workflowTasks : [];
    return {
      firmId: project.firmId, projectId: project.id, scope,
      allocatedStaffIds: [...assigned, ...added],
      taskAssigneeIds: tasks.flatMap(task => taskIds(task, ["assignedStaffId", "assignedToStaffId", "assigneeId", "ownerStaffId", "taskAssigneeIds"])),
      taskReviewerIds: tasks.flatMap(task => taskIds(task, ["reviewerStaffId", "assignedReviewerId", "reviewAssignedTo", "taskReviewerIds"])),
    };
  }
  function currentPreparers(project) {
    const changes = readStore().assignmentChanges.filter(change => change.projectId === project.id);
    const ended = new Set(changes.filter(change => change.type === "END").map(change => change.assignmentId));
    const resources = project.resources || {};
    const base = resources.assistantUserId ? [{ id: "base-" + project.id + "-" + resources.assistantUserId, projectId: project.id, staffId: String(resources.assistantUserId), role: "PREPARER", startDate: resources.assistantStartDate || project.startDate || "", endDate: null }] : [];
    const additions = changes.filter(change => change.type === "ADD" && change.role === "PREPARER" && !ended.has(change.id));
    return [...base, ...additions].filter(item => !ended.has(item.id));
  }
  function taskRecord(project, task) {
    const record = projectRecord(project, "detail");
    record.taskAssigneeIds = taskIds(task, ["assignedStaffId", "assignedToStaffId", "assigneeId", "ownerStaffId", "taskAssigneeIds"]);
    record.taskReviewerIds = taskIds(task, ["reviewerStaffId", "assignedReviewerId", "reviewAssignedTo", "taskReviewerIds"]);
    return record;
  }
  function inject() {
    const buttonHost = document.querySelector(".header-actions");
    const host = document.querySelector(".shell") || document.body;
    if (!document.getElementById("accessUatOpen") && buttonHost) {
      const button = document.createElement("button"); button.id = "accessUatOpen"; button.type = "button"; button.className = "btn secondary"; button.textContent = "Client & access UAT";
      button.addEventListener("click", openPanel); buttonHost.prepend(button);
    }
    if (document.getElementById("accessControlUatPanel")) return;
    const panel = document.createElement("section"); panel.id = "accessControlUatPanel"; panel.hidden = true;
    panel.setAttribute("aria-label", "Client visibility and allocation UAT");
    panel.style.cssText = "position:fixed;inset:4vh 4vw;z-index:10000;overflow:auto;background:#fff;padding:24px;border:1px solid #cddbd2;border-radius:16px;box-shadow:0 20px 80px rgba(0,0,0,.25)";
    panel.innerHTML = `<div class="intro"><div><h2>Client visibility &amp; work allocation UAT</h2><p>Use different staff IDs to verify directory visibility, task access, reviewer independence and allocation approval.</p></div><button type="button" id="accessUatClose" class="btn secondary">Close</button></div>
      <div class="settings-note">This is a browser preview. Requests and decisions are stored locally for UAT; production permissions and assignment changes must be enforced by the authenticated ERP service.</div>
      <form id="accessActorForm" class="firm-profile-grid"><label>Preview role<select name="role">${Object.entries(labels).map(([code, label]) => `<option value="${code}">${label}</option>`).join("")}</select></label><label>Staff ID<input required maxlength="80" name="staffId" /></label><div class="actions"><button class="btn primary" type="submit">Apply preview user</button></div></form>
      <div id="accessUatMessage" class="hint" role="status"></div>
      <div class="section"><div class="section-heading"><h3>Companies and projects visible to this user</h3><span class="hint">Project summary can be visible while detailed working data remains locked.</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Client / project</th><th>Handling firm</th><th>Service</th><th>Access</th><th>Task data</th><th>Action</th></tr></thead><tbody id="accessUatProjects"></tbody></table></div></div>
      <div class="section card side-card"><div class="section-heading"><div><h3>Request work allocation</h3><span class="hint">A different Manager or Engagement Partner must approve or decline.</span></div></div><form id="accessAllocationForm" class="firm-profile-grid"><label class="full">Project<select required name="projectId"></select></label><label>Requested start date<input required type="date" name="requestedStartDate" /></label><label class="checkbox-line"><input type="checkbox" name="takeover" /> Request takeover of the current preparer allocation</label><label class="full">Reason<textarea required name="reason" maxlength="1000"></textarea></label><div class="actions full"><button class="btn primary" type="submit">Submit request</button></div></form></div>
      <div class="section"><div class="section-heading"><h3>Allocation requests and approval queue</h3><span class="hint">Declines require a reason. Approved takeovers preserve drafts with their original preparers.</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Project / requester</th><th>Reason</th><th>Start date</th><th>Status</th><th>Decision</th></tr></thead><tbody id="accessAllocationQueue"></tbody></table></div></div>`;
    host.append(panel);
    panel.querySelector("#accessUatClose").addEventListener("click", () => { panel.hidden = true; });
    panel.querySelector("#accessActorForm").addEventListener("submit", saveActor);
    panel.querySelector("#accessAllocationForm").addEventListener("submit", submitAllocation);
    panel.addEventListener("click", allocationDecision);
    render();
  }
  function openPanel() {
    const panel = document.getElementById("accessControlUatPanel"); if (!panel) return;
    panel.hidden = false; render(); panel.scrollTop = 0;
  }
  function saveActor(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    localStorage.setItem(actorKey, JSON.stringify({ role: labels[data.role] || data.role, staffId: String(data.staffId || "").trim() }));
    setMessage("Preview user updated. Review the access column and request or approval controls."); render();
  }
  function render() {
    const panel = document.getElementById("accessControlUatPanel"); if (!panel) return;
    const current = preview(), form = panel.querySelector("#accessActorForm");
    if (form) { form.elements.role.value = roleCode(current.role); form.elements.staffId.value = current.staffId || ""; }
    const api = core(), user = actor(), rows = document.getElementById("accessUatProjects"), select = panel.querySelector('#accessAllocationForm select[name="projectId"]');
    const all = engagements().filter(project => user.firmIds.includes(project.firmId));
    const visible = api ? all.filter(project => api.can(user, "projects", "V", projectRecord(project, "summary")).ok) : [];
    if (select) select.innerHTML = visible.map(project => `<option value="${esc(project.id)}">${esc(project.companyName || "Client")} · ${esc(project.id)}</option>`).join("");
    if (rows) rows.innerHTML = visible.length ? visible.map(project => {
      const record = projectRecord(project, "detail"), detail = api.can(user, "projects", "V", record).ok;
      const tasks = (project.workflowTasks || []).filter(task => api.can(user, "tasks", "V", taskRecord(project, task)).ok);
      const taskHtml = detail ? (tasks.length ? tasks.map(task => esc(task.title || task.name || "Task") + " · " + esc(task.status || "Open")).join("<br>") : "No visible tasks") : "Hidden until allocation or task assignment";
      const allocated = api.hasProjectAllocation(user, record);
      const action = detail ? "Client details and working data available" : "Project summary only";
      const request = user.role !== "INTERN" && !allocated ? `<button type="button" data-copy-project="${esc(project.id)}">Request allocation</button>` : "";
      return `<tr><td><b>${esc(project.companyName || "Client")}</b><br><span class="hint">${esc(project.id)}</span></td><td>${esc(typeof window.firmLabel === "function" ? window.firmLabel(project.firmId) : project.firmId)}</td><td>${esc(project.initialService || "Not set")}</td><td>${esc(action)}</td><td>${taskHtml}</td><td>${request}</td></tr>`;
    }).join("") : '<tr><td colspan="6" class="hint">No company/project records are visible for this user in the authorised firms.</td></tr>';
    renderQueue();
  }
  function setMessage(value) { const node = document.getElementById("accessUatMessage"); if (node) node.textContent = value; }
  function submitAllocation(event) {
    event.preventDefault();
    const api = core(), user = actor(), data = Object.fromEntries(new FormData(event.target).entries()), project = engagements().find(item => item.id === data.projectId);
    if (!api || !project) return setMessage("Select an available project.");
    const store = readStore();
    if (store.requests.some(request => request.status === api.ALLOCATION_STATUS.PENDING && request.projectId === project.id && request.requesterId === user.id)) return setMessage("You already have a pending request for this project.");
    const result = api.createAllocationRequest({ requester: user, project: { id: project.id, firmId: project.firmId }, reason: data.reason, takeover: event.target.elements.takeover.checked, requestedStartDate: data.requestedStartDate, id: "ALR-" + Date.now() });
    if (!result.ok) return setMessage(result.reason);
    result.request.projectLabel = project.companyName || project.id;
    result.request.currentAssignments = currentPreparers(project);
    store.requests.push(result.request);
    store.audit.push(api.historyRow(user, "allocation_request", result.request.id, "SUBMIT", result.request.reason));
    saveStore(store); event.target.elements.reason.value = ""; event.target.elements.takeover.checked = false;
    setMessage("Request sent to the Manager / Engagement Partner approval queue."); renderQueue();
  }
  function allocationDecision(event) {
    const button = event.target.closest("button[data-allocation-decision]"); if (!button) return;
    const api = core(), user = actor(), store = readStore(), request = store.requests.find(item => item.id === button.dataset.requestId);
    if (!api || !request) return;
    let reason = "";
    if (button.dataset.allocationDecision === "DECLINE") reason = window.prompt("Reason for declining this request:", "") || "";
    if (button.dataset.allocationDecision === "DECLINE" && !reason.trim()) return setMessage("A reason is required when declining.");
    const effectiveDate = button.closest("tr")?.querySelector("[data-effective-date]")?.value || request.requestedStartDate;
    const result = api.decideAllocationRequest({ approver: user, request, decision: button.dataset.allocationDecision, reason, effectiveDate, currentAssignments: request.currentAssignments || [] });
    if (!result.ok) return setMessage(result.reason);
    const index = store.requests.findIndex(item => item.id === request.id);
    store.requests[index] = { ...result.request, projectLabel: request.projectLabel, assignmentChanges: result.assignmentChanges, draftsRemainWithOriginalOwner: result.draftsRemainWithOriginalOwner };
    store.assignmentChanges.push(...result.assignmentChanges);
    store.audit.push(api.historyRow(user, "allocation_request", request.id, result.request.status, result.request.decisionReason));
    saveStore(store); setMessage(result.request.status === "APPROVED" ? "Approved. The allocation change is recorded; existing drafts remain with their original preparers." : "Request declined with a reason."); render();
  }
  function renderQueue() {
    const target = document.getElementById("accessAllocationQueue"); if (!target) return;
    const api = core(), currentActor = actor(), store = readStore(), canDecide = ["PARTNER", "MANAGER"].includes(currentActor.role);
    const items = store.requests.filter(request => currentActor.firmIds.includes(request.firmId));
    target.innerHTML = items.length ? items.slice().reverse().map(request => {
      const controls = request.status === "PENDING" && canDecide ? `<input aria-label="Allocation effective date" type="date" data-effective-date value="${esc(request.requestedStartDate)}"><button type="button" data-allocation-decision="APPROVE" data-request-id="${esc(request.id)}">Approve</button><button type="button" data-allocation-decision="DECLINE" data-request-id="${esc(request.id)}">Decline</button>` : esc(request.decidedByRole ? request.decidedByRole + " · " + (request.decisionReason || request.status) : "Waiting for a Manager / Partner");
      return `<tr><td><b>${esc(request.projectLabel || request.projectId)}</b><br><span class="hint">${esc(request.requesterId)} · ${esc(labels[request.requesterRole] || request.requesterRole)}${request.takeover ? " · takeover" : ""}</span></td><td>${esc(request.reason)}</td><td>${esc(request.requestedStartDate)}</td><td>${esc(request.status)}</td><td><div class="shared-board-actions">${controls}</div></td></tr>`;
    }).join("") : '<tr><td colspan="5" class="hint">No allocation requests recorded.</td></tr>';
  }
  function copyProjectToForm(event) {
    const button = event.target.closest("button[data-copy-project]"); if (!button) return;
    const form = document.getElementById("accessAllocationForm"); if (!form) return;
    form.elements.projectId.value = button.dataset.copyProject;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    form.elements.reason.focus();
  }
  function bindProjectCopy() {
    document.getElementById("accessControlUatPanel")?.addEventListener("click", copyProjectToForm);
  }
  function boot() {
    inject(); bindProjectCopy();
    const observer = new MutationObserver(() => { if (!document.getElementById("accessControlUatPanel")) inject(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  window.PCLAccessControlUAT = Object.freeze({ render, actor, projectRecord });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
