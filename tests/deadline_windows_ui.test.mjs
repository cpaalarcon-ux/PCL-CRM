// Filing deadline windows: the Settings screen, the card badges and status, and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {matrixView,createDeadlineUI,CLASSES,DEADLINE_NOTE,settingStatus,daysText} from '../staff-deadlines.mjs';
import {alertBadges,cardStatus,clientProgress,clientCard} from '../staff-client-cards.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=v=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const button=(a,l,id='')=>`<button data-action="${a}" data-id="${id}">${l}</button>`;
const S=(key,v,status='Suggested',extra={})=>({setting_key:key,label:key,int_value:v,rule_status:status,source_note:null,confirmed_at:null,revision:1,...extra});
const ALL=[S('paye_warn_days',3),S('paye_late_days',3),S('vat_warn_days',5),S('vat_late_days',3),S('annual_warn_days',14),S('annual_late_days',3)];

test('matrix: three kinds of filing, the Partner values, default wording until a Partner confirms',()=>{
 assert.deepEqual(CLASSES.map(c=>c[0]),['paye','vat','annual']);
 const h=matrixView({settings:ALL,partner:true,button});
 assert.match(h,/PAYE and payroll<\/b><br><small>due the 9th/);assert.match(h,/VAT and monthly<\/b><br><small>due the 20th/);assert.match(h,/Annual<\/b><br><small>due 30 June or April/);
 for(const d of ['3 days','5 days','14 days'])assert.match(h,new RegExp('<b>'+d+'</b>'));
 assert.equal((h.match(/class="warn">Default - not yet confirmed/g)||[]).length,6);
 assert.equal((h.match(/deadline-setting-set/g)||[]).length,6);assert.equal((h.match(/deadline-setting-confirm/g)||[]).length,6);
 assert.match(DEADLINE_NOTE,/never block anyone from filing/);assert.doesNotMatch(h+DEADLINE_NOTE,/ISRS\s*4000/);
 const m=matrixView({settings:ALL,partner:false,button});assert.doesNotMatch(m,/deadline-setting-/,'a Manager only reads');
 const c=matrixView({settings:[S('paye_warn_days',3,'Confirmed',{confirmed_at:'2026-11-11T09:00:00Z',source_note:'Partner minute of 11 Nov'})],partner:true,button});
 assert.match(c,/Confirmed on 2026-11-11/);assert.match(c,/Partner minute of 11 Nov/);assert.doesNotMatch(c,/deadline-setting-confirm/,'a confirmed value offers no second confirmation');
 assert.equal(settingStatus(S('x',1)),'Default - not yet confirmed');assert.equal(daysText(1),'1 day');assert.equal(daysText(14),'14 days');
});

test('handler: read, change and confirm send the right requests; Settings card for leaders only',async()=>{
 const sent=[];let shown='',submit=null,after=null;let me={category_code:'PARTNER'};
 const ui=createDeadlineUI({field:(n,l,v)=>`${n}=${v}`,form:(b)=>b,modal:(t,h,s,a)=>{shown=t+' '+h;submit=s;after=a;},request:async p=>{sent.push(p);return p.action==='deadline_settings_read'?{settings:ALL}:{ok:true};},button,area:(n)=>n,data:()=>({me})});
 assert.equal(await ui.handle('kra-open'),false);
 assert.equal(await ui.handle('deadline-settings'),true);assert.deepEqual(sent[0],{action:'deadline_settings_read'});assert.match(shown,/Filing deadline windows/);
 await ui.handle('deadline-setting-set','vat_warn_days');await submit(new Map([['value','6']]));
 assert.deepEqual(sent.at(-1),{action:'deadline_setting_set',setting_key:'vat_warn_days',revision:1,value:'6'});
 await ui.handle('deadline-setting-confirm','vat_warn_days');await submit(new Map([['source_note','Partner minute of 11 Nov 2026']]));
 assert.deepEqual(sent.at(-1),{action:'deadline_setting_confirm',setting_key:'vat_warn_days',revision:1,source_note:'Partner minute of 11 Nov 2026'});
 assert.match(ui.card(),/Filing deadline windows/);assert.match(ui.card(),/Nothing is blocked/);
 me={category_code:'MANAGER'};assert.match(ui.card(),/deadline-settings/);
 for(const c of ['SUPERVISOR','ASSISTANT','INTERN','ADMIN']){me={category_code:c};assert.equal(ui.card(),'',c+' has no card');}
});

