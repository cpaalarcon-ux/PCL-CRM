// Operates only on records already returned by the authenticated workspace API.
// These UI choices do not replace the server's record and permission checks.
export function uploadChoices(data, selection) {
  const client = data.clients.find(c => c.client_id === selection.client_id);
  const firms = client ? data.firms.filter(f => data.client_firms.some(
    link => link.client_id === client.client_id && link.firm_id === f.firm_id
  )) : [];
  const firm = firms.find(f => f.firm_id === selection.firm_id);
  const projects = firm ? data.projects.filter(p => p.client_id === client.client_id &&
    p.handling_firm_id === firm.firm_id && p.status !== 'Archived') : [];
  const project = projects.find(p => p.project_id === selection.project_id);
  const tasks = project ? data.tasks.filter(t => t.project_id === project.project_id &&
    (data.me.category_code !== 'ASSISTANT' || t.assigned_to === data.me.staff_id)) : [];
  return { firms, projects, tasks };
}
