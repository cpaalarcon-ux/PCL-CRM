// Settings hub (build 2787): the list of settings sections, who should own each, and how the counts from the database are worded. Pure.
// The owners are SUGGESTED by the build: a Partner has not confirmed who owns what, and the page says so. Nothing here changes how any setting behaves.
// Forensic settings are not listed on purpose: an ordinary screen says nothing about a forensic file.
export const OWNER_NOTE='Owners are suggestions. A Partner has not yet confirmed who owns each section.';
export const SECTIONS=[
 {key:'kra_checks',role:'TAX_LEAD',go:{review:'kra-settings'},group:'Defaults awaiting confirmation',title:'KRA notice checks',owner:'Tax Lead; a Partner records the confirmation',where:'Client services > KRA notices > Task and flag settings',about:'Task lead days, flag thresholds, severities and the Partner alert days.'},
 {key:'deadline_windows',role:'TAX_LEAD',go:{tab:'accounting'},group:'Defaults awaiting confirmation',title:'Filing deadline windows',owner:'Tax Lead; a Partner records the confirmation',where:'Settings > Filing deadline windows',about:'How many days before and after the KRA date a filing is flagged.'},
 {key:'annual_due_rules',role:'TAX_LEAD',go:{tab:'access'},group:'Defaults awaiting confirmation',title:'Annual due-date rules',owner:'Tax Lead; a Partner records the confirmation',where:'Settings > Tax Manager role and annual due dates',about:'Month-end and other annual return due-date rules.'},
 {key:'tax_defaults',role:'TAX_LEAD',go:{view:'clients'},group:'Defaults awaiting confirmation',title:'Tax defaults by legal structure',owner:'Tax Lead',where:'Client set-up',about:'Starting tax settings suggested for each legal structure.'},
 {key:'incoming_review',role:'PARTNER',go:{view:'documents'},group:'Defaults awaiting confirmation',title:'Incoming review',owner:'Partner',where:'Documents > Incoming review settings',about:'Who may accept a file, and how long a file may wait.'},
 {key:'licences',role:'PARTNER',go:{view:'clients'},group:'Defaults awaiting confirmation',title:'Client licences',owner:'Partner',where:'Client file > Licences',about:'Licence types and which clients are expected to hold them.'},
 {key:'service_profiles',role:'PARTNER',go:{view:'projects'},group:'Defaults awaiting confirmation',title:'Service checklists and references',owner:'Partner',where:'Engagements > Service profiles',about:'Checklist items and references behind each service.'},
 {key:'aup_library',role:'PARTNER',go:{view:'audit'},group:'Defaults awaiting confirmation',title:'Agreed-upon procedures library',owner:'Partner',where:'Engagements > Agreed-upon procedures',about:'The procedure library used to build an engagement.'},
 {key:'kyc_rules',role:'PARTNER',go:{view:'clients'},group:'Defaults awaiting confirmation',title:'KYC evidence rules',owner:'Partner',where:'Client set-up > KYC',about:'Which evidence each kind of client must provide.'},
 {key:'approve_policies',role:'PARTNER',go:{tab:'overview'},group:'Waiting for approval',title:'Partner policies awaiting signature',owner:'Partner',where:'Settings > Partner policies',about:'Policies that stay in force only once a Partner signs them.',needs:'to sign'},
 {key:'approve_tax_rates',role:'TAX_LEAD',go:{tab:'accounting'},group:'Waiting for approval',title:'Tax rates in draft',owner:'Tax Lead proposes; a Partner approves after legal review',where:'Settings > Tax rates',about:'A rate is used only after it is approved. No rate is stored without written confirmation.',needs:'to approve'},
 {key:'approve_chart',role:'PARTNER',go:{tab:'accounting'},group:'Waiting for approval',title:'Chart of accounts additions in draft',owner:'Partner',where:'Settings > Chart of accounts',about:'New accounts stay Draft until a Partner activates them.',needs:'to activate'},
 {key:'approve_statement_lines',role:'PARTNER',go:{review:'statement'},group:'Waiting for approval',title:'Statement-line mappings in draft',owner:'Partner',where:'Annual accounts > Statement-line mapping',about:'Which statement line each account sits on.',needs:'to approve'},
 {key:'approve_bank_rules',role:'MANAGER',go:{view:'clients'},group:'Waiting for approval',title:'Proposed bank narration rules',owner:'A Manager or Partner who did not propose the rule',where:'Client accounting > Banks > Fix-It queue',about:'A proposed rule maps nothing until a different person approves it.',needs:'to approve'},
 {key:'starter_confirmations',role:'TAX_LEAD',go:{tab:'accounting'},group:'Waiting for approval',title:'Bank starter rules waiting for the Tax Lead',owner:'A Partner records the Tax Lead\'s written confirmation',where:'Settings > Bank starter rules waiting for the Tax Lead',about:'A starter rule that depends on a tax ruling stays locked until the confirmation is recorded.',needs:'to confirm'},
 {key:'due_date_backlog',role:'TAX_LEAD',go:{tab:'accounting'},group:'Waiting for approval',title:'Tax periods waiting for a KRA due date',owner:'The Tax Lead, a Manager or a Partner confirms each date against the iTax calendar',where:'Settings > Tax periods waiting for a KRA due date',about:'A period counts its filing warnings from the task date until the KRA date is confirmed or the task date is chosen on purpose.',needs:'to confirm'},
];
// Sections whose counts come from the server code, not from erp_private.settings_hub().
export const COMPUTED_KEYS=['starter_confirmations','due_date_backlog'];
// counts: [{section_key,pending,total}] from erp_private.settings_hub()
// The roles an owner can be, in the words the screens use (build 2839). A Partner confirms an owner for each section in the Owner Matrix; confirming changes nobody's rights.
export const OWNER_ROLES=Object.freeze([['PARTNER','Engagement Partner'],['TAX_LEAD','Tax Lead'],['MANAGER','Manager'],['FINANCE','Finance'],['HR','HR'],['SYSADMIN','System Administrator']]);
export const roleLabel=code=>(OWNER_ROLES.find(r=>r[0]===code)||[code,code])[1];
// owners: [{section_key,owner_role,staff_name,confirmed_by_name,confirmed_at}] the open (not ended) confirmations
export function buildHub(counts,owners=[]){
 const by=new Map((counts||[]).map(c=>[c.section_key,{pending:Number(c.pending||0),total:Number(c.total||0)}]));
 const ownBy=new Map((owners||[]).map(o=>[o.section_key,o]));
 const sections=SECTIONS.map(s=>{const c=by.get(s.key)||{pending:0,total:0},waiting=s.group==='Waiting for approval';
  return {...s,confirmed_owner:ownBy.has(s.key)?{...ownBy.get(s.key),owner_label:roleLabel(ownBy.get(s.key).owner_role)}:null,pending:c.pending,total:c.total,status:waiting?(c.pending?`${c.pending} ${s.needs}`:'Nothing waiting'):(c.total===0?'Nothing set':c.pending?`${c.pending} of ${c.total} still a default`:'All confirmed'),open:c.pending>0};});
 const confirmed=sections.filter(x=>x.confirmed_owner).length;
 return {note:confirmed===0?OWNER_NOTE:confirmed===sections.length?'A Partner has confirmed an owner for every section.':`A Partner has confirmed an owner for ${confirmed} of ${sections.length} sections. The others are still suggestions.`,owners_confirmed:confirmed,sections,waiting:sections.filter(s=>s.group==='Waiting for approval'&&s.pending>0),defaults:sections.filter(s=>s.group!=='Waiting for approval'&&s.pending>0).reduce((n,s)=>n+s.pending,0)};
}
const norm=s=>String(s??'').toLowerCase();
export const searchSections=(sections,q)=>{const t=norm(q).trim();return t?sections.filter(s=>norm([s.title,s.owner,s.where,s.about,s.group].join(' ')).includes(t)):sections;};
