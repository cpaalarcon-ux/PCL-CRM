import {choice, date, fail, revision, text, uuid} from './validation.mjs';

const operations = ['assign','claim','status','due','project_owner'];
const modes = ['tasks','pool','projects'];

export async function workloadAction(tx: any, actor: any, p: any) {
 if (!['task_workload_list','task_workload_candidates','task_workload_apply'].includes(p.action)) return;
 const leader = ['PARTNER','MANAGER'].includes(actor.category_code);
 const canClaim = ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(actor.category_code);
 if (!canClaim) fail(403, 'This workspace is available to project staff.');
 if (p.action === 'task_workload_list') {
  const mode = choice(p.mode,modes), offset = Math.min(100000,Math.max(0,Number.parseInt(p.offset,10)||0));
  const firm = p.firm_id ? uuid(p.firm_id) : null, project = p.project_id ? uuid(p.project_id) : null;
  const query = text(p.search||'',140,false), due = date(p.due);
  if (!leader && mode !== 'pool') fail(403, 'Managers and Partners can manage project assignments.');
  const records = mode==='projects'
   ? await tx`select p.project_id as id,p.project_name,c.company_name as client_name,p.status,p.revision,
       s.full_name as assignee_name,count(*) over() as total_count
      from erp_private.projects p join erp_private.clients c using(client_id)
      left join erp_private.staff_members s on s.staff_id=p.owner_staff_id
      where p.deleted_at is null and p.status='Active' and c.deleted_at is null
       and (${firm}::uuid is null or p.handling_firm_id=${firm}) and (${project}::uuid is null or p.project_id=${project})
       and strpos(lower(concat_ws(' ',c.company_name,p.project_name)),lower(${query}))>0
      order by p.project_name,p.project_id limit 100 offset ${offset}`
   : await tx`select task_id as id,* from erp_private.workload_tasks(${mode==='pool'},${firm}::uuid,${project}::uuid,${query},${due}::date,${offset})`;
  return {records, total:Number(records[0]?.total_count||0), leader};
 }
 const op = choice(p.operation, operations);
 if (!leader && op !== 'claim') fail(403, 'A Manager or Partner must assign work or change its schedule.');
 if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > 100) fail(400, 'Select between 1 and 100 records.');
 const items = p.items.map((item: any) => ({id:uuid(item?.id).toLowerCase(),revision:revision(item?.revision)}));
 const ids = items.map((item: any) => item.id);
 if (new Set(ids).size !== ids.length) fail(400, 'Remove duplicate records from the selection.');
 if (p.action==='task_workload_candidates') {
  if (!['assign','project_owner'].includes(op)) fail(400, 'Choose an assignment action.');
  return {people:await tx`select * from erp_private.workload_candidates(${ids}::uuid[],${op==='project_owner'})`};
 }
 const [result] = await tx`select erp_private.workload_apply(${tx.json(items)}::jsonb,${op},
  ${p.staff_id ? uuid(p.staff_id) : null}::uuid,${text(p.reason||'',1000,false)},${p.status||null},
  ${date(p.due)}::date,${p.confirm_leave===true}) as count`;
 return result;
}
