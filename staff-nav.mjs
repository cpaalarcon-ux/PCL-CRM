// Step 9: the one menu regroup. The sidebar groups were already settled; this file lists the built modules that get a sub-link
// under their parent area. A module is listed here with built:true only when its screen exists, so there are no dead menu items.
// Each link opens the module's own screen (a window), so it needs no new page. Roles mirror the roles that can open the screen.
const LEADERS=['PARTNER','MANAGER','SUPERVISOR'];
export const MODULE_LINKS=[
 {key:'kra',parent:'projects',title:'KRA notices',action:'kra-open',built:true,roles:[...LEADERS,'ASSISTANT'],note:'KRA notice log, its verification task and flags (Step 7)'},
 {key:'incoming',parent:'documents',title:'Incoming review',action:'incoming-open',built:true,roles:LEADERS,note:'Received files waiting for a client and a filing (Step 8)'},
 {key:'timeline',parent:'communications',title:'Client timeline',action:'incoming-timeline-pick',built:true,roles:LEADERS,note:'Messages and documents for one client (Step 8)'},
 // Not built yet. Kept here so it appears the day it is built (set built:true then); until then nobody sees a link.
 {key:'forensic',parent:'projects',title:'Forensic files',action:'forensic-open',built:false,roles:[],note:'Forensic restricted file (not built)'}
];
// The agreed-upon-procedures engine has no list screen of its own: it is reached from a project (Review & activate), so it has no sidebar link.
export const NO_LINK_MODULES=['aup'];
export function moduleLinks(me,parent,canArea=()=>true){
 const role=me?.category_code;
 return MODULE_LINKS.filter(m=>m.built&&m.parent===parent&&m.roles.includes(role)&&canArea(m.parent)).map(m=>({title:m.title,suite:m.action,key:m.key}));
}
