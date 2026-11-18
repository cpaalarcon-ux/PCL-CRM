// Settings layout (build 2836): the Settings page is one tab per kind of work, not one long list.
// Pure helpers, no browser needed. Every card keeps its own id and stays in the page (hidden when its tab is not open), so nothing is removed, only grouped.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const SETTINGS_TABS=Object.freeze([
 {code:'overview',label:'Overview',about:'Search, what is waiting for approval, and where every setting lives.'},
 {code:'firm',label:'Firm & Users',about:'Handling firms, staff cost and billing rates, and public holidays. Logins and staff records are under Staff.'},
 {code:'access',label:'Access & Approvals',about:'Who may approve what, the Tax Manager role, Partner policies and the go-live date.'},
 {code:'services',label:'Service Catalogue',about:'Service templates, their scope, and eligibility for restricted services.'},
 {code:'accounting',label:'Accounting & Tax Rules',about:'Chart of accounts, routing codes, starter rules, tax rules and KRA due dates.'},
 {code:'templates',label:'Upload & Export Templates',about:'Statutory file layouts (NSSF, SHIF, P10) and the upload templates in Resources.'},
 {code:'payroll',label:'Payroll Configuration',about:'Payroll set-up that applies to every client.'},
 {code:'integrations',label:'Integrations',about:'Connected services.'},
 {code:'records',label:'Records & Audit History',about:'Reference documents, the payroll access log and the measurement register.'}
]);

// Which tab each Settings card sits on. A card that is not listed falls into "Records & Audit History", so a new card can never disappear.
export const CARD_TAB=Object.freeze({
 overviewFeedsCard:'overview',myApprovalsCard:'overview',settingsHub:'overview',ownerMatrixCard:'access',
 staffRatesCard:'firm',handlingFirmsCard:'firm',
 taxRoleCard:'access',
 templateLibraryCard:'services',eligibilityCard:'services',
 chartCard:'accounting',starterConfirmCard:'accounting',taxRatesCard:'accounting',deadlineCard:'accounting',dueBacklogCard:'accounting',
 exportProfilesCard:'templates',
 referenceCard:'records',toolsCard:'records'
});
export const tabForCard=id=>CARD_TAB[id]||'records';

// Build 2849: the Accounting & Tax Rules tab is long (about 240 buttons), so each of its cards sits in a fold and one is open at a time (a shared
// name makes the browser close the others). The first card starts open. Every card keeps its own id inside the fold; nothing is removed.
export const FOLD_TABS=Object.freeze(['accounting']);
export const FOLD_TITLES=Object.freeze({chartCard:'Chart of accounts',starterConfirmCard:'Starter rules',taxRatesCard:'Tax rates and rules',deadlineCard:'KRA due dates',dueBacklogCard:'Due-date backlog'});
export function fold(id,html,{first=false,tab='accounting'}={}){
 if(!html)return '';
 const title=FOLD_TITLES[id]||String(id).replace(/Card$/,'').replace(/([A-Z])/g,' $1').trim();
 return `<details class="settings-fold" name="settings-fold-${esc(tab)}" data-fold="${esc(id)}"${first?' open':''}><summary>${esc(title)}</summary>${html}</details>`;
}

// Tabs with nothing to configure yet say so plainly, with where the related work lives. They are not blank pages and they promise nothing.
export const EMPTY_NOTES=Object.freeze({
 payroll:'Payroll components (allowances, deductions and reliefs) are not configured here yet. A client\u2019s employees and each month\u2019s payroll are handled in that client\u2019s payroll register. The NSSF, SHIF and P10 file layouts are under Upload & Export Templates.',
 integrations:'No connected service is configured from here. The ERP prepares files and records references; it does not file on the KRA or eTIMS portals, and bank lines come in by upload.'
});

export const SETTINGS_NAV_GROUPS=Object.freeze([
 {label:'Overview',codes:['overview']},
 {label:'Firm & governance',codes:['firm','access']},
 {label:'Service delivery',codes:['services','accounting','templates','payroll']},
 {label:'System & records',codes:['integrations','records']}
]);
const tabButton=(t,active,button)=>button('settings-tab',t.label,t.code,
 `id="settingsTab-${t.code}" class="settings-nav-item${t.code===active?' is-active primary':''}" role="tab" aria-selected="${t.code===active}" aria-controls="settingsPanel-${t.code}"`);
export const tabBar=(active,button)=>`<div class="actions subnav settings-tabs" role="tablist" aria-label="Settings sections">${SETTINGS_NAV_GROUPS.map(g=>`<div class="settings-nav-group"><span class="settings-nav-group-label">${esc(g.label)}</span>${g.codes.map(code=>tabButton(SETTINGS_TABS.find(t=>t.code===code),active,button)).join('')}</div>`).join('')}</div>`;

