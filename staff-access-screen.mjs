// Staff & access screen layout: one page, four tabs (People, Allocations, Access & rights, Approvals).
// Pure renderers so the layout can be tested without the whole workspace. The server and database still decide every action.
import {ACCESS_ROLES,APPROVAL_RULES,ACCESS_PROFILE,categoryActionMatrix} from './staff-access-guide.mjs?v=20261106-rights-v1&reset=20261122-v1&cat=20261209-profile';

export const STAFF_TABS=[
 {code:'people',label:'People',about:'Everyone you manage, with their role, account status and any restricted areas.'},
 {code:'allocations',label:'Allocations',about:'Give an Assistant or Supervisor access to existing clients before any project exists, and end that access when it is no longer needed.'},
 {code:'access',label:'Access & rights',about:'What each role can do, and who has had an area or a function switched off.'},
 {code:'approvals',label:'Approvals',about:'Who may check and who may approve each kind of work. The person who prepared work can never check or approve it.'},
];
// A System Administrator manages logins only, so allocations and approvals do not apply to them.
export function tabsFor(role){return STAFF_TABS.filter(t=>role==='ADMIN'?['people','access'].includes(t.code):true);}
export const normaliseTab=(tab,role)=>tabsFor(role).some(t=>t.code===tab)?tab:'people';

// One tab bar for the page. Arrow keys move between tabs; the active tab is the only one in the tab order.
export function tabBarHtml(tabs,active,esc,{label='Staff and access sections',counts={}}={}){
 return `<div class="pcl-tabs" role="tablist" aria-label="${esc(label)}">${tabs.map(t=>`<button type="button" role="tab" id="stafftab-${esc(t.code)}" class="pcl-tab${t.code===active?' on':''}" aria-selected="${t.code===active}" aria-controls="staffpane" tabindex="${t.code===active?0:-1}" data-staff-tab="${esc(t.code)}">${esc(t.label)}${counts[t.code]?`<span class="pcl-tab-count">${esc(counts[t.code])}</span>`:''}</button>`).join('')}</div>`;
}
export function bindTabKeys(root){
 const bar=root?.querySelector?.('.pcl-tabs');if(!bar)return;
 bar.onkeydown=e=>{
  const tabs=[...bar.querySelectorAll('[role="tab"]')],i=tabs.indexOf(document.activeElement);if(i<0)return;
  const to=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i-1+tabs.length)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;
  if(to<0)return;e.preventDefault();tabs[to].focus();tabs[to].click();
 };
}

// What the person is allowed to see on the People tab, in words. This must match the database rule.
export function reachLine(role){
 if(role==='PARTNER')return 'You manage every person in the firm. Partners and Managers can be changed by Partners only.';
 if(role==='MANAGER')return 'You see and manage every Supervisor, Assistant and Intern in the firms you work in, whoever they report to. Partners and other Managers are managed by Partners.';
 if(role==='ADMIN')return 'You manage Supervisor, Assistant and Intern logins.';
 return '';
}
export function emptyPeople(role){
 return role==='MANAGER'
  ?'No Supervisors, Assistants or Interns are linked to your firms yet. Ask a Partner to link staff to a firm you work in, then they will appear here.'
  :'No staff to show yet. Use Add staff to create the first login.';
}

export function roleSummaryHtml(staff,roles,esc){
 return `<div class="pcl-stats" role="group" aria-label="People by role">${Object.entries(roles).map(([code,label])=>{const n=staff.filter(s=>s.category_code===code).length;return n?`<div class="pcl-stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`:'';}).join('')}</div>`;
}

export function filterBarHtml(staff,roles,esc){
 const statuses=[...new Set(staff.map(s=>s.access_status).filter(Boolean))].sort();
 const present=Object.entries(roles).filter(([code])=>staff.some(s=>s.category_code===code));
 return `<div class="pcl-filters" role="search" aria-label="Filter people"><label>Search<input id="staffQ" type="search" placeholder="Name, staff ID or login" autocomplete="off"></label><label>Role<select id="staffRole"><option value="">All roles</option>${present.map(([c,l])=>`<option value="${esc(c)}">${esc(l)}</option>`).join('')}</select></label><label>Account<select id="staffStatus"><option value="">All accounts</option>${statuses.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label class="pcl-check"><input id="staffCustom" type="checkbox"> Restricted access only</label><span class="muted" id="staffShown" role="status" aria-live="polite"></span></div>`;
}
// Client-side filtering of the roster rows. Rows carry data attributes; nothing is fetched.
export function applyStaffFilter(root){
 const q=(root.querySelector('#staffQ')?.value||'').trim().toLowerCase(),role=root.querySelector('#staffRole')?.value||'',status=root.querySelector('#staffStatus')?.value||'',custom=!!root.querySelector('#staffCustom')?.checked;
 let shown=0;const rows=[...root.querySelectorAll('tr[data-staff-row]')];
 for(const r of rows){const ok=(!q||r.dataset.search.includes(q))&&(!role||r.dataset.role===role)&&(!status||r.dataset.status===status)&&(!custom||r.dataset.custom==='1');r.hidden=!ok;if(ok)shown++;}
 const note=root.querySelector('#staffShown');if(note)note.textContent=rows.length?`Showing ${shown} of ${rows.length}`:'';
 const none=root.querySelector('#staffNone');if(none)none.hidden=!(rows.length&&!shown);
}
export function bindStaffFilter(root){
 if(!root)return;
 for(const sel of ['#staffQ','#staffRole','#staffStatus','#staffCustom']){const el=root.querySelector(sel);if(el){el.oninput=()=>applyStaffFilter(root);el.onchange=()=>applyStaffFilter(root);}}
 applyStaffFilter(root);
}

