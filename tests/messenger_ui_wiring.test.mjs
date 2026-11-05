import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const {defaultStaffAreas}=await import('../staff-access-control.mjs');
const server=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
test('the Chat button sits in the header beside the account area and the browser and server agree on System Administrator areas',()=>{
 const html=read('staff-pilot.html');assert.match(html,/<div id="messenger"><\/div><div id="account"><\/div>/);
 const pilot=read('staff-pilot.mjs');assert.match(pilot,/createMessenger/);assert.match(pilot,/messenger\.start\(\)/);assert.match(pilot,/messenger\.stop\(\)/);
 assert.deepEqual(defaultStaffAreas('ADMIN'),['communications','staff_access','settings']);assert.deepEqual(defaultStaffAreas('ADMIN'),server.defaultStaffAreas('ADMIN'));
 for(const area of ['clients','projects','documents','audit','billing_wip','leads','time_hr'])assert.ok(!defaultStaffAreas('ADMIN').includes(area),area);
 const m=read('staff-messenger.mjs');for(const a of ['discussion_list','discussion_messages','discussion_send','discussion_read','discussion_open','discussion_candidates','discussion_staff_directory','discussion_group_create','discussion_group_members_set','discussion_group_overview'])assert.ok(m.includes(a),a);
 for(const a of ['discussion_group_create','discussion_group_members_set','discussion_staff_directory','discussion_group_overview'])assert.equal(server.areaForStaffAction(a),'communications');
});
