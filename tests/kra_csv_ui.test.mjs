import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const U=await import('../staff-kra-csv.mjs');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const button=(a,l,id='',extra='')=>`<button data-period-action="${a}" data-id="${id}" ${extra}>${l}</button>`;
test('the KRA CSV screens are wired into the period imports panel with the cache chain bumped',()=>{
 assert.match(rd('staff-period-imports.mjs'),/staff-kra-csv\.mjs\?v=20261116-choices-v1/);assert.match(rd('staff-period-imports.mjs'),/button\('kra-csv','KRA VAT CSVs'\)/);assert.match(rd('staff-period-imports.mjs'),/kraCsv\.isAction\(action\)/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-period-imports\.mjs\?v=20261116-choices-v1/);assert.match(rd('staff-pilot.mjs'),/staff-workspace-v6\.mjs\?v=20261116-choices-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/kra_csv_/);assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/kraCsvAction/);
});
test('the sections table says not uploaded rather than zero and offers a new version for a retained file',()=>{
 const html=U.sectionsTable({sections:[{section:'B',label:'Section B · 16% sales',current:{version:2,file_name:'SEC_B.CSV',line_count:3,totals:{net:3000,vat:480},uploaded_by:'A',uploaded_at:'2026-11-01',batch_id:'b1'}},{section:'C',label:'Section C · 8% sales',current:null}]},esc,button);
 assert.match(html,/v2 · SEC_B\.CSV/);assert.match(html,/Upload new version/);assert.match(html,/Original/);assert.match(html,/Not uploaded/);assert.match(html,/data-id="C"/);
});
test('the sales panel shows each category with its result and a note that an absent section is not zero',()=>{
 const html=U.salesPanel({status:'Incomplete',register_imports:1,categories:[{category:'16%',status:'Differs',uploaded:true,csv_net:3150,register_net:3000,register_present:true,difference_net:150,csv_vat:0,register_vat:0,difference_vat:0},{category:'8%',status:'CSV not uploaded',uploaded:false,register_present:true,register_net:0,register_vat:0}]},esc);
 assert.match(html,/Differs/);assert.match(html,/CSV not uploaded/);assert.match(html,/never as zero/);assert.match(html,/150\.00/);
});
test('differences list a review button until cleared and show the decision, reviewer and reason',()=>{
 const x={open:1,cleared:1,differences:[{kind:'Net amount differs',invoice:'0002',party:'S',party_pin:'P2',csv_net:550,register_net:500,review:null,cleared:false},{kind:'Classification missing on the supplier invoice',invoice:'0003',review:{disposition:'Explained',reviewed_by:'M',reviewed_at:'2026-11-02',reason:'Confirmed 16%'},cleared:true}]};
 const html=U.differencesPanel('Purchases','Purchase differences',x,esc,button,2);
 assert.equal((html.match(/data-period-action="kra-review"/g)||[]).length,1);assert.match(html,/Open/);assert.match(html,/Explained/);assert.match(html,/Confirmed 16%/);assert.match(html,/data-side="Purchases"/);
 assert.equal(U.differencesPanel('Sales','t',{status:'No CSV uploaded',differences:[]},esc,button,0),'');
});
test('changes since the earlier file are listed with the reason',()=>{
 const html=U.changesPanel({B:{from_version:1,to_version:2,added_count:1,removed_count:0,changed_count:1,unchanged:1,reason:'KRA re-issued'}},esc);assert.match(html,/version 1 → 2/);assert.match(html,/KRA re-issued/);assert.equal(U.changesPanel({},esc),'');
});
