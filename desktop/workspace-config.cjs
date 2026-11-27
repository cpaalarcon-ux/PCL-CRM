const workspaceUrls = {
  staging: 'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot',
  production: 'https://pclnexus.com/staff',
};

function workspaceConfig({ name, project_ref, publishable_key }) {
  if (!Object.hasOwn(workspaceUrls, name)) throw Error('Unknown PCL Nexus environment.');
  if (!/^[a-z0-9]{20}$/.test(project_ref || '') || !/^sb_publishable_[\w-]+$/.test(publishable_key || '')) {
    throw Error('The desktop build needs the ERP project reference and its publishable key.');
  }
  const workspaceUrl = workspaceUrls[name];
  return Object.freeze({
    workspaceUrl,
    site: new URL(workspaceUrl).origin,
    api: `https://${project_ref}.supabase.co/functions/v1/staff-workspace-v12`,
    publishableKey: publishable_key,
    staging: name === 'staging',
  });
}

module.exports = { workspaceConfig };
