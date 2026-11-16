// Settings state vocabulary, checks, feeds and the action bar (build 2837). Pure: no database, no browser.
// Every setting keeps its own native status (Draft, Testing, Approved, Published, Verified, Signed_Off and so on) and its own approval path.
// This module only gives them one shared reading, Draft / In Review / Approved / Active / Suspended / Retired, so the Settings screens can be laid out the same way.
// It never changes a record. Nothing here approves anything: the buttons it lists open the existing screens, and the server of each setting still decides who may act.

export const STATES=['Draft','In Review','Approved','Active','Suspended','Retired'];
export const HORIZON_DAYS=60;

// area -> where it sits in Settings (tab code from staff-settings-layout.mjs) and the owner's group name.
export const AREAS={
 tax_rate:{label:'Tax rules',tab:'accounting',group:'Accounting & Tax Rules',noun:'tax rule'},
 routing_map:{label:'Routing mappings',tab:'accounting',group:'Accounting & Tax Rules',noun:'routing mapping'},
 service_template:{label:'Service templates',tab:'services',group:'Service Catalogue',noun:'service template'},
 eligibility:{label:'Service eligibility and licences',tab:'services',group:'Service Catalogue',noun:'eligibility record'},
 export_profile:{label:'Statutory export profiles',tab:'templates',group:'Upload & Export Templates',noun:'export profile'},
 upload_template:{label:'Upload templates',tab:'templates',group:'Upload & Export Templates',noun:'upload template'},
 policy:{label:'Partner policies',tab:'records',group:'Records & Audit History',noun:'policy'}
};

const day=v=>v==null||v===''?null:String(v).slice(0,10);
export const daysBetween=(from,to)=>Math.round((Date.parse(day(to)+'T00:00:00Z')-Date.parse(day(from)+'T00:00:00Z'))/86400000);

// ---- the shared reading of each native status -------------------------------------------------------------------------
// Dates decide Approved (not yet in force), Active (in force) and Retired (period over). Suspended is derived, never typed in:
// it is an authorisation or policy that has lapsed, and it blocks use until it is renewed. There is no manual "suspend" action yet.
function window(r,today){
 const from=day(r.effective_from),to=day(r.effective_to);
 if(to&&to<today)return 'Retired';
 if(from&&from>today)return 'Approved';
 return 'Active';
}
export function unifiedState(r,today){
 const s=r.native_status,x=r.extra||{};
 switch(r.area){
  case 'tax_rate':
   if(s==='Draft')return x.legal_review_status==='Pending'?'In Review':'Draft';
   if(s==='Testing')return 'In Review';
   if(s==='Approved')return window(r,today);
   if(s==='Rejected')return 'Retired';
   return null;
  case 'service_template':
   return s==='Draft'?'Draft':s==='Approved'?'Active':s==='Retired'?'Retired':null;
  case 'export_profile':
  case 'upload_template':
   if(s==='Draft')return 'Draft';
   if(s==='Retired'||x.ended)return 'Retired';
   if(s==='Published')return window(r,today);
   return null;
  case 'routing_map':
   if(s==='Draft')return 'Draft';
   if(s==='Inactive')return 'Retired';
   if(s==='Active')return window(r,today);
   return null;
  case 'eligibility':
   if(s==='Recorded')return 'In Review';
   if(s==='Ended')return 'Retired';
   if(s==='Verified')return r.expires_on&&day(r.expires_on)<today?'Suspended':'Active';
   return null;
  case 'policy':
   if(s==='Pending')return 'In Review';
   if(s==='Expired')return 'Suspended';
   if(s==='Signed_Off')return 'Active';
   return null;
  default:return null;
 }
}