export function layoutView({active='overview',panels={},button}){
 const tab=SETTINGS_TABS.find(t=>t.code===active)||SETTINGS_TABS[0];
 return `<div class="settings-layout">${tabBar(tab.code,button)}<div class="settings-content"><p class="muted settings-tab-about">${esc(tab.about)}</p>${SETTINGS_TABS.map(t=>`<div class="settings-panel" id="settingsPanel-${t.code}" role="tabpanel" aria-labelledby="settingsTab-${t.code}" tabindex="0"${t.code===tab.code?'':' hidden'}><p class="muted settings-crumb">Settings \u2192 ${esc(t.label)}</p>${panels[t.code]||(EMPTY_NOTES[t.code]?`<section class="card"><p class="info">${esc(EMPTY_NOTES[t.code])}</p></section>`:'')}</div>`).join('')}</div></div>`;
}

// ---- Who can do what -------------------------------------------------------------------------------------------------
// Only rules that the server enforces today. Partner is above Manager above Supervisor above Assistant above Intern;
// anything a Manager may confirm or approve, a Partner may too (the one exception is a person's own work, which nobody approves).
export const ROLE_COLUMNS=Object.freeze([
 ['PARTNER','Engagement Partner'],['MANAGER','Manager'],['SUPERVISOR','Supervisor'],['ASSISTANT','Assistant'],['INTERN','Intern']
]);
const Y='Yes',N='—';
export const RIGHTS_ROWS=Object.freeze([
 {group:'Approvals reserved to the Engagement Partner',rows:[
  {what:'Grant additional rights, assign Tax Managers, switch the Tax Manager permission',who:[Y,N,N,N,N]},
  {what:'Approve and finalize an audit file, EQR clearance, archive a completed file',who:[Y,N,N,N,N]},
  {what:'Confirm a regulatory calendar rule, verify a legal reference, withdraw a confirmed rule',who:[Y,N,N,N,N]},
  {what:'Sign off a policy, set the go-live date, manage the holiday calendar',who:[Y,N,N,N,N]},
  {what:'Approve enhanced due diligence; reopen a confirmed summary; open a late change',who:[Y,N,N,N,N]},
  {what:'Decide which client services are billed; see Partner time',who:[Y,N,N,N,N]}]},
 {group:'Tax rules',rows:[
  {what:'Confirm and approve VAT, withholding tax and excise duty rules',who:['Yes, not a rule they prepared','Only as the assigned Tax Manager, or with the Tax Lead right',N,N,N]}]},
 {group:'Review and approval of client work',rows:[
  {what:'Approve and post client accounting (journals, charts, mappings, set-up sections)',who:['Yes, not own work','Yes, not own work',N,N,N]},
  {what:'Check an entry before it is approved',who:[Y,Y,'Yes, not own work',N,N]},
  {what:'Issue a client letter',who:[Y,'If named signatory','If named signatory','If named signatory','If named signatory']},
  {what:'Verify a KYC change; activate a client profile',who:['Yes, not own work','Yes, not own work',N,N,N]}]},
 {group:'Running the work',rows:[
  {what:'Set up an engagement; reallocate work; send work to the pool; review a document',who:[Y,Y,Y,N,N]},
  {what:'Keep the measurement register of the 95% target',who:[Y,Y,Y,N,N]}]},
 {group:'Settings and records',rows:[
  {what:'Open Settings, the settings hub and the payroll access log',who:[Y,Y,N,N,N]},
  {what:'Change a Partner or Manager account',who:[Y,N,N,N,N]},
  {what:'Change a Supervisor, Assistant or Intern account',who:[Y,'Their own team',N,N,N]}]}
]);
export const RIGHTS_NOTES=Object.freeze([
 'A Partner holds every approval a Manager holds. The person who prepared something never approves it; a second person does, and every approval is recorded under the name of the person who is signed in.',
 'Approved records are never edited. They are ended or superseded with a reason, and the history is kept.',
 'A System Administrator manages logins, chat groups and system lists. They see no client records and cannot approve anything.',
 'Finance, HR, MLRO and System Administrator are appointments, not ranks: a Partner holds them only when appointed.'
]);

export function rightsView({me='',rows=RIGHTS_ROWS,columns=ROLE_COLUMNS}={}){
 const mine=columns.findIndex(c=>c[0]===me);
 const head=`<tr><th>What</th>${columns.map(([code,label],i)=>`<th${i===mine?' class="me" aria-current="true"':''}>${esc(label)}${i===mine?'<small> (you)</small>':''}</th>`).join('')}</tr>`;
 const body=rows.map(g=>`<tr class="hub-group"><th colspan="${columns.length+1}">${esc(g.group)}</th></tr>${g.rows.map(r=>`<tr><td>${esc(r.what)}</td>${r.who.map((v,i)=>`<td${i===mine?' class="me"':''}>${v===N?'<span class="muted">—</span>':esc(v)}</td>`).join('')}</tr>`).join('')}`).join('');
 return `<section class="card" id="rightsMatrix"><h2>Who can do what</h2><p class="muted">Ranked from the Engagement Partner down. This page reads only: rights are given and ended under Staff and access.</p><div class="scroll"><table id="rightsTable"><thead>${head}</thead><tbody>${body}</tbody></table></div><ul class="muted rights-notes">${RIGHTS_NOTES.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></section>`;
}
