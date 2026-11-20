// A Supervisor proposes a project (a Draft); only a Manager or Partner activates it. Staff without the right see no button, and the server refuses the action.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {STAFF_RIGHTS,rightForAction,effectiveStaffRights} from '../staff-rights-catalog.mjs';
import {projectEditor} from '../supabase/functions/staff-workspace-v12/workspace-rules.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const right=code=>STAFF_RIGHTS.find(r=>r.code===code);

test('the project rights: Supervisor, Manager and Partner may propose; only Manager and Partner activate',()=>{
 assert.deepEqual(right('project.propose').roles,['PARTNER','MANAGER','SUPERVISOR']);assert.deepEqual(right('project.activate').roles,['PARTNER','MANAGER']);
 for(const a of ['project_save','schedule_preview','schedule_config_preview'])assert.equal(rightForAction(a),'project.propose',a);
 for(const a of ['engagement_activate','engagement_save_activate'])assert.equal(rightForAction(a),'project.activate',a);
 assert.ok(effectiveStaffRights('SUPERVISOR').includes('project.propose'));assert.ok(!effectiveStaffRights('SUPERVISOR').includes('project.activate'));
 assert.ok(!effectiveStaffRights('ASSISTANT').includes('project.propose'));assert.ok(!effectiveStaffRights('INTERN').includes('project.propose'));
 assert.ok(effectiveStaffRights('MANAGER').includes('project.activate'));assert.ok(effectiveStaffRights('PARTNER').includes('project.propose')&&effectiveStaffRights('PARTNER').includes('project.activate'));
 assert.ok(!effectiveStaffRights('MANAGER',['project.propose']).includes('project.propose'),'a Partner can switch the right off for one person');
});
test('the server gates match: Supervisors may draft a project, Assistants and Interns may not, and activation is leader-only',()=>{
 for(const role of ['PARTNER','MANAGER','SUPERVISOR'])assert.equal(projectEditor({category_code:role}),true,role);
 for(const role of ['ASSISTANT','INTERN'])assert.equal(projectEditor({category_code:role}),false,role);
 const eng=read('supabase/functions/staff-workspace-v12/engagement-actions.ts');
 assert.match(eng,/includes\(p\.action\)\)return undefined;\s*leader\(a\);/,'engagement_activate and engagement_save_activate sit behind the Manager/Partner gate');
 assert.match(read('supabase/functions/staff-workspace-v12/suite-actions.ts'),/export const leader=\(a:any\)=>\{if\(!\['PARTNER','MANAGER'\]\.includes\(a\.category_code\)\)fail\(403/);
 assert.match(read('supabase/functions/staff-workspace-v12/workspace-actions.ts'),/if\(p\.action==='project_save'\)\{\s*editor\(a\);/,'project_save sits behind the Partner/Manager/Supervisor gate');
});
test('the Projects screen offers Propose project to a Supervisor, Draft project to a leader, and nothing to others or to someone whose right is off',()=>{
 const ui=read('staff-pilot.mjs');
 assert.match(ui,/function projectActions\(\)\{const off=new Set\(data\.me\.restricted_rights\|\|\[\]\)/);
 assert.match(ui,/supervisor=data\.me\.category_code==='SUPERVISOR'/);assert.match(ui,/\(leader\|\|supervisor\)&&!off\.has\('project\.propose'\)/);
 assert.match(ui,/leader\?'\+ Draft project':'\+ Propose project'/);assert.match(ui,/if\(leader\)buttons\.push\('<button class="primary" data-new="task">\+ Assign task<\/button>'\)/,'only leaders assign tasks from here');
 assert.match(ui,/Proposed: waits for a Manager or Partner to activate/);
});
