import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261214800000_chat_realtime_signals.sql');

test('a new message signals the conversation topic and each other person who can see it, never the author',()=>{
 assert.match(sql,/'changed', 'pcl-discussion:'/);
 assert.match(sql,/'chat', 'pcl-user:'/);
 assert.match(sql,/WHERE staff_id <> NEW\.author_id/);
});

test('signals carry ids only, no message text',()=>{
 for(const payload of sql.match(/jsonb_build_object\([^)]*\)/g))assert.doesNotMatch(payload,/body|text|name/i,payload);
});

test('the recipient function is not callable by browser roles, and the reaction trigger fires on add and remove',()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION erp_private\.discussion_recipients\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
 assert.match(sql,/AFTER INSERT OR DELETE ON erp_private\.discussion_reactions/);
});

test('the browser refreshes its chat list on the chat signal and keeps its polling as the fallback',()=>{
 const ui=read('staff-messenger.mjs');
 assert.match(ui,/event:'chat'\},\(\)=>\{void refreshList\(\);\}/);
 assert.match(ui,/window\.setInterval\(\(\)=>\{if\(!d\(\)\)return;void refreshList\(\)/,'polling stays as the fallback');
});
