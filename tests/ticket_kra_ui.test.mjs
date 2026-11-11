// Support tickets with priority, due dates and a KRA notice link: what the two screens show (build 2774).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ticketsView,dueText,PRIORITIES} from '../staff-client-support.mjs';
import {caseView} from '../staff-kra.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const button=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const t=(o={})=>({ticket_id:'t1',ticket_number:7,subject:'Lift the notice',company_name:'Fictional Co',service_name:'KRA Agency Notice Lifting',is_billable:true,status:'Open',assigned_name:'Sam <S>',opened_at:'2026-11-10T08:00:00Z',fee_amount:null,invoice_id:null,priority:'Medium',response_due_on:'2026-11-13T00:00:00.000Z',resolution_due_on:'2026-11-20T00:00:00.000Z',...o});
test('ticket list: priority, assignment note, due dates, overdue and the KRA notice',()=>{
 const h=ticketsView({tickets:[t({priority:'Urgent',assignment_note:'Call <the> client first',kra_case_id:'k1',kra_reference:'KRA/2026/9',kra_tax_head:'VAT',response_overdue:true}),t({ticket_id:'t2',ticket_number:8,response_due_on:null,resolution_due_on:null})],me:{category_code:'MANAGER'},button});
 assert.match(h,/Urgent priority/);assert.match(h,/Call &lt;the&gt; client first/);assert.doesNotMatch(h,/Call <the>/);
 assert.match(h,/KRA notice KRA\/2026\/9 · VAT/);assert.match(h,/Respond by 2026-11-13 \(overdue\)/);assert.match(h,/Resolve by 2026-11-20/);assert.match(h,/no dates/);
 assert.match(h,/Sam &lt;S&gt;/);assert.doesNotMatch(h,/Medium priority/,'the usual priority is not repeated on every row');
 assert.deepEqual(PRIORITIES,['Low','Medium','High','Urgent']);assert.deepEqual(dueText({}),[]);
});
test('KRA notice view lists the linked support tickets',()=>{
 const c={case_id:'k1',client_name:'Fictional Co',notice_type:'Audit notice',tax_head:'VAT',notice_reference:'KRA/2026/9',period_start:'2025-01-01',period_end:'2025-12-31',notice_date:'2026-11-01',received_on:'2026-11-02',deadline_date:'2026-12-01',days_left:20,status:'Open',summary:'S'};
 const withT=caseView({r:{case:c,flags:[],requests:[],tickets:[{ticket_id:'t1',ticket_number:7,service_name:'KRA Agency Notice Lifting',status:'In progress',priority:'High',assigned_name:'Sam <S>',response_due_on:'2026-11-13',resolution_due_on:'2026-11-20'}]},me:{category_code:'MANAGER'},button});
 assert.match(withT,/Client support tickets linked to this notice \(1\)/);assert.match(withT,/CST-7/);assert.match(withT,/High priority/);assert.match(withT,/Sam &lt;S&gt;/);assert.match(withT,/Respond by 2026-11-13/);
 assert.match(caseView({r:{case:c,flags:[],requests:[],tickets:[]},me:{category_code:'MANAGER'},button}),/No client support ticket is linked to this notice/);
 assert.match(caseView({r:{case:c,flags:[],requests:[]},me:{category_code:'MANAGER'},button}),/\(0\)/,'an older response without tickets still draws');
});
test('wiring: the new action is a communications action, the form asks for the dates, the busters moved',()=>{
 assert.equal(areaForStaffAction('client_support_kra_cases'),'communications');
 const ui=read('staff-client-support.mjs');for(const k of ['response_due_on','resolution_due_on','kra_case_id','client_support_kra_cases','assignment_note','priority'])assert.match(ui,new RegExp(k));
 assert.match(ui,/Response due date \*/);assert.match(ui,/Resolution due date \*/);assert.match(ui,/Related KRA notice \(optional\)/);
 const su=read('staff-suite.mjs');assert.match(su,/staff-client-support\.mjs\?v=20261111-physfile-v1/);assert.match(su,/staff-kra\.mjs\?v=20261111-ticketkra-v1/);
 const sv=read('supabase/functions/staff-workspace-v12/client-support-actions.ts');assert.match(sv,/client_support_kra_cases/);assert.match(sv,/firm_id=\$\{firm\} and deleted_at is null/,'the firm link is read from the right column');
 const mig=read('supabase/migrations/20261111000000_ticket_kra_link.sql');assert.match(mig,/FOREIGN KEY\(kra_case_id,client_id\)/);assert.match(mig,/still open or responded/);
});
