// Staff-facing explanation of the access rules enforced by the ERP backend.
// This is deliberately a guide, not an authorization engine. The edge function
// and database policies remain the source of truth for every request.
// The action matrix below is computed from the same rights catalogue the server uses, so it cannot drift from the access screen.
import {ACTION_RIGHTS} from './staff-action-rights.mjs?v=20261209-review-floor';
import {STAFF_ACCESS_AREAS,defaultStaffAreas} from './staff-access-control.mjs';
export const ACCESS_ROLES=[
 {code:'PARTNER',label:'Engagement Partner',scope:'All active handling firms and their authorised client work.',work:'Firm-level oversight, client and project controls, and final engagement decisions.',limit:'Partner-only actions include activating chart accounts and approving the audit framework and final audit file.'},
 {code:'MANAGER',label:'Manager',scope:'Authorised firms, managed staff and client projects within the assigned scope.',work:'Client and project setup, team oversight, independent client-account mapping approval, and client-ledger journal review and posting.',limit:'Can issue a reset link to an eligible manager in their authorised firms. Ask another manager to reset your own password. Partner or Manager role and access changes, Partner-only audit approvals, and chart activation require an Engagement Partner.'},
 {code:'SUPERVISOR',label:'Audit Supervisor',scope:'Assigned client projects and related task work.',work:'Task oversight and independent review of specified imports, reconciliations, stock controls and workpapers when that workflow permits. Checks the chart of accounts, opening balances and journals an Assistant prepared, so a Manager or Partner can approve them.',limit:'Cannot approve client account master mappings, approve or post client-ledger journals, approve a client chart, or approve the final audit file.'},
 {code:'ASSISTANT',label:'Audit Assistant',scope:'Assigned clients, projects and tasks.',work:'Prepare source data, upload documents, propose the client chart of accounts, map and import the opening trial balance as a draft, prepare sales, payroll and purchases, and submit work for checking.',limit:'Cannot check, approve or post work, activate account mappings, or change client details, contacts or owners.'},
 {code:'INTERN',label:'Intern',scope:'Assigned task-level support work only.',work:'Complete permitted supporting tasks and their limited task documents.',limit:'No client ledger, purchase mapping, source-import, or audit-workpaper access.'},
 {code:'ADMIN',label:'System Administrator',scope:'System accounts and system settings only: staff logins, chat groups, sectors, private reference documents and go-live readiness (read only). No client, project, task, document, ledger or tax record.',work:'Create, edit and disable Supervisor, Assistant and Intern logins; create chat groups and manage who is in them; add sectors; upload and download private reference documents.',limit:'Cannot open client work, cannot approve anything (references, tax rules, release checks), cannot read anyone’s chats, cannot manage Partner, Manager or System Administrator accounts. At most three System Administrators; only the Partner creates them.'},
];

export const APPROVAL_RULES=[
 ['Client account mappings','Manager or Partner','No separate approval. A new mapping is reviewed once, when a different Manager or Partner approves and posts the journal that uses it; the person who set it up cannot post that journal.'],
 ['Chart account activation','Partner','Custom chart accounts remain inactive until Partner approval.'],
 ['Opening TB and client-ledger journals','Manager or Partner','A different reviewer must review the submitted journal before it can be posted.'],
 ['Designated period imports and reconciliations','Supervisor, Manager or Partner','The reviewer must be different from the preparer. The workflow decides which review action applies.'],
 ['Audit framework and final audit file','Partner','Final file approval is Partner-only; the file preparer cannot approve their own file.'],
];

