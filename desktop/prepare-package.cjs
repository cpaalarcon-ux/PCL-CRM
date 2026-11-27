const fs = require('node:fs');
const path = require('node:path');
const { workspaceConfig } = require('./workspace-config.cjs');

async function prepare(environment) {
  const { loadEnvironment } = await import('../scripts/build-site.mjs');
  const { name, project_ref, publishable_key } = loadEnvironment(environment);
  const buildEnvironment = { name, project_ref, publishable_key };
  workspaceConfig(buildEnvironment);
  fs.writeFileSync(path.join(__dirname, 'workspace.json'), JSON.stringify(buildEnvironment, null, 2) + '\n');
}

prepare(process.argv[2]).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
