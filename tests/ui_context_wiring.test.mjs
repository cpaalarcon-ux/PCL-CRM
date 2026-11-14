// A screen module asks the main page for functions through its "ctx" argument. If the main page does not pass one,
// the button fails in the browser with "ctx.x is not a function" and no other test notices. This reads each module
// and the call in staff-pilot.mjs that creates it, and checks every function the module uses is supplied.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const pilot=rd('staff-pilot.mjs');
// top-level keys of the object literal that starts at index i (the "{")
function keysOf(src,i){const keys=[];let depth=0,tok='',q=null,expectKey=true;
 for(let k=i;k<src.length;k++){const c=src[k];
  if(q){if(c==='\\'){k++;continue}if(c===q)q=null;continue}
  if(c==='"'||c==="'"||c==='`'){q=c;continue}
  if(c==='{'||c==='('||c==='['){depth++;if(depth===1){tok='';expectKey=true}continue}
  if(c==='}'||c===')'||c===']'){if(depth===1&&tok.trim())keys.push(tok.trim().split(/[:\s(]/)[0]);depth--;if(depth===0)break;continue}
  if(depth===1){if(c===','){if(tok.trim())keys.push(tok.trim().split(/[:\s(]/)[0]);tok='';expectKey=true}else if(expectKey)tok+=c;if(c===':')expectKey=false}}
 return keys.filter(Boolean)}
const imports=[...pilot.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+\.mjs)[^']*'/g)].flatMap(m=>m[1].split(',').map(x=>x.trim()).filter(x=>/^create\w+UI$/.test(x)).map(fn=>({fn,file:m[2]})));
test('the main page supplies every function each screen module uses',()=>{
 assert.ok(imports.length>=8,'found the screen modules');
 const problems=[];
 for(const {fn,file} of imports){
  const callAt=pilot.search(new RegExp('\\b'+fn+'\\(\\{'));if(callAt<0)continue;
  const supplied=new Set(keysOf(pilot,pilot.indexOf('{',callAt)));
  const src=rd(file);const arg=(src.match(new RegExp('function\\s+'+fn+'\\s*\\((\\w+)\\)'))||[])[1];if(!arg)continue;
  const used=[...new Set([...src.matchAll(new RegExp('\\b'+arg+'\\.([A-Za-z_]\\w*)','g'))].map(m=>m[1]))];
  for(const u of used)if(!supplied.has(u))problems.push(file+' uses '+arg+'.'+u+' but staff-pilot.mjs does not pass it to '+fn);
 }
 assert.deepEqual(problems,[]);
});
test('the setup guide chart-of-accounts button is connected, and a missing step gives a clear message',()=>{
 assert.match(pilot,/createSetupGuideUI\(\{[^]*?openClientChart:improvements\.chart[^]*?\}\);/);
 const g=rd('staff-setup-guide.mjs');
 assert.match(g,/if\(a==='chart'\)await ctx\.openClientChart\(id\)/);
 assert.match(g,/This step is not connected in this build/);
});
