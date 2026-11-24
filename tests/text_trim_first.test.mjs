import test from 'node:test';
import assert from 'node:assert/strict';
import {text,HttpError} from '../supabase/functions/staff-workspace-v12/validation.mjs';
test('spaces around a value do not count towards its length limit',()=>{
 assert.equal(text('A002643880B ',11),'A002643880B');
 assert.equal(text('  A002643880B',11),'A002643880B');
 assert.equal(text('0721734747 ',100),'0721734747');
});
test('a value still too long after trimming is rejected',()=>{
 assert.throws(()=>text('A002643880BX ',11),e=>e instanceof HttpError&&e.status===400);
});
test('blank and non-text values are still rejected when required',()=>{
 assert.throws(()=>text('   ',11),e=>e instanceof HttpError);
 assert.throws(()=>text(null,11),e=>e instanceof HttpError);
 assert.equal(text('   ',11,false),'');
});
test('oversized padding is rejected without trimming it',()=>{
 assert.throws(()=>text(' '.repeat(5000)+'x',11),e=>e instanceof HttpError);
});
