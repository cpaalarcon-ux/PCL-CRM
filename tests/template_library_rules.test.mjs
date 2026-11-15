import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const R=await import('../supabase/functions/staff-workspace-v12/template-library-rules.mjs');
const {libraryRows,createTemplateLibraryUI}=await import('../staff-template-library.mjs');
test('columns are typed one per line and checked: names, required or optional, no repeats, at least one required',()=>{
 const ok=R.columnsFrom('Month | required | Jan 2026\nNet sales | required | 100000\nNotes | optional |\n\n');
 assert.deepEqual(ok.columns.map(c=>[c.name,c.required]),[['Month',true],['Net sales',true],['Notes',false]]);assert.equal(ok.columns[0].example,'Jan 2026');
 assert.equal(R.columnsFrom('Month').columns[0].required,true,'required is the default');
 assert.match(R.columnsFrom('Month | sometimes').problem,/required or optional/);
 assert.match(R.columnsFrom('Month | required\nMONTH | optional').problem,/twice/);
 assert.match(R.columnsFrom('A | optional').problem,/at least one column must be required/i);
 assert.match(R.columnsFrom('').problem,/List the columns/);
 assert.match(R.columnsFrom(Array.from({length:61},(_,i)=>'C'+i)).problem,/at most 60/);
 assert.match(R.columnsFrom(' | required').problem,/name/);
 assert.deepEqual(R.columnsFrom([{name:'A',required:true,example:'x'}]).columns[0],{name:'A',required:true,example:'x'});
});
test('file rules: Excel or CSV only, readable, no more than 2 MB',()=>{
 assert.equal(R.fileProblem({name:'sales.xlsx',base64:'QUJD'}),'');
 assert.match(R.fileProblem({name:'',base64:'QUJD'}),/Choose/);assert.match(R.fileProblem({name:'a.exe',base64:'QUJD'}),/Excel or CSV/);
 assert.match(R.fileProblem({name:'a.csv',base64:'not base64!'}),/could not be read/);assert.match(R.fileProblem({name:'a.csv',base64:'A'.repeat(2800000)}),/2 MB/);
});
test('a version is in force only while published and inside its dates',()=>{
 const t={status:'Published',effective_from:'2026-01-01',effective_to:'2026-12-31'};
 assert.equal(R.inForce(t,'2026-06-01'),true);assert.equal(R.inForce(t,'2025-12-31'),false);assert.equal(R.inForce(t,'2027-01-01'),false);assert.equal(R.inForce({...t,effective_to:null},'2030-01-01'),true);
 assert.equal(R.inForce({...t,status:'Draft'},'2026-06-01'),false);assert.equal(R.inForce({...t,status:'Retired'},'2026-06-01'),false);
 assert.equal(R.versionState({status:'Published',effective_from:'2026-01-01'},'2026-06-01'),'In force');assert.match(R.versionState({status:'Published',effective_from:'2027-01-01'},'2026-06-01'),/starts/);
 assert.equal(R.versionState({status:'Draft'},'2026-06-01'),'Waiting to be published');
});
test('the screen offers publish and revise by role and state, and escapes uploaded text',()=>{
 const t=(x)=>({template_id:'t1',key_label:'Sales',name:'Sales <i>net</i>',version:2,file_name:'s.xlsx',status:'Draft',effective_from:'2026-01-01',required_columns:[{name:'Month',required:true},{name:'Notes',required:false}],created_by:'me',created_by_name:'Asha',revision:'3',used_by:0,...x});
 const mine=libraryRows([t()],{me:'me',leader:true,today:'2026-06-01'}),other=libraryRows([t()],{me:'you',leader:true,today:'2026-06-01'}),staff=libraryRows([t()],{me:'you',leader:false,today:'2026-06-01'});
 assert.match(mine,/data-tl="revise"/);assert.match(mine,/data-tl="publish"[^>]*data-own="1"/);assert.doesNotMatch(other,/data-tl="revise"/);assert.match(other,/data-tl="publish"/);
 assert.doesNotMatch(staff,/data-tl="publish"|data-tl="retire"|data-tl="revise"/);assert.match(staff,/data-tl="download"/);
 assert.match(mine,/Sales &lt;i&gt;net&lt;\/i&gt;/);assert.match(mine,/Notes \(optional\)/);
 const pub=libraryRows([t({status:'Published',published_by_name:'Brian',sole_partner_publish:true,used_by:3})],{me:'you',leader:true,today:'2026-06-01'});
 assert.match(pub,/In force/);assert.match(pub,/only Partner/);assert.match(pub,/used by 3 imports/);assert.doesNotMatch(pub,/data-tl="publish"/);assert.match(pub,/data-tl="retire"/);
 assert.match(libraryRows([t({status:'Retired',retired_reason:'Replaced by version 3'})],{me:'you',leader:true}),/retired: Replaced by version 3/);
});
test('wiring: Settings card, server route, access area, rights in both catalogs, imports stamp the version, tokens',()=>{
 const suite=rd('staff-suite.mjs'),srv='supabase/functions/staff-workspace-v12/';
 assert.match(suite,/staff-template-library\.mjs\?v=20261116-library-v1/);assert.match(suite,/templateLibrary\.card\(\)/);assert.match(suite,/templateLibrary\.handle\(action,id\)/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261116-profiles-v1/);
 assert.match(rd(srv+'index.ts'),/templateLibraryAction\(tx,a,p\)/);assert.match(rd(srv+'staff-access-control.mjs'),/template_library_/);
 for(const f of ['staff-rights-catalog.mjs',srv+'staff-rights-catalog.mjs'])assert.match(rd(f),/templates\.library_publish.*template_library_publish.*template_library_retire/);
 assert.match(rd(srv+'period-import-actions.ts'),/templateInForce\(tx,x\.kind==='Sales'/);assert.match(rd(srv+'bank-totals-actions.ts'),/templateInForce\(tx,'BANK_ANALYSIS'/);
 assert.equal(typeof createTemplateLibraryUI,'function');
});