export function present(r,today){
 const state=unifiedState(r,today);
 return {area:r.area,area_label:AREAS[r.area]?.label||r.area,group:AREAS[r.area]?.group||'',tab:AREAS[r.area]?.tab||'records',record_id:String(r.record_id),group_key:r.group_key,code:r.code,label:r.label,
  native_status:r.native_status,state:state||'Draft',state_known:state!=null,version:r.version??null,revision:r.revision??null,effective_from:day(r.effective_from),effective_to:day(r.effective_to),expires_on:day(r.expires_on),
  approver:r.approved_by||null,approved_at:r.approved_at||null,prepared_by:r.prepared_by||null,extra:r.extra||{}};
}

// ---- checks ("Validate") ----------------------------------------------------------------------------------------------
// Each check says what it looked at. A failing check is shown with the sentence that tells staff what to fix.
const overlap=(a,b)=>{const af=a.effective_from||'0000-01-01',at=a.effective_to||'9999-12-31',bf=b.effective_from||'0000-01-01',bt=b.effective_to||'9999-12-31';return af<=bt&&bf<=at;};
export function checksFor(rec,all,today){
 const out=[],x=rec.extra||{},add=(code,ok,pass,fail)=>out.push({code,ok,message:ok?pass:fail});
 const peers=all.filter(p=>p.area===rec.area&&p.group_key===rec.group_key&&p.record_id!==rec.record_id);
 switch(rec.area){
  case 'tax_rate':{
   add('SOURCE',!!x.has_source,'A source is recorded.','No source is recorded. Record the source or the written confirmation before this rule is approved.');
   if(['Draft','In Review','Approved','Active'].includes(rec.state)&&rec.native_status!=='Rejected')add('FIGURES',!!x.has_figures,'Rates and bases are filled in.','The rule has no rate or base yet. It waits for the Tax Lead\'s written confirmation, and nothing is calculated from it.');
   if(rec.native_status==='Draft'&&x.legal_review_status==='Pending')add('LEGAL',false,'','The Tax Lead has not confirmed the legal basis yet.');
   if(['Approved','Active'].includes(rec.state)){const clash=peers.find(p=>p.native_status==='Approved'&&overlap(rec,p));add('OVERLAP',!clash,'No other approved version covers the same dates.',`Another approved version of ${rec.code} covers the same dates (${clash?.effective_from||'open start'} to ${clash?.effective_to||'open end'}). End one of them.`);}
   break;}
  case 'export_profile':{
   if(rec.native_status==='Published'||rec.state==='Active'){const clash=peers.find(p=>p.native_status==='Published'&&!p.extra?.ended&&overlap(rec,p));add('OVERLAP',!clash,'No other published profile covers the same return and dates.',`Another published profile for ${rec.code} covers the same dates. Only one may be in force.`);}
   if(rec.native_status==='Published')add('VERIFIED',!!(x.verified_on&&x.verified_against),'The layout was checked against an authority source.','The layout was not checked against an authority source.');
   add('TEST_FILE',false,'','Test-file status: not tracked. There is no test-file step in the system yet, so a file is checked only by its own readiness list when it is built.');
   break;}
  case 'eligibility':{
   if(rec.native_status==='Verified'||rec.native_status==='Recorded'){add('EXPIRY',!!rec.expires_on,'An expiry date is recorded.','No expiry date is recorded. Add one so the authorisation can be watched.');
    if(rec.expires_on&&rec.native_status!=='Ended')add('LAPSED',rec.expires_on>=today,'The authorisation is in date.','The authorisation has expired. The service stays blocked until it is renewed and verified again.');}
   break;}
  case 'routing_map':{
   if(rec.native_status==='Active'){const clash=peers.find(p=>p.native_status==='Active'&&overlap(rec,p));add('OVERLAP',!clash,'No other active mapping for this code and client covers the same dates.','Another active mapping for this code covers the same dates.');}
   break;}
  case 'policy':{
   if(rec.native_status==='Signed_Off'&&rec.expires_on)add('REVIEW',rec.expires_on>=today,'The review date has not passed.','The review date has passed. A Partner reviews and signs the policy again.');
   break;}
  default:break;
 }
 return out;
}
// Which failing checks belong in the "failed validations" feed. Test-file status is information, not a failure of the setting.
const FEED_SKIP=new Set(['TEST_FILE']);

