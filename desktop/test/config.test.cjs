const test = require('node:test');
const assert = require('node:assert/strict');
const { workspaceConfig } = require('../workspace-config.cjs');

test('desktop staging and production point to separate ERP workspaces', async () => {
  const { loadEnvironment } = await import('../../scripts/build-site.mjs');
  const production = workspaceConfig(loadEnvironment('production'));
  const staging = workspaceConfig(loadEnvironment('staging'));
  assert.equal(production.workspaceUrl, 'https://pclnexus.com/staff');
  assert.equal(production.site, 'https://pclnexus.com');
  assert.equal(staging.staging, true);
  assert.equal(production.staging, false);
  assert.notEqual(production.api, staging.api);
  assert.notEqual(production.publishableKey, staging.publishableKey);
  assert.throws(() => workspaceConfig({ name: 'testing' }), /Unknown PCL Nexus environment/);
  assert.throws(() => workspaceConfig({ ...loadEnvironment('production'), publishable_key: 'sb_secret_nop' }), /publishable key/);
});
