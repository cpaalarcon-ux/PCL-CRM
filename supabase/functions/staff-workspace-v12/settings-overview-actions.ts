import {fail,uuid} from './validation.mjs';
import {AREAS,buildOverview,present,checksFor,actionsFor,configurationFields,versionsOf} from './settings-state-rules.mjs';

// Settings overview and record page (build 2837): read only. It lists the firm-wide configuration records with one shared reading of their state,
// the feeds on the Settings overview, and the pages behind each record (overview, configuration, versions and approvals, change history).
// It changes no record. Every action it offers opens the setting's own screen, where that setting's own approval rules apply.
const READERS=['PARTNER','MANAGER'];
const today=()=>new Date(Date.now()+3*3600*1000).toISOString().slice(0,10); // Nairobi calendar day
async function register(tx:any){const r=(await tx`select erp_private.settings_register() as r`)[0]?.r;return Array.isArray(r)?r:[];}
export async function settingsOverviewAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action!=='settings_overview_read'&&p.action!=='settings_record_read')return undefined;
 if(!READERS.includes(a.category_code))fail(403,'The settings overview is for Managers and Partners.');
 const records=await register(tx),t=today();
 if(p.action==='settings_overview_read'){
  const changes=await tx`select occurred_at,area,record_id,action,actor_name,status_before,status_after,changed_fields from erp_private.settings_changes(null,null,60)`;
  return buildOverview(records,changes.map((c:any)=>({...c,occurred_at:new Date(c.occurred_at).toISOString()})),t);
 }
 const area=String(p.area||'');if(!(area in AREAS))fail(400,'Choose a settings area from the list.');
 const id=area==='policy'?String(p.record_id||'').slice(0,80):uuid(p.record_id);
 const all=records.map((r:any)=>present(r,t));
 const rec=all.find((r:any)=>r.area===area&&r.record_id===id);if(!rec)fail(404,'That settings record was not found, or it is not yours to open.');
 const history=await tx`select occurred_at,actor_name,action,status_before,status_after,changed_fields from erp_private.settings_changes(${area},${id},40)`;
 const out:any={record:rec,area_label:AREAS[area as keyof typeof AREAS].label,group:AREAS[area as keyof typeof AREAS].group,tab:AREAS[area as keyof typeof AREAS].tab,
  checks:checksFor(rec,all,t),actions:actionsFor(rec,a.category_code),fields:configurationFields(rec),versions:versionsOf(rec,all),
  history:history.map((h:any)=>({occurred_at:new Date(h.occurred_at).toISOString(),actor:h.actor_name||'',action:h.action==='INSERT'?'Created':'Changed',status_before:h.status_before,status_after:h.status_after,fields:h.changed_fields||[]}))};
 if(area==='tax_rate'){
  const r=(await tx`select parameters,source_url,source_note,legal_citation,legal_review_note from erp_private.tax_rates where rate_id=${id}`)[0];
  if(r){out.tax={parameters:r.parameters||{},source_url:r.source_url||'',source_note:r.source_note||'',legal_citation:r.legal_citation||'',legal_review_note:r.legal_review_note||''};}
 }
 return out;
}
