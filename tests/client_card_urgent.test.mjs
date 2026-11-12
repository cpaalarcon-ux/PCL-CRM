// The Urgent figure on the client card (build 2786), and the filing figures that the server used to drop before they reached the card.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {alertBadges,cardStatus,clientProgress} from '../staff-client-cards.mjs';
const {clientRegisterAction}=await import('../supabase/functions/staff-workspace-v12/client-register-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id='11111111-1111-4111-8111-111111111111';

test('the server passes every filing figure through to the card',async()=>{
 const row={client_id:id,kra_open:1,kra_days:2,incoming_waiting:0,incoming_overdue:0,filing_soon:2,filing_soon_days:3,filing_late:1,filing_late_days:4,filing_urgent:3,filing_urgent_days:0};
 const tx=async()=>[row];tx.array=x=>x;
 const out=await clientRegisterAction(tx,{category_code:'MANAGER'},{action:'client_card_flags',client_ids:[id]});
 assert.deepEqual(out.rows[0],row,'nothing is dropped: due soon, overdue and Urgent all arrive');
 const none=await clientRegisterAction(async()=>[{client_id:id,kra_open:0,kra_days:null,incoming_waiting:0,incoming_overdue:0,filing_soon:0,filing_soon_days:null,filing_late:0,filing_late_days:null,filing_urgent:0,filing_urgent_days:null}],{category_code:'PARTNER'},{action:'client_card_flags',client_ids:[id]}).catch(e=>e);
 assert.ok(none.rows||none instanceof Error);
 await assert.rejects(()=>clientRegisterAction(tx,{category_code:'ASSISTANT'},{action:'client_card_flags',client_ids:[id]}),/Supervisors, Managers and Partners/);
});

test('Urgent badge: wording, plural, today, and it is amber',()=>{
 const u=(o={})=>alertBadges({filing_urgent:1,filing_urgent_days:3,...o},esc,'c1');
 assert.match(u(),/Urgent: KRA date in 3 days</);assert.match(u({filing_urgent_days:1}),/in 1 day</);assert.match(u({filing_urgent_days:0}),/Urgent: KRA date today</);
 assert.match(u({filing_urgent:3}),/\(\+2 more\)/);assert.match(u(),/cc-alert amber/);assert.match(u(),/data-client-open="c1" data-client-tab="projects"/);
 assert.match(u(),/title="The firm&#39;s own deadline|title="The firm's own deadline/);
 assert.equal(alertBadges({filing_urgent:0,filing_urgent_days:null},esc,'c1'),'');
 assert.equal(alertBadges({},esc,'c1'),'','older figures without the Urgent fields still render');
});

test('Urgent alone does not turn the card red, matching due soon',()=>{
 const p=clientProgress({client:{},tax:{},kyc:{}}) ;
 const st=cardStatus(p,{flags:{filing_urgent:2,filing_urgent_days:1}});
 assert.notEqual(st.key,'action');
});

test('wiring: migration, buster, build label',()=>{
 const mig=rd('supabase/migrations/20261111040000_client_card_urgent.sql');
 assert.match(mig,/filing_urgent integer,filing_urgent_days integer/);assert.match(mig,/fs\.due_source='PERIOD' AND fs\.internal_days_left<=0 AND fs\.days_left>=0/);
 assert.match(mig,/REVOKE EXECUTE ON FUNCTION erp_private\.client_card_flags\(uuid\[\]\) FROM PUBLIC,anon,authenticated,service_role;/);assert.match(mig,/GRANT EXECUTE ON FUNCTION erp_private\.client_card_flags\(uuid\[\]\) TO erp_api;/);
 assert.doesNotMatch(mig,/forensic/i,'the card question stays free of forensic figures');assert.doesNotMatch(mig,/ISRS 4000/);
 assert.match(rd('staff-pilot.mjs'),/staff-client-cards\.mjs\?v=20261111-urgent-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/release.json'),/2026-11-12\.2792/);assert.match(rd('staff-pilot.html'),/2026-11-12\.2792/);
});