// ---- the overview ------------------------------------------------------------------------------------------------------
export function expiryOf(rec,today){
 // The date that ends this record's authority, if it has one and it is still in use.
 if(rec.state==='Retired')return null;
 if(rec.area==='eligibility'&&['Verified','Recorded'].includes(rec.native_status)&&rec.expires_on)return {date:rec.expires_on,what:'authorisation'};
 if(rec.area==='policy'&&rec.native_status==='Signed_Off'&&rec.expires_on)return {date:rec.expires_on,what:'policy review'};
 if(['tax_rate','export_profile','upload_template','routing_map'].includes(rec.area)&&rec.state==='Active'&&rec.effective_to)return {date:rec.effective_to,what:'period'};
 return null;
}
export function buildOverview(records,changes,today,{horizon=HORIZON_DAYS,limit=8}={}){
 const recs=records.map(r=>present(r,today));
 const counts={};for(const a of Object.keys(AREAS))counts[a]=Object.fromEntries(STATES.map(s=>[s,0]));
 for(const r of recs)if(counts[r.area])counts[r.area][r.state]++;
 const waiting=recs.filter(r=>r.state==='Draft'||r.state==='In Review');
 const byArea=new Map();for(const r of waiting){if(!byArea.has(r.area))byArea.set(r.area,[]);byArea.get(r.area).push(r);}
 const pending=[...byArea.entries()].map(([area,items])=>({area,label:AREAS[area].label,tab:AREAS[area].tab,count:items.length,items:items.slice(0,limit).map(i=>({area:i.area,record_id:i.record_id,label:i.label,state:i.state,native_status:i.native_status}))}));
 const expiring=[];for(const r of recs){const e=expiryOf(r,today);if(!e)continue;const left=daysBetween(today,e.date);if(left<=horizon)expiring.push({area:r.area,area_label:r.area_label,record_id:r.record_id,label:r.label,date:day(e.date),days:left,what:e.what,lapsed:left<0});}
 expiring.sort((a,b)=>a.days-b.days);
 const failing=[];for(const r of recs){for(const c of checksFor(r,recs,today)){if(!c.ok&&!FEED_SKIP.has(c.code)&&!(r.state==='Retired'))failing.push({area:r.area,area_label:r.area_label,record_id:r.record_id,label:r.label,check:c.code,message:c.message});}}
 const label=new Map(recs.map(r=>[r.area+':'+r.record_id,r.label]));
 const recent=(changes||[]).map(c=>({occurred_at:c.occurred_at,area:c.area,area_label:AREAS[c.area]?.label||c.area,record_id:c.record_id,label:label.get(c.area+':'+c.record_id)||'(record not in the list)',action:c.action==='INSERT'?'Created':'Changed',actor:c.actor_name||'',status_before:c.status_before||null,status_after:c.status_after||null,fields:c.changed_fields||[]}));
 return {today,horizon,counts,areas:Object.entries(AREAS).map(([area,a])=>({area,label:a.label,tab:a.tab,group:a.group,counts:counts[area],total:STATES.reduce((n,s)=>n+counts[area][s],0)})),
  pending,pending_total:waiting.length,expiring:expiring.slice(0,25),expiring_total:expiring.length,failing:failing.slice(0,40),failing_total:failing.length,recent:recent.slice(0,15)};
}

