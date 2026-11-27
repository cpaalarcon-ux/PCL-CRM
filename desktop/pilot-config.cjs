const { project_ref, publishable_key } = require('./staging.json');

module.exports = Object.freeze({
  site: 'https://backend-staging-foundation.pcl-crm.pages.dev',
  api: `https://${project_ref}.supabase.co/functions/v1/staff-workspace-v12`,
  publishableKey: publishable_key,
});