// What each category does, whose records it reaches, and where its authority ends. Record scope is what the system enforces today.
export const ACCESS_PROFILE={
 PARTNER:{records:'Every client and project in every active firm.',actions:'Governs access, approves restricted decisions, and signs off where the workflow requires a Partner.',check:'Checks independent submissions.',approve:'Approves; Partner-only decisions include chart account activation, the final audit file, reset to draft and credit note issue.'},
 MANAGER:{records:'Clients and projects of the firms they work in; staff they manage.',actions:'Allocates onboarding and engagement work, manages delivery, and approves within delegated authority.',check:'Checks independent submissions.',approve:'Approves work they neither prepared nor checked.'},
 SUPERVISOR:{records:'Clients and projects of the firms they work in (read), and their own team for staff. Assignment narrows what they can change.',actions:'Prepares where assigned, checks independent submissions and returns work for correction.',check:'Checks work prepared by someone else.',approve:'None. Approval is by a Manager or Partner.',note:'Policy difference to settle: the category policy limits Supervisors to assigned teams and projects, but today they can read every client in their firms.'},
 ASSISTANT:{records:'Clients they own, projects they are assigned to, and clients allocated to them for onboarding; tasks assigned to them.',actions:'Creates onboarding proposals, proposes profile updates, prepares work and submits it for review.',check:'None. The independent check is reserved for a Supervisor, Manager or Partner.',approve:'None.'},
 INTERN:{records:'Assigned tasks and the documents needed for those tasks. No client records.',actions:'Completes assigned steps, uploads supporting evidence where allowed, and records their own time.',check:'None.',approve:'None.'},
 ADMIN:{records:'Staff accounts and system settings only. No client, project, task, document, ledger or tax record.',actions:'Manages accounts and technical configuration.',check:'None.',approve:'None. Client, accounting and engagement approvals stay with the business roles.'},
};
const OP_ORDER=['View','Create / record','Edit','Submit','Check / return','Post / activate','Approve','Void','Record eTIMS reference','Reset to draft','Apply advance','Reverse','Refund / transfer','Generate invoice drafts','Grant / revoke','Manage groups','Issue setup link'];
// The actions a category holds by default in one area, in a fixed order, taken from the rights catalogue.
export function actionsForCategory(role,areaCode){
 if(!defaultStaffAreas(role).includes(areaCode))return null;
 const held=new Set(ACTION_RIGHTS.filter(r=>r.area===areaCode&&r.roles.includes(role)).map(r=>r.label));
 return OP_ORDER.filter(x=>held.has(x));
}
export function categoryActionMatrix(esc,labels=Object.fromEntries(ACCESS_ROLES.map(r=>[r.code,r.label]))){
 const roles=ACCESS_ROLES.map(r=>r.code);
 const head=roles.map(r=>`<th scope="col">${esc(labels[r]||r)}</th>`).join('');
 const rows=STAFF_ACCESS_AREAS.map(area=>`<tr><th scope="row">${esc(area.label)}</th>${roles.map(r=>{const ops=actionsForCategory(r,area.code);return `<td>${ops===null?'<span class="muted">Not in this category</span>':ops.length?ops.map(o=>`<span class="badge ${o==='Check / return'||o==='Approve'||o==='Post / activate'?'warn':''}">${esc(o)}</span>`).join(' '):'<span class="muted">View only through other areas</span>'}</td>`;}).join('')}</tr>`).join('');
 return `<div class="scroll"><table class="category-matrix"><thead><tr><th scope="col">Area</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
// The category summary shown at the top of a person's Edit access screen and in the guide.
export function categoryProfileBlock(role,esc,label=''){
 const p=ACCESS_PROFILE[role];if(!p)return '';
 return `<section class="category-profile full"><h3>${esc(label||role)}: what this category can do</h3><p><b>Records:</b> ${esc(p.records)}</p><p><b>Actions:</b> ${esc(p.actions)}</p><p><b>Independent check:</b> ${esc(p.check)}</p><p><b>Approval:</b> ${esc(p.approve)}</p>${p.note?`<p class="notice">${esc(p.note)}</p>`:''}</section>`;
}

export function renderAccessGuide(currentRole,esc){
 const current=ACCESS_ROLES.find(x=>x.code===currentRole);
 return `<details class="card access-guide"><summary><strong>Role access and approval guide</strong><span class="muted">${current?`Your role: ${esc(current.label)}`:'Understand ERP roles'}</span></summary>
  <div class="access-guide-body"><p class="muted">Access is limited by role and the staff member’s authorised firm, client, project and task scope. The server and database check each action; a visible button does not grant access.</p>
   ${current?`<section class="access-current"><h3>Your access · ${esc(current.label)}</h3><p><b>Scope:</b> ${esc(current.scope)}</p><p><b>Can do:</b> ${esc(current.work)}</p><p><b>Cannot do:</b> ${esc(current.limit)}</p></section>`:''}
   <h3>Role guide</h3><div class="scroll"><table><thead><tr><th>Role</th><th>Work scope</th><th>Typical work</th><th>Important limit</th></tr></thead><tbody>${ACCESS_ROLES.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${esc(r.scope)}</td><td>${esc(r.work)}</td><td>${esc(r.limit)}</td></tr>`).join('')}</tbody></table></div>
   <h3>Actions by category and area</h3><p class="muted">Read from the same rights list the server uses. Highlighted actions are check, post and approve: they are reserved for reviewers and approvers, and the person who prepared the work can never use them on it.</p>${categoryActionMatrix(esc)}
   <h3>Who can review or approve?</h3><div class="scroll"><table><thead><tr><th>Work item</th><th>Authorised reviewer</th><th>Control</th></tr></thead><tbody>${APPROVAL_RULES.map(r=>`<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>
   <p class="muted">A Partner, or a Manager for staff they directly manage, can restrict ERP areas for an individual from Staff &amp; access, and switch off single functions inside an area (such as verifying KYC or approving a chart) with tick boxes grouped by area. Functions are listed for Clients, KYC, Chart of accounts, Stock and Accounting work; other areas are controlled at area level for now. This cannot grant more than the person’s role, change firm/project scope, or override review and approval rules. Any number of staff can share the same role.</p>
  </div></details>`;
}
