import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('the system is called PCL Nexus and uses the whole logo image, uncropped',()=>{
 const html=read('staff-pilot.html');
 assert.match(html,/<title>PCL Nexus · Staff workspace<\/title>/);
 assert.match(html,/class="brand-logo" src="assets\/pcl-nexus-full\.webp"[^>]*alt="PCL Nexus"/);
 assert.match(html,/class="login-logo" src="assets\/pcl-nexus-full\.webp"/);
 assert.match(html,/<strong>PCL Nexus<\/strong>/,'the sidebar shows the name beside the square icon');
 assert.doesNotMatch(html,/pcl-logo\.webp|PCL Practice Management System/);
 for(const f of ['assets/pcl-nexus-full.webp','assets/pcl-nexus-icon-128.png','assets/pcl-nexus-favicon.png'])assert.ok(fs.statSync(path.join(root,f)).size>1000,f+' exists');
 const w=fs.readFileSync(path.join(root,'assets/pcl-nexus-full.webp'));
 assert.equal(w.toString('ascii',8,12),'WEBP');
 const png=fs.readFileSync(path.join(root,'assets/pcl-nexus-icon-128.png'));assert.equal(png.readUInt32BE(16),128);assert.equal(png.readUInt32BE(20),128);
});
test('the old product name no longer appears in the app, the PDFs or the export pack',()=>{
 const files=execSync('git ls-files',{cwd:root,encoding:'utf8'}).split('\n').filter(f=>/\.(html|mjs|js|ts|css|json|md)$/.test(f)&&!f.startsWith('tests/')&&!f.startsWith('supabase/migrations/')&&f!=='CHANGELOG.md');
 const bad=files.filter(f=>/PCL Practice Management System/.test(read(f)));
 assert.deepEqual(bad,[]);
 assert.match(read('supabase/functions/staff-workspace-v12/invoice-pdf.mjs'),/PCL Nexus/);
 assert.match(read('supabase/functions/staff-workspace-v12/letter-pdf.mjs'),/PCL Nexus/);
});
