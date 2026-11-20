// Two more ways a screen can break in the browser without any test noticing, checked by reading the code:
// 1. the page asks the server for an action the server does not have ("Unknown action"), and
// 2. a file imports a name another file does not export, which stops the whole page loading.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const front=fs.readdirSync(root).filter(f=>/^[\w-]+\.m?js$/.test(f));
const text=f=>fs.readFileSync(new URL(f,root),'utf8');
test('every server action the front end calls exists in the server code',()=>{
 const srvDir='supabase/functions/staff-workspace-v12/';
 const server=fs.readdirSync(new URL(srvDir,root)).filter(f=>/\.(ts|mjs)$/.test(f)).map(f=>text(srvDir+f)).join('\n');
 const known=new Set([...server.matchAll(/['"]([a-z][a-z0-9_]+)['"]/g)].map(m=>m[1]));
 const missing=[];
 for(const f of front)for(const m of text(f).matchAll(/action\s*:\s*['"]([a-z][a-z0-9_]+)['"]/g))if(!known.has(m[1]))missing.push(f+' calls '+m[1]);
 assert.deepEqual(missing,[]);
});
test('every named import in the front-end files is exported by the file it comes from',()=>{
 const exportsOf=f=>{const s=text(f),n=new Set();
  for(const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g))n.add(m[1]);
  for(const m of s.matchAll(/export\s*\{([^}]*)\}/g))for(const p of m[1].split(',')){const t=p.trim();if(t)n.add(t.split(/\s+as\s+/).pop().trim())}
  if(/export\s+default/.test(s))n.add('default');return n};
 const problems=[];let checked=0;
 for(const f of front)for(const m of text(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.-]+\.m?js)(?:\?[^'"]*)?['"]/g)){
  if(!fs.existsSync(new URL(m[2],root))){problems.push(f+' imports a missing file '+m[2]);continue}
  const have=exportsOf(m[2]);
  for(const p of m[1].split(',')){const name=p.trim().split(/\s+as\s+/)[0].trim();if(!name)continue;checked++;if(!have.has(name))problems.push(f+' imports '+name+' but '+m[2]+' does not export it')}}
 assert.ok(checked>150,'checked '+checked+' imports');
 assert.deepEqual(problems,[]);
});
