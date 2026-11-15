import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('Continue Setup and the rollover draw what the server returns',async()=>{
 globalThis.document={addEventListener(){},querySelector:()=>null};
 const {candidateCard,checksTable,rolloverView}=await import('../staff-rollover.mjs');
 const c={client_id:'c1',company_name:'Acme <Ltd>',kra_pin:'A123456789B',record_status:'Existing',done:2,total:5,next_step:{step:'Open the accounting year',detail:'No accounting year has been opened.'},project_access:{projects:1,people:2},engagement_setups:1,periods:0,checks:[{key:'profile',label:'Client profile approved',ok:true,detail:'All approved.'},{key:'year',label:'Accounting year opened',ok:false,detail:'None.'}]};
 const card=candidateCard(c,esc,{canRoll:true});assert.match(card,/Acme &lt;Ltd&gt;/);assert.match(card,/<b>2 of 5<\/b>/);assert.match(card,/Next: <b>Open the accounting year<\/b>/);assert.match(card,/1 project assigned to 2 people/);assert.match(card,/data-roll="rollover"/);assert.doesNotMatch(candidateCard(c,esc),/data-roll="rollover"/);
 assert.match(checksTable(c,esc),/badge good">Done[\s\S]*badge warn">To do/);
 const r={client:{company_name:'Acme'},can_start:true,me:'m1',readiness:c,preview:{source_period_id:'p1',next:{starts_on:'2027-01-01',ends_on:'2027-12-31'},changes:[{kind:'carried',text:'Chart copied.'}],warnings:['The source year is still open.'],blockers:[]},rollovers:[{rollover_id:'r1',status:'Draft',new_starts_on:'2027-01-01',new_ends_on:'2027-12-31',new_chart_status:'Draft',new_mapping_ids:['a','b'],created_by:'m1',created_by_name:'Mary',created_at:'2026-11-15T10:00:00Z',revision:'1'}]};
 const v=rolloverView(r,esc);assert.match(v,/Chart copied\./);assert.match(v,/still open/);assert.match(v,/data-roll="create" data-id="p1" >/);assert.match(v,/data-roll="review"[^>]*data-own="1"/);assert.match(v,/2 mappings/);
 assert.match(rolloverView({...r,preview:{...r.preview,blockers:['Already draft.']}},esc),/data-roll="create"[^>]*disabled/);
 assert.match(rolloverView({...r,preview:null,rollovers:[]},esc),/needs an accounting year/);
});
test('the screens are wired to the suite, the page and the server',()=>{
 const u=rd('staff-rollover.mjs'),s=rd('staff-suite.mjs'),h=rd('staff-pilot.html'),i=rd('supabase/functions/staff-workspace-v12/index.ts');
 assert.match(s,/staff-rollover\.mjs\?v=20261116-roll-v1/);assert.match(s,/await rollover\.handle\(action,id\)/);assert.match(h,/data-suite="roll-continue"/);
 for(const a of ['client_setup_continue_read','client_year_rollover_read','client_year_rollover_create','client_year_rollover_review','client_year_rollover_withdraw'])assert.match(u,new RegExp(a));
 assert.match(i,/clientYearRolloverAction\(tx,a,p\)/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/client_year_rollover_/);
 assert.doesNotMatch(u,/<form/);assert.doesNotMatch(u,/Math\.(round|ceil)/);
});