// Access & rights: people whose access differs from their role, then the role guide and the action matrix.
export function customAccessHtml(staff,{areaLabel,roles,esc}){
 const custom=staff.filter(s=>(s.restricted_areas||[]).length||(s.restricted_rights||[]).length);
 if(!custom.length)return '<p class="muted">Nobody has restricted access. Everyone has the defaults for their role.</p>';
 return `<div class="scroll"><table><thead><tr><th>Person</th><th>Role</th><th>Areas switched off</th><th>Functions switched off</th><th></th></tr></thead><tbody>${custom.map(s=>`<tr><td><b>${esc(s.full_name)}</b><small>${esc(s.staff_identifier||'')}</small></td><td>${esc(roles[s.category_code]||s.category_code)}</td><td>${(s.restricted_areas||[]).length?esc(s.restricted_areas.map(areaLabel).join(', ')):'None'}</td><td>${(s.restricted_rights||[]).length?esc(String((s.restricted_rights||[]).length)):'None'}</td><td><button type="button" data-rights="${esc(s.staff_id)}">Edit access</button></td></tr>`).join('')}</tbody></table></div>`;
}
export function accessPaneHtml({me,staff,roles,areaLabel,esc,extraButtons=''}){
 const current=ACCESS_ROLES.find(x=>x.code===me.category_code);
 return `<section class="pcl-section"><div class="section-head"><h3>People with restricted access</h3><div class="actions">${extraButtons}</div></div><p class="muted">Use Edit access on the People tab to switch off an area or a single function for one person. Their role defaults apply to everything else.</p>${customAccessHtml(staff,{areaLabel,roles,esc})}</section>
 ${current?`<section class="pcl-section access-current"><h3>Your access · ${esc(current.label)}</h3><p><b>Scope:</b> ${esc(current.scope)}</p><p><b>Can do:</b> ${esc(current.work)}</p><p><b>Cannot do:</b> ${esc(current.limit)}</p></section>`:''}
 <section class="pcl-section"><h3>What each role can reach</h3><div class="scroll"><table><thead><tr><th>Role</th><th>Records</th><th>Typical work</th><th>Important limit</th></tr></thead><tbody>${ACCESS_ROLES.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${esc(ACCESS_PROFILE[r.code]?.records||r.scope)}</td><td>${esc(r.work)}</td><td>${esc(r.limit)}</td></tr>`).join('')}</tbody></table></div></section>
 <details class="pcl-section"><summary><strong>Actions by role and area</strong> <span class="muted">Read from the same list the server uses</span></summary><p class="muted">Highlighted actions are check, post and approve. They are reserved for reviewers and approvers.</p>${categoryActionMatrix(esc)}</details>`;
}

// Approvals: who checks, who approves, and the rules that keep preparer and reviewer apart.
export function approvalsPaneHtml({esc}){
 const order=['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN'];
 return `<section class="pcl-section"><h3>Check and approve, by role</h3><div class="scroll"><table><thead><tr><th>Role</th><th>Independent check</th><th>Approval</th></tr></thead><tbody>${order.map(code=>{const r=ACCESS_ROLES.find(x=>x.code===code),p=ACCESS_PROFILE[code];return `<tr><th scope="row">${esc(r.label)}</th><td>${esc(p.check)}</td><td>${esc(p.approve)}</td></tr>`;}).join('')}</tbody></table></div></section>
 <section class="pcl-section"><h3>Rules by kind of work</h3><div class="scroll"><table><thead><tr><th>Work item</th><th>Authorised reviewer</th><th>Control</th></tr></thead><tbody>${APPROVAL_RULES.map(r=>`<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div></section>
 <p class="muted">Work waiting for your check or approval is on your Home page under My reviews.</p>`;
}
