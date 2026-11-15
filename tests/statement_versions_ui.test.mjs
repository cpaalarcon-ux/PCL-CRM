import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
test('the versions screen draws what the server returns and offers only allowed steps',async()=>{
 globalThis.document={addEventListener(){},querySelector:()=>null};
 const {createStatementVersionsUI}=await import('../staff-statement-versions.mjs');
 let html='';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const data={period:{starts_on:'2026-01-01',ends_on:'2026-12-31'},next_steps:[{kind:'Draft',allowed:true,note:'Prepare a corrected draft.'},{kind:'Audit/Review Adjusted',allowed:false,note:'The draft must be locked first.'},{kind:'Final Signed',allowed:false,note:'Needs the adjusted version first.'}],
  candidates:{audit_files:[],journals:[],kra_cases:[],engagements:[]},
  versions:[{version_id:'v1',kind:'Draft',seq:1,state:'Locked',current:true,stale:false,status:'Locked',as_of:'2026-12-31',prepared_by_name:'A Supervisor',locked_by_name:'A Manager',locked_at:'2027-01-05',snapshot_digest:'abcdef0123456789',basis_note:'Prepared from the ledger.',links:[],changes_from_base:[]},
   {version_id:'v2',kind:'Audit/Review Adjusted',seq:1,state:'Out of date: built on a version that was replaced',current:true,stale:true,status:'Prepared',as_of:'2026-12-31',prepared_by_name:'A Supervisor',snapshot_digest:'1234567890abcdef',basis_note:'After adjustments.',no_adjustments:false,
    links:[{link_id:'l1',link_kind:'KRA notice',notice_reference:'KRA-NOTICE-1',notice_type:'Audit notice',notice_date:'2026-11-01',deadline_date:'2026-12-01',notice_status:'Open'}],changes_from_base:[{statement:'Profit or loss',label:'Revenue',before:1000,after:1250}]}]};
 const ctx={esc,field:(n,l)=>`<input name="${n}">`,select:(n)=>`<select name="${n}"></select>`,form:h=>h,request:async()=>data,notice(){},shortDate:d=>String(d).slice(0,10)};
 const ui=createStatementVersionsUI(ctx,{payload:a=>({action:a}),show:(t,h)=>{html=h;}});await ui.open();
 assert.match(html,/Draft<\/b>: Prepare a corrected draft\. <button[^>]*data-fsver="prepare"[^>]*data-id="Draft"[^>]*>/);
 assert.match(html,/data-id="Audit\/Review Adjusted" disabled/);assert.match(html,/data-id="Final Signed" disabled/);
 assert.match(html,/Out of date: built on a version that was replaced/);assert.match(html,/KRA notice KRA-NOTICE-1: Audit notice, dated 2026-11-01, deadline 2026-12-01, Open/);
 assert.match(html,/1 line differs from the version it was built on/);assert.match(html,/data-fsver="lock" data-id="v2"/);assert.doesNotMatch(html,/data-fsver="lock" data-id="v1"/);
});
test('the screen is wired to the ledger panel and the server actions',()=>{
 const l=rd('staff-ledger.mjs'),u=rd('staff-statement-versions.mjs');
 assert.match(l,/staff-statement-versions\.mjs\?v=20261116-fsver-v1/);assert.match(l,/btn\('fsver','Statement versions'\)/);assert.match(l,/a==='fsver'/);
 for(const a of ['ledger_fsver_read','ledger_fsver_prepare','ledger_fsver_lock','ledger_fsver_link','ledger_fsver_unlink'])assert.match(u,new RegExp(a));
 assert.match(rd('supabase/functions/staff-workspace-v12/ledger-actions.ts'),/isFsverAction\(p\.action\)/);
 assert.doesNotMatch(u,/Math\.(round|ceil)/);
});