test('card: filing badges, status and wording',()=>{
 const f={filing_soon:1,filing_soon_days:3,filing_late:0,filing_late_days:null};
 assert.match(alertBadges(f,esc,'c1'),/class="cc-alert amber" data-client-open="c1" data-client-tab="projects"><span aria-hidden="true">⏳<\/span> Filing due in 3 days</);
 assert.match(alertBadges({...f,filing_soon_days:1},esc,'c1'),/Filing due in 1 day</);assert.match(alertBadges({...f,filing_soon_days:0},esc,'c1'),/Filing due today</);
 assert.match(alertBadges({...f,filing_soon:3},esc,'c1'),/\(\+2 more\)/);
 const late=alertBadges({filing_late:2,filing_late_days:4,filing_soon:0},esc,'c1');
 assert.match(late,/class="cc-alert red" data-client-open="c1" data-client-tab="projects"><span aria-hidden="true">🚨<\/span> Filing overdue: 4 days \(\+1 more\)</);
 assert.match(alertBadges({filing_late:1,filing_late_days:1},esc,'c1'),/Filing overdue: 1 day</);
 assert.equal(alertBadges({filing_soon:0,filing_late:0},esc,'c1'),'');
 const p=clientProgress({client:{client_id:'c1'},missing:[],compliance:{verified_at:'2026-11-01'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness:{activity_count:1,stock_method_count:1,category_count:1,approved_account_count:20},stagedTB:false});
 assert.notEqual(cardStatus(p,{flags:{filing_soon:2,filing_soon_days:1}}).key,'action','due soon alone does not turn the card red');
 const red=cardStatus(p,{flags:{filing_late:1,filing_late_days:2}});assert.equal(red.key,'action');assert.match(red.reasons.join(),/A filing is past the due date/);
 assert.match(cardStatus(p,{flags:{filing_late:3,filing_late_days:2}}).reasons.join(),/3 filings are past the due date/);
});

test('wiring: server action, area, suite, Settings and the nightly job',()=>{
 const ts=rd('supabase/functions/staff-workspace-v12/deadline-actions.ts'),idx=rd('supabase/functions/staff-workspace-v12/index.ts'),su=rd('staff-suite.mjs'),mig=rd('supabase/migrations/20261110270000_filing_deadline_windows.sql');
 for(const a of ['deadline_settings_read','deadline_setting_set','deadline_setting_confirm'])assert.equal(areaForStaffAction(a),'settings',a);
 assert.match(ts,/Filing windows are shown to Managers and Partners/);assert.match(ts,/Only a Partner can change a filing window/);assert.match(ts,/Only a Partner can confirm a filing window/);
 assert.match(idx,/import \{deadlineAction\} from '\.\/deadline-actions\.ts'/);assert.match(idx,/const deadline=await deadlineAction\(tx,a,p\);if\(deadline!==undefined\)return deadline;/);
 assert.match(su,/import \{createDeadlineUI\} from '\.\/staff-deadlines\.mjs\?v=/);assert.match(su,/if\(await deadlines\.handle\(action,id\)\)return;/);assert.match(su,/\$\{deadlines\.card\(\)\}\$\{taxRoles\.card\(\)\}\$\{dueBacklog\.card\(\)\}\$\{taxConfig\.rates\(\)\}/);
 assert.match(mig,/SELECT cron\.schedule\('pcl-filing-late-scan'/);assert.match(mig,/REVOKE ALL ON FUNCTION erp_private\.filing_late_scan\(\) FROM PUBLIC,anon,authenticated,service_role,erp_api/);
 assert.doesNotMatch(mig+ts+rd('staff-deadlines.mjs'),/ISRS\s*4000/);
 assert.doesNotMatch(mig,/INSERT INTO erp_private\.tax_rates|tax_rules/,'no tax rate or rule is stored');
 assert.match(mig,/'Default from the Partner''s written instruction of 10 Nov 2026\. A Partner records the confirmation\.'/,'seeded as Suggested; the build never records a confirmation');
});
