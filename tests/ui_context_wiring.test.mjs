// A screen module asks the page for functions through its "ctx" argument (ctx.openClientChart(...)). If whoever creates the
// module does not pass one, the button fails in the browser with "ctx.x is not a function" and no other test notices.
// This reads every screen module (createXxxUI(ctx)) and every place that creates it, follows "...ctx" spreads from parent
// to child, and checks that each function a module uses is supplied.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const files=fs.readdirSync(root).filter(f=>/^staff-[\w-]+\.mjs$/.test(f));
const src=Object.fromEntries(files.map(f=>[f,fs.readFileSync(new URL(f,root),'utf8')]));
const ident=s=>s.trim().split(/[:\s(]/)[0];
// the entries of the object literal that begins at the "{" at index i: plain keys and spread names
function entries(s,i){const keys=[],spreads=[];let depth=0,tok='',q=null,key=true;
 const flush=()=>{const t=tok.trim();if(t.startsWith('...'))spreads.push(t.slice(3).trim());else if(t)keys.push(ident(t));tok='';key=true};
 for(let k=i;k<s.length;k++){const c=s[k];
  if(q){if(c==='\\'){k++;continue}if(c===q)q=null;continue}
  if(c==='"'||c==="'"||c==='`'){q=c;continue}
  if(c==='{'||c==='('||c==='['){depth++;if(depth===1){tok='';key=true}continue}
  if(c==='}'||c===')'||c===']'){if(depth===1)flush();depth--;if(depth===0)break;continue}
  if(depth===1){if(c===',')flush();else if(key)tok+=c;if(c===':')key=false}}
 return {keys,spreads}}
// modules: key "file#createName" -> {arg, used}
const mods={};
// Functions a module takes from its argument, written either ctx.name or const {name,other:renamed}=ctx. A destructured name only
// counts when the module uses it somewhere else in the file (an unused name that is not passed is harmless).
function usedNames(text,arg){const used=new Set([...text.matchAll(new RegExp('\\b'+arg+'\\.([A-Za-z_]\\w*)','g'))].map(x=>x[1]));
 for(const d of text.matchAll(new RegExp('\\b(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*'+arg+'\\b','g'))){
  const rest=text.replace(d[0],'');
  for(const part of d[1].split(',')){const p=part.trim();if(!p||p.startsWith('...'))continue;
   const key=p.split(':')[0].split('=')[0].trim(),local=(p.includes(':')?p.split(':')[1]:p).split('=')[0].trim();
   if(key&&local&&new RegExp('(?<![\\w$.])'+local.replace(/\$/g,'\\$')+'(?![\\w$])').test(rest))used.add(key)}}
 return [...used]}
for(const f of files){for(const m of src[f].matchAll(/export\s+function\s+(create\w+)\s*\((\w+)\)/g)){
 mods[f+'#'+m[1]]={file:f,fn:m[1],arg:m[2],used:usedNames(src[f],m[2])}}}
// which module file a caller's import of createXxx comes from
const importFrom=(caller,fn)=>{const m=src[caller].match(new RegExp('import\\s*\\{[^}]*\\b'+fn+'\\b[^}]*\\}\\s*from\\s*\'\\./([\\w.-]+\\.mjs)'));return m&&m[1]};
// each creation site: {caller, mod, keys, spreads}
const sites=[];
for(const caller of files){for(const m of src[caller].matchAll(/\b(create\w+)\(\{/g)){const f=importFrom(caller,m[1]);const mod=mods[f+'#'+m[1]];if(!mod)continue;
 sites.push({caller,mod,...entries(src[caller],m.index+m[0].length-1)})}}
// the pages create the top-level modules; those are checked from staff-pilot.mjs. Supplied names for a module = names at its site,
// plus (for each ...spread of the caller's own ctx argument) whatever the caller itself is given.
const supplyOf=(key,seen=new Set())=>{if(seen.has(key))return null;seen.add(key);
 const mine=sites.filter(s=>s.mod.file+'#'+s.mod.fn===key);if(!mine.length)return null;
 // the caller module (if the caller is itself a screen module) passes its own ctx through a spread
 const per=mine.map(s=>{const set=new Set(s.keys);for(const sp of s.spreads){const parent=Object.values(mods).find(m=>m.file===s.caller&&m.arg===sp);if(parent){const ps=supplyOf(parent.file+'#'+parent.fn,new Set(seen));if(ps)ps.forEach(x=>set.add(x))}}return set});
 // a name counts only if every creation site supplies it
 return new Set([...per[0]].filter(x=>per.every(p=>p.has(x))))};
test('every screen module is created somewhere with an object argument we can read',()=>{
 assert.ok(sites.length>=30,'found the creation sites ('+sites.length+')');
});
test('whoever creates a screen module supplies every function it uses',()=>{
 const problems=[];
 for(const [key,mod] of Object.entries(mods)){
  const sup=supplyOf(key);if(!sup)continue;
  const miss=mod.used.filter(u=>!sup.has(u));
  if(miss.length)problems.push(mod.file+' ('+mod.fn+') uses '+mod.arg+'.'+miss.join(', '+mod.arg+'.')+' but its creator does not pass it');
 }
 assert.deepEqual(problems,[]);
});
test('the setup guide chart-of-accounts button is connected, and a missing step gives a clear message',()=>{
 assert.match(src['staff-pilot.mjs'],/createSetupGuideUI\(\{[^]*?openClientChart:improvements\.chart[^]*?\}\);/);
 const g=src['staff-setup-guide.mjs'];
 assert.match(g,/if\(a==='chart'\)await ctx\.openClientChart\(id\)/);
 assert.match(g,/This step is not connected in this build/);
});
