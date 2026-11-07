import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupProgress,firstAction} from '../staff-setup-guide.mjs';

const stage=(n,ready)=>({n,title:'Stage '+n,ready});

test('the next step is the first stage that is not ready, and finished stages are marked done',()=>{
 const r=setupProgress([stage(1,true),stage(2,true),stage(3,false),stage(4,false)]);
 assert.equal(r.done,2);assert.equal(r.total,4);assert.equal(r.current.n,3);assert.equal(r.allDone,false);
 assert.deepEqual(r.segments.map(x=>x.state),['done','done','current','todo']);
});

test('once the opening trial balance is posted the next step moves to source data',()=>{
 const before=setupProgress([stage(1,true),stage(2,true),stage(3,false),stage(4,false)]);
 const after=setupProgress([stage(1,true),stage(2,true),stage(3,true),stage(4,false)]);
 assert.equal(before.current.n,3);assert.equal(after.current.n,4);
});

test('all stages ready means nothing is left to do',()=>{
 const r=setupProgress([stage(1,true),stage(2,true)]);
 assert.equal(r.allDone,true);assert.equal(r.current,null);
});

test('firstAction returns only the first button of a group',()=>{
 const html='<button type="button" data-id="1">A</button><button type="button" data-id="2">B</button>';
 assert.equal(firstAction(html),'<button type="button" data-id="1">A</button>');
 assert.equal(firstAction(''),'');
});

test('the checklist shows the next step above the setup stages and styles are shipped',()=>{
 const src=fs.readFileSync(new URL('../staff-setup-guide.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(src,/\$content\.innerHTML=`\$\{nextBox\}/);
 assert.match(src,/Next step · /);
 assert.match(css,/\.setup-progress/);assert.match(css,/\.setup-seg\.current/);
});