// ---- the action bar ------------------------------------------------------------------------------------------------------
// Only real buttons. "Save draft", "Validate" and "Submit for review" are the buttons inside each editor, so the bar opens the editor and says so.
// Approve & Activate is listed for Managers and Partners; the setting's own server still decides who may approve, and the person who prepared a record never can.
const LEADERS=['PARTNER','MANAGER'];
export function actionsFor(rec,role){
 if(!LEADERS.includes(role))return [];
 const A=[],suite=(key,label,action,note='')=>A.push({key,label,kind:'suite',action,id:rec.record_id,note}),svc=(key,label,action,note='')=>A.push({key,label,kind:'svc',action,id:rec.record_id,rev:rec.revision,note});
 const draftish=['Draft','In Review'].includes(rec.state),inForce=['Active','Approved'].includes(rec.state);
 switch(rec.area){
  case 'tax_rate':
   if(rec.native_status==='Draft'){suite('edit','Edit draft','rate-edit');suite('test','Enable for testing','rate-test','Staging only.');}
   if(draftish&&rec.native_status!=='Rejected')suite('legal','Confirm legal basis','rate-legal');
   if(draftish)suite('approve','Approve & Activate','rate-approve','Needs the Engagement Partner, or the Tax Manager who holds the right. Never the person who prepared it.');
   if(inForce||rec.native_status==='Testing')suite('revise','New version','rate-version','An approved rule is never edited. This starts a new draft.');
   suite('view','View rule','rate-view');
   break;
  case 'service_template':
   if(rec.native_status==='Draft')svc('approve','Approve & Activate','approve','Needs the Managing Partner, or a Manager who holds the approval right, who did not propose it.');
   if(rec.native_status!=='Retired')svc('retire','Retire','retire');
   svc('open','Open service templates','templates');
   break;
  case 'export_profile':suite('open','Open export profiles','export-profiles-open','Save, publish, revise and end are inside.');break;
  case 'upload_template':suite('open','Open the template library','template-library-open','Save, publish, revise and retire are inside.');break;
  case 'routing_map':suite('open','Open routing mappings','routing-map-open','Propose, approve, copy and end are inside.');break;
  case 'eligibility':suite('open','Open eligibility','eligibility-open','Record and verify are inside. A Partner verifies.');break;
  default:break;
 }
 return A;
}

// Fields shown on the Configuration tab. Read only: they restate the record; changes go through the editor.
export function configurationFields(rec){
 const x=rec.extra||{},F=[];const add=(l,v)=>{if(v!==null&&v!==undefined&&v!=='')F.push([l,String(v)]);};
 add('Code',rec.code);add('Native status',rec.native_status.replace('_',' '));add('Effective from',rec.effective_from);add('Effective to',rec.effective_to);add('Expires on',rec.expires_on);
 switch(rec.area){
  case 'tax_rate':add('Tax type',x.tax_type);add('Legal review',x.legal_review_status);add('Source recorded',x.has_source?'Yes':'No');add('Rate and base filled in',x.has_figures?'Yes':'No');break;
  case 'export_profile':add('Layout',x.layout_code);add('Layout version',x.template_version);add('Checked against',x.verified_against);add('Checked on',x.verified_on);break;
  case 'upload_template':add('Importer',x.importer_profile);break;
  case 'routing_map':add('Module',x.module);add('Account',x.account_code);add('Side',x.side);break;
  case 'eligibility':add('Kind',x.kind);add('Person',x.person);break;
  default:break;
 }
 return F;
}
// Versions & Approvals: every version of the same setting, newest first, with who approved it.
export function versionsOf(rec,all){
 return all.filter(p=>p.area===rec.area&&p.group_key===rec.group_key).sort((a,b)=>String(b.effective_from||'').localeCompare(String(a.effective_from||''))||Number(b.version||0)-Number(a.version||0)||String(b.record_id).localeCompare(String(a.record_id)))
  .map(p=>({record_id:p.record_id,current:p.record_id===rec.record_id,state:p.state,native_status:p.native_status,version:p.version,effective_from:p.effective_from,effective_to:p.effective_to,prepared_by:p.prepared_by,approver:p.approver,approved_at:p.approved_at}));
}
