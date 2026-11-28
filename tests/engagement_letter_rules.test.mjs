import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {letterState,summarise,planLink} from '../supabase/functions/staff-workspace-v12/engagement-letter-rules.mjs';
import {lettersHtml,linkHtml,linkDoneHtml} from '../staff-engagement-letters.mjs';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
test('letter state is worked out from the controls and the uploaded file',()=>{
 const T='2026-11-28';
 assert.equal(letterState(null,null,T),'Missing');
 assert.equal(letterState(null,{document_id:'d'},T),'Uploaded, not linked');
 assert.equal(letterState({signed_letter_id:'d',letter_verified_by:null},null,T),'Not verified');
 assert.equal(letterState({signed_letter_id:'d',letter_verified_by:'s',letter_expires_on:'2026-11-27'},null,T),'Expired');
 assert.equal(letterState({signed_letter_id:'d',letter_verified_by:'s',letter_expires_on:'2026-11-28'},null,T),'Verified','an expiry of today is still current, as the activation gate treats it');
 assert.equal(letterState({signed_letter_id:'d',letter_verified_by:'s'},null,T),'Verified');
 assert.equal(summarise([{letter_state:'Missing'},{letter_state:'Missing'}]).Missing,2);
});
test('the uploader does not verify their own letter unless they are the only Partner',()=>{
 const rows=[{letter_state:'Uploaded, not linked',candidate_uploaded_by:'me'},{letter_state:'Uploaded, not linked',candidate_uploaded_by:'you'},{letter_state:'Uploaded, not linked',candidate_uploaded_by:'you',controls_stage:'Finalized'},{letter_state:'Missing'}];
 const p=planLink(rows,{staff_id:'me',sole:false});assert.equal(p.ready.length,1);assert.equal(p.left.length,2);
 assert.equal(planLink(rows,{staff_id:'me',sole:true}).ready.length,2);
});
test('screens escape names and gate the apply behind a note and a tick',()=>{
 const h=lettersHtml({total:1,counts:{},rows:[{company_name:'A <b>',project_name:'P',project_status:'Draft',letter_state:'Missing'}]},{esc});assert.ok(!h.includes('<b>')&&h.includes('&lt;b&gt;'));
 assert.match(linkHtml({ready:2,left:[]},{esc}),/id="letterApply" disabled/);
 assert.match(linkDoneHtml({linked:1,left:[]},{esc}),/Linked and verified/);
 const ui=fs.readFileSync(new URL('../staff-improvements.mjs',import.meta.url),'utf8');
 assert.match(ui,/engagement_letters_list/);assert.match(ui,/engagement_letters_link_ready/);
 assert.match(fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),/data-v3="engagement-letters"/);
});
