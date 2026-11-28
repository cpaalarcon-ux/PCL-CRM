import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {stageOf,summarise,STAGES} from '../supabase/functions/staff-workspace-v12/onboarding-run-rules.mjs';
import {runHtml} from '../staff-onboarding-run.mjs';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ok={identity:'Approved',registration:'Approved',ownership:'Approved',contacts:'Approved'};
const base={sections:ok,chart:'Approved',kyc_verified:true,drafts:[{letter_ok:true}],active:0,opening_required:false,opening_posted:false};
test('each client is placed at the first step it has not finished',()=>{
 assert.equal(stageOf({sections:{}}),'SEND');
 assert.equal(stageOf({sections:{...ok,contacts:'Correction Required'}}),'SEND');
 assert.equal(stageOf({sections:{...ok,contacts:'Pending Review'}}),'APPROVE_SETUP');
 assert.equal(stageOf({...base,chart:null}),'CHART_PREPARE');
 assert.equal(stageOf({...base,chart:'Draft'}),'CHART_APPROVE');
 assert.equal(stageOf({...base,kyc_verified:false}),'KYC');
 assert.equal(stageOf({...base,drafts:[]}),'NO_ENGAGEMENT');
 assert.equal(stageOf({...base,drafts:[{letter_ok:true},{letter_ok:false}]}),'LETTER');
 assert.equal(stageOf({...base,opening_required:true}),'OPENING');
 assert.equal(stageOf({...base,opening_required:true,opening_posted:true}),'ACTIVATE');
 assert.equal(stageOf(base),'ACTIVATE');
 assert.equal(stageOf({sections:{},drafts:[],active:2}),'DONE','a client with an active engagement and no draft one is finished');
 assert.equal(stageOf({sections:{},drafts:[{letter_ok:false}],active:1}),'SEND','a client with a new draft engagement goes through the steps again');
});
test('every stage has a label and the buttons only open existing screens',()=>{
 const known=['setup-bulk','setup-approve-ready','bulk-setup','engagement-letters',''];
 for(const s of STAGES){assert.ok(s.label&&s.help);assert.ok(known.includes(s.action),s.key);}
 assert.equal(summarise([{stage:'KYC'},{stage:'KYC'}]).KYC,2);
});
test('the screen escapes names, offers a button only where there is work, and is wired in',()=>{
 const r={total:2,counts:{KYC:1,ACTIVATE:1},stages:STAGES,rows:[{company_name:'A <b>',stage:'KYC'},{company_name:'B',stage:'ACTIVATE'}]};
 const h=runHtml(r,{esc});assert.ok(!h.includes('A <b>')&&h.includes('A &lt;b&gt;'));
 assert.match(h,/data-run-op="KYC_VERIFY"/);assert.match(h,/data-run-op="ENGAGEMENT_ACTIVATE"/);assert.ok(!/data-run-op="ENGAGEMENT"/.test(h),'no button for a step with nobody waiting');
 const ui=fs.readFileSync(new URL('../staff-improvements.mjs',import.meta.url),'utf8');assert.match(ui,/client_setup_onboarding_run/);
 assert.match(fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),/data-v3="onboarding-run"/);
 assert.match(fs.readFileSync(new URL('../staff-bulk-setup.mjs',import.meta.url),'utf8'),/open\(preset=''\)/);
});
