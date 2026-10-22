/*
  Unified ERP shell
  This is intentionally a browser-preview shell.  It reorganises the existing
  working modules without presenting localStorage data or visibility controls
  as server-side authentication or accounting integrations.
*/
(function () {
  "use strict";

  const preferenceKey = "pcl-unified-shell-preview-v1";
  const settingsKey = "pcl-erp-settings-preview-v1";
  const staffCategories = ["Engagement Partner", "Manager", "Audit Supervisor", "Audit Assistant", "Intern"];
  const functionalPermissions = ["System Administration", "Finance", "HR"];
  const rolePolicy = {
    "Engagement Partner": { modules: ["clients", "projects", "finance", "timehr", "communications"], finance: "full", description: "All client and engagement work across assigned firms; finance access subject to the assigned finance permission." },
    "Manager": { modules: ["clients", "projects", "timehr", "communications"], finance: "view", description: "Team client and project work; finance is read-only where explicitly permitted." },
    "Audit Supervisor": { modules: ["clients", "projects", "timehr", "communications"], finance: "none", description: "Assigned fieldwork, tasks, evidence and team coordination only." },
    "Audit Assistant": { modules: ["clients", "projects", "timehr", "communications"], finance: "none", description: "Read-only assigned clients, assigned tasks and personal time only." },
    "Intern": { modules: ["projects", "timehr", "communications"], finance: "none", description: "Only specifically assigned tasks, task documents and personal time." }
  };
  const groups = {
    clients: { label: "Clients", icon: "⌂", items: [
      { label: "Directory", panel: "clients" }, { label: "Client Vault", panel: "vault" }, { label: "Client billing", panel: "invoices-statements", hint: "Client-specific billing is filtered by the selected client when a backend is connected." }
    ] },
    projects: { label: "Projects & Tasks", icon: "✓", items: [
      { label: "Shared workboard", panel: "shared-workboard" }, { label: "Lead & engagement", panel: "lifecycle" }, { label: "Audit workspace", panel: "audit-workspace" }, { label: "Tax projects", panel: "tax-projects" }, { label: "Recurring tasks", panel: "recurring-tasks" }
    ] },
    finance: { label: "Finance", icon: "KES", items: [
      { label: "Invoices & receivables", panel: "invoices-statements", anchor: "invoiceStatementRows" }, { label: "Payments", panel: "invoices-statements", anchor: "receivablePaymentForm" }, { label: "Firm statements", panel: "invoices-statements", anchor: "statementGenerator" }, { label: "Relationship summary", panel: "invoices-statements", anchor: "statementGenerator" }
    ] },
    timehr: { label: "Time & HR", icon: "◷", items: [
      { label: "My time & WIP", panel: "operations" }, { label: "Team & HR", panel: "hr" }, { label: "Attendance", panel: "attendance" }
    ] },
    communications: { label: "Communications", icon: "◌", items: [
      { label: "Communication hub", panel: "communications" }, { label: "Channels & meetings", panel: "meetings" }, { label: "Email workspace", panel: "email-workspace" }, { label: "Support", panel: "helpdesk" }
    ] },
    settings: { label: "Settings", icon: "⚙", items: [
      { label: "Firm & company", setting: "firm" }, { label: "Staff & users", setting: "staff" }, { label: "Login & security", setting: "security" }, { label: "Client defaults", setting: "defaults" }, { label: "Finance & billing", setting: "billing" }, { label: "KRA engine", setting: "kra" }
    ] }
  };

  function getPreview() {
    try {
      const value = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      const category = staffCategories.includes(value.category) ? value.category : "Engagement Partner";
      const permissions = Array.isArray(value.permissions) ? value.permissions.filter(permission => functionalPermissions.includes(permission)) : ["System Administration", "Finance", "HR"];
      return { category, permissions };
    } catch (_) { return { category: "Engagement Partner", permissions: ["System Administration", "Finance", "HR"] }; }
  }
  function savePreview(value) { localStorage.setItem(preferenceKey, JSON.stringify(value)); }
  function getSettings() {
    try { return JSON.parse(localStorage.getItem(settingsKey) || "{}"); } catch (_) { return {}; }
  }
  function saveSettings(value) { localStorage.setItem(settingsKey, JSON.stringify(value)); }
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
  function firmList() { try { return typeof activeFirms === "function" ? activeFirms() : []; } catch (_) { return []; } }
  function firmName(id) { try { return typeof firmLabel === "function" ? firmLabel(id) : id; } catch (_) { return id; } }
  function permittedModules(preview) {
    const base = new Set(rolePolicy[preview.category].modules);
    if (preview.permissions.includes("Finance")) base.add("finance");
    if (preview.permissions.includes("HR")) base.add("timehr");
    if (preview.permissions.includes("System Administration")) base.add("settings");
    return base;
  }
  function allowed(group, preview) { return permittedModules(preview).has(group); }
  function roleTitle(preview) {
    const permissions = preview.permissions.map(permission => permission === "System Administration" ? "System administrator" : permission);
    return preview.category + (permissions.length ? " · " + permissions.join(" · ") : "");
  }

  function injectStyles() {
    if (document.getElementById("unifiedShellStyles")) return;
    const style = document.createElement("style");
    style.id = "unifiedShellStyles";
    style.textContent = `
      .tabs.legacy-hidden{display:none!important}.unified-tabs{display:flex;align-items:center;gap:6px;overflow:auto;padding:0 0 13px;margin:0 0 20px;border-bottom:1px solid var(--line)}.unified-tabs button{white-space:nowrap;border:0;background:transparent;color:#66766d;font-weight:750;padding:9px 12px;border-radius:999px}.unified-tabs button:hover{color:var(--brand);background:#eef7f1}.unified-tabs button.active{background:#dff1e7;color:var(--brand-dark)}.unified-tabs button[hidden]{display:none}.unified-tabs .dashboard-link{margin-left:auto;border:1px solid #cad9d0;color:#315d49}.unified-tabs .dashboard-link:hover{background:#fff}.unified-subnav{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:-8px 0 18px;padding:9px 12px;border:1px solid #dce7e0;border-radius:10px;background:#fff;box-shadow:0 3px 10px rgba(17,57,38,.035)}.unified-subnav[hidden]{display:none}.unified-subnav b{font-size:12px;color:#315d49;margin-right:4px}.unified-subnav button{border:0;background:transparent;color:#607269;font-size:12px;padding:6px 8px;border-radius:6px}.unified-subnav button:hover,.unified-subnav button.active{color:var(--brand-dark);background:#eaf5ee;font-weight:800}.erp-preview-control{display:flex;align-items:center;gap:6px;color:#dbe8e1;font-size:11px;font-weight:700}.erp-preview-control select{width:176px;min-height:34px;margin:0;padding:6px 25px 6px 8px;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.26);color:#fff;font-size:12px}.erp-preview-control option{background:#fff;color:#253f34}.smart-routing{margin-bottom:19px}.smart-routing-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}.smart-routing-head h3{margin:0 0 3px;font-size:17px}.smart-routing-head p{margin:0;color:var(--muted);font-size:12px}.preview-badge{display:inline-block;padding:4px 7px;border-radius:999px;background:#fff5db;color:#76520c;font-size:11px;font-weight:800;white-space:nowrap}.routing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.routing-card{padding:16px;border:1px solid #dbe8e0;border-radius:11px;background:#fff;box-shadow:var(--shadow)}.routing-card .routing-icon{color:var(--brand);font-weight:900;font-size:13px}.routing-card b{display:block;font-size:25px;color:var(--brand-dark);margin:5px 0 2px}.routing-card span{display:block;color:#455c50;font-size:13px;font-weight:800}.routing-card small{display:block;color:var(--muted);margin-top:3px;font-size:11px}.routing-card button{padding:0;border:0;background:transparent;color:var(--brand-dark);font-weight:800;text-decoration:underline;font-size:11px;margin-top:10px}.settings-layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:18px}.settings-menu{padding:9px}.settings-menu button{display:block;width:100%;text-align:left;border:0;background:transparent;border-radius:7px;padding:10px;color:#53665b;font-weight:700;font-size:12px}.settings-menu button.active,.settings-menu button:hover{background:#e9f5ed;color:var(--brand-dark)}.settings-body{padding:22px}.settings-note{padding:12px 14px;background:#fff8e9;border:1px solid #ecd69b;border-radius:8px;color:#73531c;font-size:12px;margin-bottom:16px}.settings-table td,.settings-table th{vertical-align:top}.permission-tag{display:inline-block;margin:3px 3px 0 0;padding:3px 7px;border-radius:999px;background:#e9f4ec;color:#245f43;font-size:11px;font-weight:800}.shell-no-access{padding:30px;text-align:center;color:#6d7a73}.shell-no-access h2{color:#335546}.shell-mode-timehr #operations #invoiceForm,.shell-mode-timehr #operations #invoicePaymentForm{display:none!important}.shell-backend-note{font-size:11px;color:#7b887f;margin-top:16px}.header-actions{flex-wrap:wrap}.firm-profile-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media(max-width:900px){.settings-layout{grid-template-columns:1fr}.settings-menu{display:flex;overflow:auto;gap:3px}.settings-menu button{white-space:nowrap;width:auto}.routing-grid{grid-template-columns:1fr}.erp-preview-control{width:100%}.erp-preview-control select{width:100%}}@media(max-width:600px){.unified-tabs .dashboard-link{margin-left:0}.firm-profile-grid{grid-template-columns:1fr}}
    `;
    document.head.append(style);
    const v4Style = document.createElement("style");
    v4Style.id = "unifiedShellV4Styles";
    v4Style.textContent = `
      :root{--v4-green:#0B3D2E;--v4-navy:#1E3A8A;--v4-gold:#D4AF37;--v4-canvas:#F8FAFC;--v4-text:#1F2937;--v4-muted:#64748B;--v4-danger:#EF4444;--v4-success:#10B981}
      .unified-tabs{background:var(--v4-green);border:0;border-radius:12px;padding:9px 10px;margin:0 0 14px;box-shadow:0 6px 18px rgba(11,61,46,.16)}
      .unified-tabs button{color:#fff;border-radius:7px;padding:10px 13px;font-weight:750}
      .unified-tabs button:hover{color:#fff;background:rgba(255,255,255,.12)}
      .unified-tabs button.active{background:#fff;color:var(--v4-green);box-shadow:none}
      .unified-tabs .home-link{font-weight:850}.unified-tabs .settings-nav{margin-left:auto;opacity:.88}.unified-tabs .settings-nav:hover{opacity:1}
      .unified-tabs .dashboard-link{display:none}.unified-subnav{margin:0 0 18px}.erp-preview-control span{font-size:11px}
      .smart-routing{margin-top:2px}.routing-card{border:1px solid #e2e8f0;border-top-width:4px;border-radius:10px;background:#fff;box-shadow:0 4px 6px rgba(0,0,0,.05)}.routing-card:nth-child(1){border-top-color:var(--v4-gold)}.routing-card:nth-child(1) .routing-icon,.routing-card:nth-child(1) b{color:#9a7200}.routing-card:nth-child(2){border-top-color:var(--v4-navy)}.routing-card:nth-child(2) .routing-icon,.routing-card:nth-child(2) b{color:var(--v4-navy)}.routing-card:nth-child(3){border-top-color:var(--v4-green)}.routing-card:nth-child(3) .routing-icon,.routing-card:nth-child(3) b{color:var(--v4-green)}.routing-card b{font-size:30px}.routing-card button{margin-top:13px;color:var(--v4-green)}
      .shared-workboard{display:grid;gap:16px}.shared-workboard-intro{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.shared-workboard-intro h2{margin:0 0 4px}.shared-workboard-intro p{margin:0;color:var(--muted);max-width:760px}.shared-board-context{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;background:#e8f3ed;color:var(--v4-green);font-size:11px;font-weight:800;white-space:nowrap}.shared-board-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.shared-board-metric{padding:17px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:var(--card-shadow)}.shared-board-metric.kra{border-top:4px solid var(--v4-gold)}.shared-board-metric.projects{border-top:4px solid var(--v4-green)}.shared-board-metric.people{border-top:4px solid var(--v4-navy)}.shared-board-metric b{display:block;font-size:25px;color:var(--v4-text)}.shared-board-metric span{display:block;font-size:12px;font-weight:800;color:var(--v4-muted);margin-top:2px}.shared-board-metric small{display:block;font-size:11px;color:var(--v4-muted);margin-top:5px}.shared-board-card{padding:20px}.shared-board-card .section-heading{align-items:center}.firm-chip{display:inline-block;padding:3px 7px;border-radius:999px;background:#e8f3ed;color:#176044;font-size:10px;font-weight:850;white-space:nowrap}.firm-chip.navy{background:#e8f0fb;color:#1E3A8A}.shared-board-actions{display:flex;gap:6px;flex-wrap:wrap}.shared-board-actions button{border:1px solid #cbd7d0;border-radius:6px;background:#fff;color:#14563f;padding:5px 7px;font-size:11px;font-weight:750}.shared-board-actions button:hover{background:#e8f3ed}.shared-board-note{padding:12px 14px;border-left:4px solid var(--v4-gold);border-radius:8px;background:#fffaf0;color:#70541c;font-size:12px}.shared-board-empty{padding:28px 14px;border:1px dashed #cbd7d0;border-radius:8px;text-align:center;color:var(--v4-muted);font-size:12px}
      @media(max-width:900px){.shared-board-grid{grid-template-columns:1fr}.unified-tabs .settings-nav{margin-left:0}}@media(max-width:600px){.shared-workboard-intro{flex-direction:column}.unified-tabs{border-radius:9px}}
    `;
    document.head.append(v4Style);
  }

  function addHeaderControl() {
    const actions = document.querySelector(".header-actions");
    if (!actions || document.getElementById("erpPreviewCategory")) return;
    const preview = getPreview();
    const label = document.createElement("label");
    label.className = "erp-preview-control";
    label.innerHTML = `<span>My Workspace</span><select id="erpPreviewCategory" aria-label="Preview My Workspace as staff category">${staffCategories.map(category => `<option${category === preview.category ? " selected" : ""}>${esc(category)}</option>`).join("")}</select>`;
    actions.prepend(label);
    document.getElementById("erpPreviewCategory").addEventListener("change", event => {
      const current = getPreview();
      savePreview({ category: event.target.value, permissions: current.permissions });
      applyShell();
      openDashboard();
    });
  }

  function addNavigation() {
    const legacy = document.querySelector(".tabs"), shell = document.querySelector(".shell");
    if (!legacy || !shell || document.getElementById("unifiedTabs")) return;
    legacy.classList.add("legacy-hidden");
    const nav = document.createElement("nav");
    nav.id = "unifiedTabs"; nav.className = "unified-tabs"; nav.setAttribute("aria-label", "ERP workspace modules");
    const home = document.createElement("button"); home.type = "button"; home.className = "home-link"; home.dataset.erpHome = "true"; home.innerHTML = `<span aria-hidden="true">⌂</span> Home`; nav.append(home);
    Object.entries(groups).forEach(([id, group]) => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.erpGroup = id; if (id === "settings") button.className = "settings-nav"; button.innerHTML = `<span aria-hidden="true">${group.icon}</span> ${esc(group.label)}`; nav.append(button);
    });
    legacy.after(nav);
    const subnav = document.createElement("div"); subnav.id = "unifiedSubnav"; subnav.className = "unified-subnav"; subnav.hidden = true; nav.after(subnav);
    nav.addEventListener("click", event => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.dataset.erpHome || button.dataset.erpDashboard) { openDashboard(); return; }
      const group = button.dataset.erpGroup; if (!group) return;
      const preview = getPreview();
      if (!allowed(group, preview)) { showDenied(group); return; }
      openGroup(group);
    });
    subnav.addEventListener("click", event => {
      const button = event.target.closest("button[data-sub-panel]"); if (!button) return;
      const group = button.dataset.subGroup, panel = button.dataset.subPanel;
      if (button.dataset.settingView) { showSettings(button.dataset.settingView); return; }
      showPanel(panel, group, button.dataset.anchor || "");
    });
  }

  function togglePanels(panelId) {
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === panelId));
  }
  function openDashboard() {
    document.body.className = document.body.className.replace(/\bshell-mode-[^ ]+/g, "").trim();
    togglePanels("dashboard");
    document.querySelectorAll("#unifiedTabs [data-erp-group]").forEach(button => button.classList.remove("active"));
    document.querySelector("#unifiedTabs [data-erp-home]")?.classList.add("active");
    const sub = document.getElementById("unifiedSubnav"); if (sub) sub.hidden = true;
    try { if (typeof renderDashboard === "function") renderDashboard(); } catch (_) {}
    document.getElementById("dashboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function renderSubnav(groupId, selected) {
    const sub = document.getElementById("unifiedSubnav"), group = groups[groupId]; if (!sub || !group) return;
    sub.hidden = false;
    sub.innerHTML = `<b>${esc(group.label)}</b>${group.items.map(item => `<button type="button" class="${(item.panel || item.setting) === selected ? "active" : ""}" data-sub-group="${esc(groupId)}" data-sub-panel="${esc(item.panel || "erp-settings-preview")}"${item.setting ? ` data-setting-view="${esc(item.setting)}"` : ""}${item.anchor ? ` data-anchor="${esc(item.anchor)}"` : ""}>${esc(item.label)}</button>`).join("")}`;
  }
  function openGroup(groupId) {
    const group = groups[groupId]; if (!group) return;
    document.querySelectorAll("#unifiedTabs [data-erp-group]").forEach(button => button.classList.toggle("active", button.dataset.erpGroup === groupId));
    if (groupId === "settings") { showSettings("firm"); return; }
    const first = group.items[0]; renderSubnav(groupId, first.panel); showPanel(first.panel, groupId, first.anchor || "");
  }
  function showPanel(panelId, groupId, anchorId) {
    document.body.className = document.body.className.replace(/\bshell-mode-[^ ]+/g, "").trim() + (groupId === "timehr" ? " shell-mode-timehr" : "");
    togglePanels(panelId); renderSubnav(groupId, panelId);
    if (panelId === "invoices-statements") {
      try { window.pclReceivablesCentre?.render?.(); } catch (_) {}
    }
    if (panelId === "shared-workboard") renderSharedWorkboard();
    if (anchorId) setTimeout(() => document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    document.getElementById(panelId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function showDenied(groupId) {
    const settings = document.getElementById("erp-settings-preview"); if (!settings) return;
    togglePanels("erp-settings-preview"); renderSubnav("settings", "");
    settings.innerHTML = `<div class="card shell-no-access"><h2>Module not available for this staff category</h2><p>${esc(groups[groupId]?.label || "This module")} is not included in the current ${esc(getPreview().category)} preview. An administrator assigns functional permissions and the backend must enforce them after authentication.</p><button type="button" class="btn secondary" data-return-dashboard>Return to Smart Routing</button></div>`;
    settings.querySelector("[data-return-dashboard]")?.addEventListener("click", openDashboard);
  }

  function routingData() {
    const today = (() => { try { return typeof operationDate === "function" ? operationDate() : new Date().toISOString().slice(0, 10); } catch (_) { return new Date().toISOString().slice(0, 10); } })();
    let taxTasks = [], invoiceRows = [];
    try { taxTasks = window.pclTaxProjectWorkspace?.dashboardSnapshot?.({}).tasks || []; } catch (_) {}
    try { invoiceRows = typeof invoices !== "undefined" ? invoices : []; } catch (_) {}
    const deadlines = taxTasks.filter(task => String(task.dueDate || task.dueAt || "") >= today && String(task.dueDate || task.dueAt || "") <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) && !/filed|complete/i.test(String(task.status || ""))).length;
    const overdue = invoiceRows.filter(invoice => {
      const balance = Number(invoice.outstandingBalance ?? invoice.balance ?? invoice.total ?? invoice.amount ?? 0);
      return balance > 0 && String(invoice.dueDate || "") < today && !/paid|cancel/i.test(String(invoice.status || ""));
    }).length;
    let myTasks = 0;
    try { myTasks = taxTasks.filter(task => String(task.dueDate || task.dueAt || "") <= today && !/filed|complete/i.test(String(task.status || ""))).length; } catch (_) {}
    return { deadlines, overdue, myTasks };
  }
  function injectSmartRouting() {
    const dashboard = document.getElementById("dashboard"); if (!dashboard || document.getElementById("smartRouting")) return;
    const section = document.createElement("section"); section.id = "smartRouting"; section.className = "smart-routing";
    section.innerHTML = `<div class="smart-routing-head"><div><h3>Smart Routing</h3><p>Start from the work that needs attention. Values use the current browser preview; authenticated backend routing is not connected yet.</p></div><span class="preview-badge">Preview mode</span></div><div class="routing-grid"><article class="routing-card"><div class="routing-icon">KRA</div><b id="routingKraCount">0</b><span>KRA deadlines</span><small>Open statutory tasks in the next seven days.</small><button type="button" data-route="projects">Open Projects &amp; Tasks</button></article><article class="routing-card"><div class="routing-icon">KES</div><b id="routingFinanceCount">0</b><span>Finance chasing</span><small>Outstanding invoices past their due date.</small><button type="button" data-route="finance">Open Finance invoices</button></article><article class="routing-card"><div class="routing-icon">TODAY</div><b id="routingTasksCount">0</b><span>My tasks today</span><small>Assigned or due work, including overdue items.</small><button type="button" data-route="projects">Open My Tasks</button></article></div>`;
    dashboard.prepend(section);
    section.addEventListener("click", event => { const button = event.target.closest("button[data-route]"); if (!button) return; const id = button.dataset.route; if (!allowed(id, getPreview())) { showDenied(id); return; } openGroup(id); if (id === "projects") showPanel("tax-projects", "projects"); if (id === "finance") showPanel("invoices-statements", "finance", "invoiceStatementRows"); });
    renderSmartRouting();
  }
  function renderSmartRouting() {
    const values = routingData();
    const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    set("routingKraCount", values.deadlines); set("routingFinanceCount", values.overdue); set("routingTasksCount", values.myTasks);
  }

  function taskIsOpen(task) {
    return !["completed", "submitted", "filed", "cancelled", "exempt", "not applicable", "no action required"].includes(String(task?.status || "").toLowerCase());
  }
  function taskDue(task) { return String(task?.dueDate || task?.dueAt || "").slice(0, 10); }
  function sharedFirmView() { return document.getElementById("dashboardFirmFilter")?.value || ""; }
  function sharedProjectsInView() {
    const selectedFirm = sharedFirmView();
    try { return (typeof activeEngagements === "function" ? activeEngagements() : []).filter(engagement => !selectedFirm || engagement.firmId === selectedFirm); }
    catch (_) { return []; }
  }
  function sharedBoardTaskRows(projects) {
    const lifecycleTasks = projects.flatMap(engagement => (engagement.workflowTasks || []).map(task => ({ task, engagement, firmId: engagement.firmId, clientName: engagement.companyName, source: "Engagement workflow" })));
    let taxTasks = [];
    try { taxTasks = window.pclTaxProjectWorkspace?.dashboardSnapshot?.({ firmId: sharedFirmView() }).tasks || []; } catch (_) {}
    const taxRows = taxTasks.map(task => ({ task, engagement: null, firmId: task.firmId, clientName: task.clientName || "Tax client", source: "Tax project" }));
    return [...lifecycleTasks, ...taxRows].filter(row => !sharedFirmView() || row.firmId === sharedFirmView());
  }
  function injectSharedWorkboard() {
    if (document.getElementById("shared-workboard")) return;
    const dashboard = document.getElementById("dashboard"); if (!dashboard) return;
    const section = document.createElement("section");
    section.id = "shared-workboard"; section.className = "tab-panel";
    section.innerHTML = `<div class="shared-workboard"><div class="shared-workboard-intro"><div><h2>Shared Workboard</h2><p>One practice-wide queue for active engagements, tax projects and delivery tasks. Every row displays its Handling Firm, while staff work from the same central board without logging into a separate company.</p></div><span id="sharedBoardContext" class="shared-board-context">All authorised firms</span></div><div class="shared-board-grid"><article class="shared-board-metric projects"><b id="sharedBoardProjectCount">0</b><span>Active engagements</span><small>Across the selected firm view</small></article><article class="shared-board-metric kra"><b id="sharedBoardOpenTaskCount">0</b><span>Open tasks</span><small>Tax, audit and engagement work</small></article><article class="shared-board-metric people"><b id="sharedBoardStaffCount">0</b><span>Assigned resources</span><small>Shared staff allocation in scope</small></article></div><article class="card shared-board-card"><div class="section-heading"><div><h3>Central project and engagement queue</h3><span class="hint">Handling Firm is shown on every project and is inherited by its tasks, documents, communications, timesheets, invoices and payments.</span></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Project / client</th><th>Handling firm</th><th>Service</th><th>Team</th><th>Next due</th><th>Stage</th><th>Open</th></tr></thead><tbody id="sharedBoardRows"></tbody></table></div></article><div class="shared-board-note"><b>Operating rule:</b> the firm filter changes the view only. It cannot alter a project’s locked Handling Firm. Work for another firm is created as a separate engagement, then appears here alongside all other authorised work.</div></div>`;
    dashboard.after(section);
    section.addEventListener("click", event => {
      const button = event.target.closest("button[data-shared-board-module]"); if (!button) return;
      const module = button.dataset.sharedBoardModule;
      if (module === "audit") showPanel("audit-workspace", "projects");
      if (module === "tax") showPanel("tax-projects", "projects");
      if (module === "lifecycle") showPanel("lifecycle", "projects");
    });
  }
  function renderSharedWorkboard() {
    const projects = sharedProjectsInView();
    const tasks = sharedBoardTaskRows(projects);
    const openTasks = tasks.filter(row => taskIsOpen(row.task));
    const assignedPeople = new Set(projects.flatMap(project => [project.resources?.supervisorUserId, project.resources?.assistantUserId]).filter(Boolean));
    const context = document.getElementById("sharedBoardContext");
    const projectCount = document.getElementById("sharedBoardProjectCount"), openCount = document.getElementById("sharedBoardOpenTaskCount"), staffCount = document.getElementById("sharedBoardStaffCount"), body = document.getElementById("sharedBoardRows");
    if (!body) return;
    if (context) context.textContent = sharedFirmView() ? firmName(sharedFirmView()) : "All authorised firms";
    if (projectCount) projectCount.textContent = projects.length;
    if (openCount) openCount.textContent = openTasks.length;
    if (staffCount) staffCount.textContent = assignedPeople.size;
    body.innerHTML = projects.length ? projects.map(project => {
      const projectTasks = tasks.filter(row => row.engagement?.id === project.id);
      const open = projectTasks.filter(row => taskIsOpen(row.task));
      const next = open.map(row => taskDue(row.task)).filter(Boolean).sort()[0] || "No due date";
      const team = [project.resources?.supervisorUserId && `Supervisor: ${project.resources.supervisorUserId}`, project.resources?.assistantUserId && `Assistant: ${project.resources.assistantUserId}`].filter(Boolean).join(" · ") || "Allocate team";
      const module = /audit/i.test(String(project.initialService || "")) ? "audit" : /tax|bookkeeping|payroll/i.test(String(project.initialService || "")) ? "tax" : "lifecycle";
      return `<tr><td><b>${esc(project.companyName || "Client")}</b><br><span class="hint">${esc(project.id || "Engagement")}</span></td><td><span class="firm-chip ${module === "audit" ? "navy" : ""}">${esc(firmName(project.firmId))}</span></td><td>${esc(project.initialService || "Not set")}</td><td>${esc(team)}</td><td>${esc(next)}</td><td>${esc(project.stage || "Active")}</td><td><div class="shared-board-actions"><span class="status-pill ${open.length ? "review" : ""}">${open.length} open</span><button type="button" data-shared-board-module="${module}">Open</button></div></td></tr>`;
    }).join("") : `<tr><td colspan="7" class="shared-board-empty">No active engagements match this firm view.</td></tr>`;
  }

  function settingProfile(firmId) {
    const all = getSettings(); all.firms = all.firms || {}; return all.firms[firmId] || {};
  }
  function settingsShell() {
    let section = document.getElementById("erp-settings-preview"); if (section) return section;
    section = document.createElement("section"); section.id = "erp-settings-preview"; section.className = "tab-panel";
    document.querySelector(".shell")?.append(section); return section;
  }
  function showSettings(view) {
    const preview = getPreview();
    if (!preview.permissions.includes("System Administration")) { showDenied("settings"); return; }
    document.body.className = document.body.className.replace(/\bshell-mode-[^ ]+/g, "").trim();
    const section = settingsShell(); togglePanels("erp-settings-preview"); renderSubnav("settings", view);
    section.innerHTML = `<div class="intro"><div><h2>Settings</h2><p>Configuration preview for the multi-firm ERP. It stores only local browser settings until an authenticated backend is connected.</p></div></div><div class="settings-layout"><aside class="card settings-menu">${groups.settings.items.map(item => `<button type="button" data-settings-menu="${esc(item.setting)}" class="${item.setting === view ? "active" : ""}">${esc(item.label)}</button>`).join("")}</aside><div class="card settings-body" id="settingsBody"></div></div>`;
    section.querySelector(".settings-menu")?.addEventListener("click", event => { const button = event.target.closest("button[data-settings-menu]"); if (button) showSettings(button.dataset.settingsMenu); });
    renderSettingsView(view);
  }
  function renderSettingsView(view) {
    const body = document.getElementById("settingsBody"); if (!body) return;
    const note = `<div class="settings-note">This is a configuration preview. Login, permissions, financial settings and API keys must be saved and enforced by an authenticated server before go-live.</div>`;
    if (view === "firm") {
      const list = firmList(); const first = list[0]?.id || "firm-1"; const stored = getSettings(); const selectedFirmId = list.some(firm => firm.id === stored.selectedFirm) ? stored.selectedFirm : first; const selectedFirm = list.find(firm => firm.id === selectedFirmId); const profile = settingProfile(selectedFirmId); const value = key => profile[key] || selectedFirm?.[key] || ""; const branches = Array.isArray(selectedFirm?.branches) ? selectedFirm.branches.join(", ") : ""; const businessEmail = profile.businessEmail || profile.email || selectedFirm?.businessEmail || selectedFirm?.email || ""; const physicalAddress = profile.physicalAddress || profile.address || selectedFirm?.physicalAddress || selectedFirm?.address || "";
      body.innerHTML = `${note}<div class="section-heading"><h3>Firm &amp; company management</h3><span class="hint">One selected handling firm remains immutable on each engagement.</span></div><form id="firmSettingsForm"><div class="firm-profile-grid"><label class="full">Firm<select id="settingsFirmId">${list.map(firm => `<option value="${esc(firm.id)}"${firm.id === selectedFirmId ? " selected" : ""}>${esc(firmName(firm.id))}</option>`).join("")}</select></label><label>Legal name<input name="legalName" value="${esc(value("legalName"))}" placeholder="Legal registered name" /></label><label>KRA PIN<input name="kraPin" value="${esc(value("kraPin"))}" placeholder="Enter KRA PIN" /></label><label>VAT number<input name="vatNumber" value="${esc(value("vatNumber"))}" placeholder="VAT registration, if applicable" /></label><label>Invoice prefix<input name="invoicePrefix" value="${esc(value("invoicePrefix"))}" placeholder="e.g. INV/PCL/" /></label><label>Business email<input type="email" name="email" value="${esc(businessEmail)}" placeholder="accounts@firm.co.ke" /></label><label>Phone<input name="phone" value="${esc(value("phone"))}" placeholder="+254..." /></label><label class="full">Physical address<textarea name="address" placeholder="Registered / business address">${esc(physicalAddress)}</textarea></label><label class="full">Branches<input value="${esc(branches)}" readonly aria-label="Firm branches" /></label><label>Financial year starts<input name="financialYearStart" value="${esc(value("financialYearStart") || "01-01")}" placeholder="MM-DD" /></label><label>Financial year ends<input name="financialYearEnd" value="${esc(value("financialYearEnd") || "12-31")}" placeholder="MM-DD" /></label><label class="full">Logo reference<input name="logoReference" value="${esc(value("logoReference") || value("logoKey"))}" placeholder="Upload destination to be connected in the backend" /></label></div><div class="actions"><button class="btn primary" type="submit">Save firm profile preview</button></div></form><p class="shell-backend-note">The selected company details are sourced from the approved company register. Saving this form does not rewrite historical engagement firm ownership.</p>`;
      body.querySelector("#firmSettingsForm")?.addEventListener("submit", saveFirmProfile);
      body.querySelector("#settingsFirmId")?.addEventListener("change", event => { const target = event.target.value; const all = getSettings(); all.selectedFirm = target; saveSettings(all); renderSettingsView("firm"); });
      return;
    }
    if (view === "staff") {
      body.innerHTML = `${note}<div class="section-heading"><h3>Staff categories, functions and scopes</h3><span class="hint">Primary staff category controls hierarchy; functions grant specific departmental authority.</span></div><div class="table-wrap"><table class="data-table settings-table"><thead><tr><th>Staff category</th><th>Default scope</th><th>Finance default</th><th>Functional permissions available</th></tr></thead><tbody>${staffCategories.map(category => `<tr><td><b>${esc(category)}</b></td><td>${esc(rolePolicy[category].description)}</td><td>${esc(rolePolicy[category].finance === "full" ? "Full if Finance is assigned" : rolePolicy[category].finance === "view" ? "Read-only if Finance is assigned" : "No finance access")}</td><td>${functionalPermissions.map(permission => `<span class="permission-tag">${esc(permission)}</span>`).join("")}</td></tr>`).join("")}</tbody></table></div><div class="section"><h3>User-profile pattern</h3><p class="hint">Each user needs: staff category; authorised firm scope (All Firms / selected firms); client scope (All / assigned); project scope (All / assigned); and optional Finance, HR or System Administration permission. The backend must return only authorised records, even if a user tries a URL directly.</p></div>`;
      return;
    }
    if (view === "security") {
      body.innerHTML = `${note}<div class="section-heading"><h3>Login &amp; security</h3><span class="hint">Security policies require a server-side identity provider.</span></div><form id="securitySettingsForm" class="firm-profile-grid"><label class="checkbox-line"><input type="checkbox" name="require2fa" checked />Require two-factor authentication for staff</label><label>Password reset period (days)<input type="number" name="passwordDays" value="90" min="1" /></label><label>Session timeout (minutes)<input type="number" name="sessionMinutes" value="30" min="1" /></label><label>API-key registry<input name="apiKeyPolicy" placeholder="Backend-only; never store secrets in browser" /></label><label class="full">Security implementation note<textarea name="note" placeholder="Specify identity provider, audit retention and incident owner."></textarea></label><div class="actions full"><button class="btn primary" type="submit">Save security policy preview</button></div></form>`;
      attachGenericPreviewSave("securitySettingsForm", "Security policy preview saved locally. It is not a live authentication policy."); return;
    }
    if (view === "defaults") {
      body.innerHTML = `${note}<div class="section-heading"><h3>Client &amp; engagement defaults</h3><span class="hint">These controlled lists are used only after backend validation is added.</span></div><form id="defaultsSettingsForm" class="firm-profile-grid"><label class="full">Tax obligations dictionary<textarea name="taxDictionary">VAT, PAYE, Withholding Tax, Corporation Tax, Excise Duty, Advance Tax, NSSF, SHIF, AHL, NITA</textarea></label><label class="full">Default vault folders<textarea name="vaultFolders">01. Permanent File\n02. Current Year Audit\n03. Tax Returns\n04. Working Papers\n05. Signed Engagement Letters</textarea></label><label class="full">Engagement-letter template references<textarea name="engagementTemplates" placeholder="Store approved template references; upload service pending."></textarea></label><div class="actions full"><button class="btn primary" type="submit">Save client defaults preview</button></div></form>`;
      attachGenericPreviewSave("defaultsSettingsForm", "Client defaults preview saved locally."); return;
    }
    if (view === "billing") {
      body.innerHTML = `${note}<div class="section-heading"><h3>Finance &amp; billing settings</h3><span class="hint">Invoices retain their existing invoice number. Payment references begin with that invoice number and use Cash, M-Pesa, Bank Transfer or Cheque.</span></div><form id="billingSettingsForm" class="firm-profile-grid"><label>Default payment terms<input name="paymentTerms" value="Net 30 days" /></label><label>Statement period<input name="statementPeriod" value="Current Month" /></label><label>VAT standard rate<input name="vatStandard" value="16%" /></label><label>VAT reduced rate<input name="vatReduced" value="8%" /></label><label class="full">Bank-account display reference<textarea name="bankAccounts" placeholder="Store bank account details on the secure backend before invoice use."></textarea></label><div class="actions full"><button class="btn primary" type="submit">Save billing settings preview</button></div></form>`;
      attachGenericPreviewSave("billingSettingsForm", "Billing settings preview saved locally."); return;
    }
    body.innerHTML = `${note}<div class="section-heading"><h3>KRA compliance engine settings</h3><span class="hint">Internal work deadlines support planning; statutory filing status is controlled in Tax Projects.</span></div><form id="kraSettingsForm" class="firm-profile-grid"><label>PAYE internal due day<input name="payeDay" type="number" value="7" min="1" max="31" /></label><label>VAT / TOT internal due day<input name="vatDay" type="number" value="18" min="1" max="31" /></label><label>Weekly tax check hours<input name="weeklyHours" value="0.42" /></label><label>Corporate-tax allocation (hours)<input name="corporateHours" value="80" /></label><label class="checkbox-line"><input type="checkbox" name="weeklyTrigger" checked />Enable weekly task generation when server scheduling is connected</label><label class="checkbox-line"><input type="checkbox" name="paymentReconcile" checked />Enable payment matching when server integration is connected</label><div class="actions full"><button class="btn primary" type="submit">Save KRA engine preview</button></div></form>`;
    attachGenericPreviewSave("kraSettingsForm", "KRA engine settings preview saved locally. No live scheduler is connected.");
  }
  function saveFirmProfile(event) {
    event.preventDefault(); const form = event.currentTarget, firmId = form.querySelector("#settingsFirmId")?.value; if (!firmId) return;
    const data = Object.fromEntries(new FormData(form).entries()), all = getSettings(); all.firms = all.firms || {}; all.firms[firmId] = data; all.selectedFirm = firmId; saveSettings(all);
    alert("Firm profile preview saved in this browser. It has not changed existing engagement ownership or a live company record.");
  }
  function attachGenericPreviewSave(formId, message) {
    document.getElementById(formId)?.addEventListener("submit", event => { event.preventDefault(); const all = getSettings(); all[formId] = Object.fromEntries(new FormData(event.currentTarget).entries()); saveSettings(all); alert(message); });
  }

  function applyShell() {
    const preview = getPreview();
    const selector = document.getElementById("erpPreviewCategory"); if (selector) selector.value = preview.category;
    const workspaceSelector = document.getElementById("workspacePositionFilter");
    if (workspaceSelector && workspaceSelector.value !== preview.category) workspaceSelector.value = preview.category;
    try { if (typeof saveDashboardWorkspacePosition === "function") saveDashboardWorkspacePosition(preview.category); } catch (_) {}
    document.querySelectorAll("#unifiedTabs [data-erp-group]").forEach(button => { button.hidden = !allowed(button.dataset.erpGroup, preview); });
    const role = document.getElementById("workspaceHeaderRole"), scope = document.getElementById("workspaceHeaderScope");
    if (role) role.textContent = roleTitle(preview); if (scope) scope.textContent = preview.category === "Engagement Partner" ? "Firm-wide preview scope" : "Assigned-work preview scope";
    const avatar = document.querySelector(".user-avatar"); if (avatar) avatar.textContent = preview.category.split(" ").map(word => word[0]).join("").slice(0, 2).toUpperCase();
    renderSmartRouting();
  }

  function injectFooterNote() {
    const shell = document.querySelector(".shell"); if (!shell || document.getElementById("shellBackendNote")) return;
    const note = document.createElement("p"); note.id = "shellBackendNote"; note.className = "shell-backend-note"; note.textContent = "ERP preview: browser-local records and visibility preview only. Authentication, firm scopes, approvals, financial posting, file storage and audit trails require a connected backend before operational use."; shell.append(note);
  }

  function start() {
    injectStyles(); addHeaderControl(); addNavigation(); injectSmartRouting(); injectSharedWorkboard(); settingsShell(); injectFooterNote(); applyShell(); openDashboard();
    const workspaceSelector = document.getElementById("workspacePositionFilter");
    if (workspaceSelector && !workspaceSelector.dataset.unifiedCategorySync) {
      workspaceSelector.dataset.unifiedCategorySync = "true";
      workspaceSelector.addEventListener("change", event => { const current = getPreview(); savePreview({ category: event.target.value, permissions: current.permissions }); applyShell(); });
    }
    document.getElementById("dashboardFirmFilter")?.addEventListener("change", renderSharedWorkboard);
    window.addEventListener("pcl:tax-projects-updated", () => { renderSmartRouting(); renderSharedWorkboard(); });
    window.addEventListener("pcl:invoices-statements-updated", renderSmartRouting);
  }
  start();
})();
