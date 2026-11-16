// Settings owners and My Approvals (build 2839). Pure.
// Owner Matrix: a Partner confirms who owns each settings section. The owner is information: it says who prepares, reviews and approves a section.
// It never grants or removes a right, and the person who prepared a record still never approves it. A section with no confirmed owner shows the build's suggestion, labelled as one.
import {SECTIONS,OWNER_ROLES,roleLabel} from './settings-hub-rules.mjs';
export {OWNER_ROLES,roleLabel};
// Registers that are not in the hub list but have records that wait for approval. No owner is suggested for them: nothing in the build or the notes names one.
export const EXTRA_SECTIONS=Object.freeze([
 {key:'svc_templates',title:'Service templates',group:'Registers',area:'service_template'},
 {key:'export_profiles',title:'Statutory export profiles',group:'Registers',area:'export_profile'},
 {key:'upload_templates',title:'Upload templates',group:'Registers',area:'upload_template'},
 {key:'routing_maps',title:'Client routing mappings',group:'Registers',area:'routing_map'},
 {key:'eligibility_records',title:'Service eligibility evidence',group:'Registers',area:'eligibility'}
]);
export const AREA_SECTION=Object.freeze({tax_rate:'approve_tax_rates',policy:'approve_policies',...Object.fromEntries(EXTRA_SECTIONS.map(s=>[s.area,s.key]))});
export const SECTION_KEYS=Object.freeze([...SECTIONS.map(s=>s.key),...EXTRA_SECTIONS.map(s=>s.key)]);
export const MAX_ITEMS=30;
const ROLE_CODES=OWNER_ROLES.map(r=>r[0]);
export function ownerMatrix(openOwners){
 const by=new Map((openOwners||[]).map(o=>[o.section_key,o]));
 const rows=[...SECTIONS.map(s=>({key:s.key,title:s.title,group:s.group,where:s.where,suggested_owner:s.owner,suggested_role:s.role||null})),...EXTRA_SECTIONS.map(s=>({key:s.key,title:s.title,group:s.group,where:'',suggested_owner:'',suggested_role:null}))];
 return rows.map(r=>{const o=by.get(r.key);return {...r,confirmed:o?{role:o.owner_role,role_label:roleLabel(o.owner_role),staff_id:o.owner_staff_id||null,staff_name:o.staff_name||null,confirmed_by:o.confirmed_by_name||null,confirmed_at:o.confirmed_at?new Date(o.confirmed_at).toISOString():null,note:o.note||null}:null};});
}
// Items from the form: [{section_key,owner_role,staff_id?,note?}]. Rows left blank are not sent. Returns the clean list or the first problem.
export function checkItems(items,isStaff=()=>true){
 if(!Array.isArray(items)||!items.length)return {ok:false,message:'Choose an owner for at least one section.'};
 if(items.length>MAX_ITEMS)return {ok:false,message:`Confirm at most ${MAX_ITEMS} sections at a time.`};
 const seen=new Set(),out=[];
 for(const i of items){
  const key=String(i?.section_key||''),role=String(i?.owner_role||'');
  if(!SECTION_KEYS.includes(key))return {ok:false,message:'One of the sections is not in the list. Refresh the matrix.'};
  if(seen.has(key))return {ok:false,message:'A section was listed twice.'};seen.add(key);
  if(!ROLE_CODES.includes(role))return {ok:false,message:'Choose an owner role from the list.'};
  const staff=i.staff_id?String(i.staff_id):null;if(staff&&!isStaff(staff))return {ok:false,message:'The named person is not an active member of staff.'};
  const note=String(i.note||'').trim();if(note&&(note.length<3||note.length>500))return {ok:false,message:'A note is 3 to 500 characters.'};
  out.push({section_key:key,owner_role:role,staff_id:staff,note:note||null});
 }
 return {ok:true,items:out};
}
// ---- My Approvals --------------------------------------------------------------------------------------------------------------
// The filters themselves run in the browser (staff-approvals-filter.mjs).
// Who can act on a queue. The setting's own server still decides when the button is pressed; this only says whether the queue is yours to look at first.
const QUEUE_ACTORS={approve_policies:['PARTNER'],approve_chart:['PARTNER'],approve_statement_lines:['PARTNER'],approve_bank_rules:['PARTNER','MANAGER'],starter_confirmations:['PARTNER'],due_date_backlog:['PARTNER','MANAGER']};
export function queueNeedsMe(key,role,canApproveTax){
 if(key==='approve_tax_rates')return !!canApproveTax;
 return (QUEUE_ACTORS[key]||[]).includes(role);
}
const WAITING=['Draft','In Review'];
// A record needs me when it waits, I may approve that kind of record, and I did not prepare it.
export function recordNeedsMe(rec,role,me,canApproveTax){
 if(!WAITING.includes(rec.state))return false;
 if(!['PARTNER','MANAGER'].includes(role))return false;
 if(rec.prepared_by&&me&&rec.prepared_by===me)return false;
 if(rec.area==='tax_rate')return !!canApproveTax&&rec.native_status!=='Rejected';
 if(rec.area==='eligibility'||rec.area==='routing_map')return role==='PARTNER'; // a Partner verifies evidence and approves a routing mapping
 if(rec.area==='service_template'||rec.area==='export_profile'||rec.area==='upload_template')return role==='PARTNER'||role==='MANAGER';
 return false;
}
