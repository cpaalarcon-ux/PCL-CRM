import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('search results and calendar days draw what the server returns',async()=>{
 globalThis.document={addEventListener(){},querySelector:()=>null};
 const {searchGroups,calendarDays}=await import('../staff-tools.mjs');
 const html=searchGroups({clients:[{company_name:'Acme <Ltd>',kra_pin:'A123456789B',record_status:'Existing'}],engagements:[],projects:[{project_id:'p1',project_name:'VAT 2026',company_name:'Acme',service_code:'TAX-VAT',status:'Active'}],tasks:[{task_id:'t1',task_name:'File',company_name:'Acme',project_name:'VAT 2026',status:'Pending',due_at:'2026-11-20T09:00:00.000Z'}],accounts:[{code:'10100',name:'Cash',account_group:'Assets',statement:'SFP',clients_using:1}]},esc);
 assert.match(html,/Acme &lt;Ltd&gt;/);assert.match(html,/data-search-project="p1"/);assert.match(html,/data-task="t1"/);assert.match(html,/in 1 approved client chart(?!s)/);assert.match(html,/due 2026-11-20/);
 assert.match(searchGroups({clients:[],engagements:[],projects:[],tasks:[],accounts:[]},esc),/Nothing matched/);
 const cal=calendarDays([{date:'2026-11-05',items:[{kind:'task',label:'Task due',title:'File',client:'Acme',project_id:'p1',status:'Pending',overdue:true}]},{date:'2026-11-20',items:[{kind:'kra_suggested',label:'Suggested KRA date',title:'VAT',client:'B',status:'Not confirmed on iTax',overdue:false}]}],esc);
 assert.match(cal,/<h3>2026-11-05<\/h3>/);assert.match(cal,/badge bad[^>]*>Task due/);assert.match(cal,/overdue/);assert.match(cal,/Not confirmed on iTax/);assert.match(calendarDays([],esc),/Nothing falls due/);
});
test('the screens are wired to the suite, the page and the server actions',()=>{
 const u=rd('staff-tools.mjs'),s=rd('staff-suite.mjs'),h=rd('staff-pilot.html');
 assert.match(s,/staff-tools\.mjs\?v=20261116-tools-v1/);assert.match(s,/\$\{tools\.card\(\)\}/);assert.match(s,/await tools\.handle\(action,id\)/);
 assert.match(h,/data-suite="tools-search"/);assert.match(h,/data-suite="tools-calendar"/);
 for(const a of ['search_all','calendar_read','payroll_access_log_read','target_measure_read','target_measure_record','target_measure_void'])assert.match(u,new RegExp(a));
 assert.doesNotMatch(u,/<form/,'the modal already wraps its body in a form');assert.doesNotMatch(u,/Math\.(round|ceil)/,'every figure comes from the server');
 assert.match(u,/not a promise/);assert.match(u,/cannot be edited or removed/);
 const a=rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs');assert.match(a,/search_all\$\|calendar_read\$\|payroll_access_\|target_measure_/);
 const i=rd('supabase/functions/staff-workspace-v12/index.ts');for(const n of ['searchCalendarAction','targetMeasureAction','payrollAccessLogAction'])assert.match(i,new RegExp(n+'\\(tx,a,p\\)'));
});
test('every payroll identity or salary read writes a log line',()=>{
 const dir='supabase/functions/staff-workspace-v12/';
 assert.match(rd(dir+'payroll-register-actions.ts'),/surface:'Payroll register'/);assert.match(rd(dir+'payroll-review-actions.ts'),/surface:'Payroll review'/);
 const c=rd(dir+'payroll-confirmation-actions.ts');assert.match(c,/surface:'Client confirmation'/);assert.match(c,/surface:'Confirmation PDF'/);
 assert.match(rd(dir+'period-import-actions.ts'),/surface:'Payroll run'/);assert.match(rd(dir+'statutory-file-actions.ts'),/surface:'Payroll file'/);
});
