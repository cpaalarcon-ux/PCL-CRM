// Client support services screen (build 2750): what each person sees, billing text, and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ticketsView,servicesView,ticketActions,WORKING_STATUSES,BILLING_TEXT,CLOSE_NOTE} from '../staff-client-support.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {STAFF_RIGHTS} from '../staff-rights-catalog.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const button=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const t=(o={})=>({ticket_id:'t1',ticket_number:7,subject:'Lift the <b>notice</b>',company_name:'Fictional Co',service_name:'KRA Agency Notice Lifting',is_billable:true,status:'Open',assigned_name:'Sam',opened_at:'2026-11-10T08:00:00Z',fee_amount:null,invoice_id:null,...o});

test('actions follow the ticket state and the role',()=>{
 assert.deepEqual(ticketActions(t(),{category_code:'MANAGER'}),['csup-edit','csup-close','csup-cancel']);
 assert.deepEqual(ticketActions(t({status:'Closed'}),{category_code:'MANAGER'}),[]);
 assert.deepEqual(ticketActions(t({status:'Cancelled'}),{category_code:'PARTNER'}),[]);
 for(const c of ['INTERN','ADMIN'])assert.deepEqual(ticketActions(t(),{category_code:c}),[]);
 assert.deepEqual(WORKING_STATUSES,['Open','In progress','Waiting on client','Work done']);
});
test('ticket list: text is escaped and billing is explained per ticket',()=>{
 const me={category_code:'MANAGER'};
 const h=ticketsView({tickets:[t(),t({ticket_id:'t2',ticket_number:8,status:'Closed',invoice_id:'i1',invoice_number:null,fee_amount:'5000.00',resolution:'Notice lifted on iTax.'}),t({ticket_id:'t3',ticket_number:9,is_billable:false,service_name:'General Queries'}),t({ticket_id:'t4',ticket_number:10,status:'Cancelled',resolution:'Client withdrew.'})],me,button});
 assert.match(h,/Lift the &lt;b&gt;notice&lt;\/b&gt;/);assert.doesNotMatch(h,/<b>notice<\/b>/);
 assert.match(h,/Billable: invoice when closed/);assert.match(h,/Draft invoice created/);assert.match(h,/Not billable/);assert.match(h,/Cancelled: no invoice/);
 assert.match(h,/data-id="t1"/);assert.doesNotMatch(h,/csup-close" data-id="t2"/,'a closed ticket has no buttons');
 assert.match(ticketsView({tickets:[],me,button}),/No client support tickets yet/);
});
test('services panel: only a Partner sees the change button; the Partner\'s billing split is shown',()=>{
 const services=[{service_code:'KRA_NOTICE_LIFTING',service_name:'KRA Agency Notice Lifting',is_billable:true,is_active:true,source_note:'Billable, by the Partner\'s written instruction of 10 Nov 2026 17:46.'},{service_code:'GENERAL_QUERY',service_name:'General Queries',is_billable:false,is_active:false,source_note:'Not billable.'}];
 const p=servicesView({services,me:{category_code:'PARTNER'},button}),m=servicesView({services,me:{category_code:'MANAGER'},button});
 assert.match(p,/csup-service/);assert.doesNotMatch(m,/csup-service/);assert.match(m,/Only a Partner can change it/);
 assert.match(p,/Switched off/);assert.equal(BILLING_TEXT.true.startsWith('Billable'),true);assert.match(CLOSE_NOTE,/draft invoice/);assert.match(CLOSE_NOTE,/16%/);
});
test('wiring: Communications tab, suite dispatch, server action, rights, area',()=>{
 const su=read('staff-suite.mjs'),server=read('supabase/functions/staff-workspace-v12/client-support-actions.ts'),index=read('supabase/functions/staff-workspace-v12/index.ts');
 assert.match(su,/createClientSupportUI/);assert.match(su,/clientSupport\.handle\(action,id\)/);assert.match(su,/'Client services'/);assert.match(su,/clientSupport\.view\(\)/);
 assert.match(index,/clientSupportAction/);
 assert.match(server,/invoiceLines/);assert.match(server,/status='Closed'/);
 assert.doesNotMatch(server,/erp_private\.support_tickets|ticket_replies/,'the staff help desk is not touched');
 assert.doesNotMatch(read('staff-client-support.mjs')+server,/ISRS\s*4000/);
 assert.equal(areaForStaffAction('client_support_open'),'communications');assert.equal(areaForStaffAction('ticket_add'),'communications');
 const codes=Object.fromEntries(STAFF_RIGHTS.map(r=>[r.code,r]));
 assert.deepEqual(codes['clientsupport.billing_flags'].roles,['PARTNER']);assert.ok(codes['clientsupport.work'].actions.includes('client_support_close'));
 assert.equal(read('staff-rights-catalog.mjs'),read('supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs'));
 // the invoice is created in the close action only
 const inserts=server.match(/insert into erp_private\.invoices/g)||[];assert.equal(inserts.length,1);
 const closeAt=server.indexOf('// client_support_close');assert.ok(server.indexOf('insert into erp_private.invoices')>closeAt,'the invoice insert sits after the close handler starts');
});
