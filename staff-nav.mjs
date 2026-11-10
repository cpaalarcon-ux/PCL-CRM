// Navigation. The menu groups were settled in Step 9; this file lists the built modules that get a sub-link under their parent,
// and holds the small pure helpers for the collapsible menu and the count badge (so they can be tested without a browser).
// A module is listed with built:true only when its screen exists, so there are no dead menu items.
// Each link opens the module's own screen (a window), so it needs no new page. Roles mirror the roles that can open the screen.
//
// Build 2680 (the user's instruction of 10 Nov): service workflows live under one parent, "Engagements & Delivery". It is a group with no page of
// its own. "Projects & Tasks" keeps the project and task manager. A link that gets a count carries badge:'<key>'.
const LEADERS=['PARTNER','MANAGER','SUPERVISOR'];
export const GROUP_ENGAGEMENTS={key:'engagements',title:'Engagements & Delivery',icon:'◈'};
export const MODULE_LINKS=[
 {key:'kra',parent:'engagements',area:'projects',title:'KRA notices',action:'kra-open',built:true,roles:[...LEADERS,'ASSISTANT'],note:'KRA notice log, its verification task and flags (Step 7)'},
 {key:'incoming',parent:'documents',area:'documents',title:'Incoming review',action:'incoming-open',built:true,roles:LEADERS,badge:'incoming',note:'Received files waiting for a client and a filing (Step 8)'},
 {key:'timeline',parent:'communications',area:'communications',title:'Client timeline',action:'incoming-timeline-pick',built:true,roles:LEADERS,note:'Messages and documents for one client (Step 8)'},
 // The link shows for every role that can be put on a file's list; it only opens the person's own list, which is empty unless they were added.
 {key:'forensic',parent:'engagements',area:'audit',title:'Forensic files',action:'forensic-open',built:true,gate:'forensic',roles:[...LEADERS,'ASSISTANT'],note:'Forensic restricted file: visible only to its access list (built)'}
];
// The agreed-upon-procedures engine has no list screen of its own: it is reached from a project (Review & activate), so it has no sidebar link.
export const NO_LINK_MODULES=['aup'];
export function moduleLinks(me,parent,canArea=()=>true,flags={}){
 const role=me?.category_code;
 return MODULE_LINKS.filter(m=>m.built&&m.parent===parent&&m.roles.includes(role)&&canArea(m.area||m.parent)&&(!m.gate||flags[m.gate]===true)).map(m=>({title:m.title,suite:m.action,key:m.key,badge:m.badge||''}));
}

// ---- Collapsible menu: which parents are open is remembered in this browser, per signed-in person (a display preference, not data).
export const NAV_STORE_KEY='pcl-staff-nav-open-v1';
const storeKey=staffId=>NAV_STORE_KEY+':'+String(staffId||'');
export function readOpen(storage,staffId){
 try{const v=JSON.parse(storage?.getItem(storeKey(staffId))||'[]');return new Set(Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.length<40).slice(0,30):[]);}catch{return new Set();}
}
export function writeOpen(storage,staffId,set){
 try{storage?.setItem(storeKey(staffId),JSON.stringify([...set]));}catch{/* private window or blocked storage: the menu still works, it just forgets */}
}
// The parent that holds the page being shown opens by itself whenever the page changes; a person's own choice is kept until they change it.
export function openForView(open,items,isActive){
 const next=new Set(open);
 for(const it of items)if((it.subs||[]).length&&(isActive(it)||it.subs.some(isActive)))next.add(it.key||it.view);
 return next;
}

// ---- Count badge. Hidden at zero, "99+" above 99, grey normally, red only when something has waited past the limit.
export function badgeView(waiting,overdue){
 const n=Math.max(0,Math.floor(Number(waiting)||0));
 if(!n)return null;
 const o=Math.max(0,Math.floor(Number(overdue)||0));
 return {text:n>99?'99+':String(n),overdue:o>0,label:o>0?`${n} waiting, ${o} overdue`:`${n} waiting`};
}
export function badgeHtml(b,esc=s=>s){
 return b?`<span class="nav-badge${b.overdue?' overdue':''}" role="img" aria-label="${esc(b.label)}" title="${esc(b.label)}">${esc(b.text)}</span>`:'';
}
// A collapsed parent shows the total of its links' counts, so a waiting file is never hidden by a closed section.
export function rollupBadge(subs,badges){
 let waiting=0,overdue=0;
 for(const s of subs||[]){if(!s.badge)continue;const b=badges?.[s.badge];waiting+=Number(b?.waiting||0);overdue+=Number(b?.overdue||0);}
 return badgeView(waiting,overdue);
}
