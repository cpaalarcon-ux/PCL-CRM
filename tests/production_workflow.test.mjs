import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const prod = fs.readFileSync(new URL('../.github/workflows/production-backend-deploy.yml', import.meta.url), 'utf8');
const staging = fs.readFileSync(new URL('../.github/workflows/staging-backend-deploy.yml', import.meta.url), 'utf8');
const hosted = fs.readFileSync(new URL('../.github/workflows/staging-hosted-uat.yml', import.meta.url), 'utf8');
const browser = fs.readFileSync(new URL('../.github/workflows/staging-browser-uat.yml', import.meta.url), 'utf8');
const REF = 'yfjiculexbzpkvtapudk';

test('production workflow needs the production environment, a typed confirmation and main only', () => {
  assert.match(prod, /environment: production/);
  assert.match(prod, /DEPLOY TO PRODUCTION/);
  assert.match(prod, /workflow_dispatch/);
  assert.ok(!/\n\s*push:/.test(prod), 'no push trigger: production is started by a person');
  assert.match(prod, /origin\/main/);
});

test('production workflow takes its project from a variable and refuses the staging project', () => {
  assert.match(prod, /PROJECT_REF: \$\{\{ vars\.PROD_PROJECT_REF \}\}/);
  const uses = prod.split('\n').filter(l => l.includes(REF));
  assert.equal(uses.length, 1, 'the staging reference appears once, only to be refused');
  assert.ok(uses.some(l => l.startsWith('  STAGING_PROJECT_REF:')));
  assert.match(prod, /\[ "\$PROJECT_REF" != "\$STAGING_PROJECT_REF" \]/);
});

test('production uses its own secrets and staging never does', () => {
  assert.match(prod, /secrets\.PROD_SUPABASE_ACCESS_TOKEN/);
  assert.match(prod, /secrets\.PROD_SUPABASE_DB_PASSWORD/);
  assert.ok(!/secrets\.SUPABASE_(ACCESS_TOKEN|DB_PASSWORD)/.test(prod), 'production must not read the staging secrets');
  assert.ok(!/PROD_/.test(staging), 'the staging workflow must not read production values');
  assert.match(staging, new RegExp(`PROJECT_REF: ${REF}`));
});

test('production requires green staging checks, migration safety and the same function settings as staging', () => {
  assert.match(prod, /Staging browser UAT/);
  assert.match(prod, /Staging hosted check/);
  assert.match(prod, /db push --linked --dry-run/);
  assert.match(prod, /older than the last applied production migration/);
  assert.match(prod, /functions deploy staff-workspace-v12 --project-ref "\$PROJECT_REF" --no-verify-jwt/);
});

test('both required staging checks can be dispatched on the exact main release commit', () => {
  assert.match(prod, /--commit "\$sha"/);
  for (const workflow of [hosted, browser]) {
    assert.match(workflow, /^  workflow_dispatch:\s*$/m);
  }
});

test('production sets its own site address and allowed origins and refuses staging ones', () => {
  assert.match(prod, /vars\.PROD_SITE_ORIGIN/);
  assert.match(prod, /vars\.PROD_ALLOWED_ORIGINS/);
  assert.match(prod, /supabase secrets set PCL_SITE_ORIGIN=/);
  assert.match(prod, /\*backend-staging-foundation\*/);
  const preflight = prod.indexOf('Validate production site addresses before deployment');
  assert.ok(preflight >= 0 && preflight < prod.indexOf('Link the production project'));
  assert.match(prod, /PROD_ALLOWED_ORIGINS must include PROD_SITE_ORIGIN/);
  assert.ok(prod.indexOf('secrets set PCL_SITE_ORIGIN') < prod.indexOf('functions deploy staff-workspace-v12'), 'settings are in place before the function goes live');
});
