// The screen for tax periods waiting for a confirmed KRA due date (build 2773).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const {backlogView,dueStatus,waiting,BACKLOG_NOTE,createDueBacklogUI}=await import('../staff-due-backlog.mjs');
const button=(a,l,i='')=>`<button data-suite="${a}" data-id="${i}">${l}</button>`;
const item=o=>({case_id:'c1',project_id:'p1',client_id:'k1',company_name:'Client <One>',project_name:'KRA Tax',kind:'VAT',filing_class:'VAT',starts_on:'2026-09-01',ends_on:'2026-09-30',suggested_due_date:'2026-10-20',due_status:'MISSING',kra_due_date:null,...o});
test('list: waiting rows have buttons, finished rows do not, text is escaped',()=>{
 const v=backlogView({items:[item(),item({case_id:'c2',kind:'Company',filing_class:'ANNUAL',due_status:'CONFIRMED',kra_due_date:'2026-12-31'}),item({case_id:'c3',due_status:'TASK_DATE_FALLBACK',suggested_due_date:null})],button});
 assert.match(v,/1 of 3 periods waiting/);assert.match(v,/duebacklog-confirm" data-id="c1"/);assert.match(v,/duebacklog-fallback" data-id="c1"/);
 assert.doesNotMatch(v,/duebacklog-confirm" data-id="c2"/);assert.doesNotMatch(v,/duebacklog-confirm" data-id="c3"/);
 assert.match(v,/Client &lt;One&gt;/);assert.doesNotMatch(v,/Client <One>/);assert.match(v,/none suggested/);
 assert.match(v,/Confirmed · 2026-12-31/);assert.match(v,/Task date used on purpose/);
 assert.match(backlogView({items:[],button}),/There are no tax periods yet/);assert.match(BACKLOG_NOTE,/suggestion only/);
 assert.equal(waiting([item(),item({due_status:'CONFIRMED'})]).length,1);assert.equal(dueStatus(item()),'Waiting for a confirmed date');
});
test('handler: opens the list, confirm and fallback send the right requests; card for leaders only',async()=>{
 const sent=[],modals=[];
 const ctx=me=>({field:(n,l,v,t,e)=>`<input name="${n}" value="${v}" ${e||''}>`,form:(b,l)=>b+'['+l+']',modal:(t,b,s,d)=>modals.push({t,b,s,d}),request:async p=>{sent.push(p);return p.action==='due_date_backlog'?{items:[item()]}:{ok:true};},button,area:(n)=>`<textarea name="${n}"></textarea>`,check:(n,l)=>`<input type="checkbox" name="${n}">${l}`,data:()=>({me}),});
 const ui=createDueBacklogUI(ctx({category_code:'PARTNER'}));
 assert.match(ui.card(),/duebacklog-open/);assert.equal(createDueBacklogUI(ctx({category_code:'SUPERVISOR'})).card(),'');
 assert.equal(await ui.handle('other-action','x'),false);
 assert.equal(await ui.handle('duebacklog-open',''),true);assert.equal(sent[0].action,'due_date_backlog');
 await ui.handle('duebacklog-confirm','c1');const m=modals.at(-1);assert.match(m.t,/Confirm the KRA due date/);assert.match(m.b,/value="2026-10-20"/);assert.match(m.b,/iTax calendar/);
 const f=new Map([['kra_due_date','2026-10-20'],['itax_confirmed','on']]);await m.s(f);
 assert.deepEqual(sent.at(-1),{action:'due_date_confirm',project_id:'p1',starts_on:'2026-09-01',ends_on:'2026-09-30',kind:'VAT',kra_due_date:'2026-10-20',itax_confirmed:true});
 await ui.handle('duebacklog-fallback','c1');const m2=modals.at(-1);await m2.s(new Map([['fallback_reason','The KRA calendar is not published']]));
 assert.deepEqual(sent.at(-1),{action:'due_date_fallback',project_id:'p1',starts_on:'2026-09-01',ends_on:'2026-09-30',kind:'VAT',fallback_reason:'The KRA calendar is not published'});
});
test('wiring: screen imported, Settings card, dispatch, server action mapped to the projects area, migration locked down',()=>{
 const su=read('staff-suite.mjs');assert.match(su,/import \{createDueBacklogUI\} from '\.\/staff-due-backlog\.mjs\?v=20261112-resources-v1'/);assert.match(su,/\$\{taxRoles\.card\(\)\}\$\{dueBacklog\.card\(\)\}/);assert.match(su,/if\(await dueBacklog\.handle\(action,id\)\)return/);
 const sv=read('supabase/functions/staff-workspace-v12/due-date-actions.ts');assert.match(sv,/'due_date_backlog'/);assert.match(sv,/Managers and Partners/);
 const mig=read('supabase/migrations/20261110283000_due_date_backlog.sql');assert.match(mig,/SECURITY DEFINER SET search_path TO ''/);assert.match(mig,/REVOKE ALL ON FUNCTION erp_private\.period_due_backlog\(\) FROM PUBLIC,anon,authenticated,service_role/);assert.match(mig,/GRANT EXECUTE ON FUNCTION erp_private\.period_due_backlog\(\) TO erp_api/);
 assert.doesNotMatch(mig,/INSERT INTO|UPDATE erp_private|DELETE FROM/i);
});
