// Staff-facing explanation of the access rules enforced by the ERP backend.
// This is deliberately a guide, not an authorization engine. The edge function
// and database policies remain the source of truth for every request.
export const ACCESS_ROLES=[
 {code:'PARTNER',label:'Engagement Partner',scope:'All active handling firms and their authorised client work.',work:'Firm-level oversight, client and project controls, and final engagement decisions.',limit:'Partner-only actions include activating chart accounts and approving the audit framework and final audit file.'},
 {code:'MANAGER',label:'Manager',scope:'Authorised firms, managed staff and client projects within the assigned scope.',work:'Client and project setup, team oversight, independent client-account mapping approval, and client-ledger journal review and posting.',limit:'Cannot create or change Partner or Manager accounts; cannot perform Partner-only audit approvals or activate chart accounts.'},
 {code:'SUPERVISOR',label:'Audit Supervisor',scope:'Assigned client projects and related task work.',work:'Task oversight and independent review of specified imports, reconciliations, stock controls and workpapers when that workflow permits.',limit:'Cannot approve client account master mappings, post client-ledger journals, or approve the final audit file.'},
 {code:'ASSISTANT',label:'Audit Assistant',scope:'Assigned clients, projects and tasks.',work:'Prepare source data, upload documents, classify supported rows, and submit work for review.',limit:'Cannot independently approve or post work.'},
 {code:'INTERN',label:'Intern',scope:'Assigned task-level support work only.',work:'Complete permitted supporting tasks and their limited task documents.',limit:'No client ledger, purchase mapping, source-import, or audit-workpaper access.'},
];

export const APPROVAL_RULES=[
 ['Client account mappings','Manager or Partner','No separate approval. A new mapping is reviewed once, when a different Manager or Partner approves and posts the journal that uses it; the person who set it up cannot post that journal.'],
 ['Chart account activation','Partner','Custom chart accounts remain inactive until Partner approval.'],
 ['Opening TB and client-ledger journals','Manager or Partner','A different reviewer must review the submitted journal before it can be posted.'],
 ['Designated period imports and reconciliations','Supervisor, Manager or Partner','The reviewer must be different from the preparer. The workflow decides which review action applies.'],
 ['Audit framework and final audit file','Partner','Final file approval is Partner-only; the file preparer cannot approve their own file.'],
];

export function renderAccessGuide(currentRole,esc){
 const current=ACCESS_ROLES.find(x=>x.code===currentRole);
 return `<details class="card access-guide"><summary><strong>Role access and approval guide</strong><span class="muted">${current?`Your role: ${esc(current.label)}`:'Understand ERP roles'}</span></summary>
  <div class="access-guide-body"><p class="muted">Access is limited by role and the staff member’s authorised firm, client, project and task scope. The server and database check each action; a visible button does not grant access.</p>
   ${current?`<section class="access-current"><h3>Your access · ${esc(current.label)}</h3><p><b>Scope:</b> ${esc(current.scope)}</p><p><b>Can do:</b> ${esc(current.work)}</p><p><b>Cannot do:</b> ${esc(current.limit)}</p></section>`:''}
   <h3>Role guide</h3><div class="scroll"><table><thead><tr><th>Role</th><th>Work scope</th><th>Typical work</th><th>Important limit</th></tr></thead><tbody>${ACCESS_ROLES.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${esc(r.scope)}</td><td>${esc(r.work)}</td><td>${esc(r.limit)}</td></tr>`).join('')}</tbody></table></div>
   <h3>Who can review or approve?</h3><div class="scroll"><table><thead><tr><th>Work item</th><th>Authorised reviewer</th><th>Control</th></tr></thead><tbody>${APPROVAL_RULES.map(r=>`<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>
   <p class="muted">A Partner, or a Manager for staff they directly manage, can restrict ERP areas for an individual from Staff &amp; access. This cannot grant more than the person’s role, change firm/project scope, or override review and approval rules. Any number of staff can share the same role.</p>
  </div></details>`;
}
