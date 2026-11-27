import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, loadEnvironment, reachable} from '../scripts/build-site.mjs';
import {taxTestingEnabled, stagingRates} from '../supabase/functions/staff-workspace-v12/testing-rates.mjs';
import {allowedOrigin, DEFAULT_ORIGINS} from '../supabase/functions/staff-workspace-v12/validation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = JSON.parse(fs.readFileSync(path.join(root, 'environments/staging.json'), 'utf8'));
const FAKE = {name: 'production', project_ref: 'abcdefghijklmnopqrst', publishable_key: 'sb_publishable_FICTIONALKEYFORTESTSONLY123456'};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcl-env-'));
const fakeFile = path.join(tmp, 'production.json');
fs.writeFileSync(fakeFile, JSON.stringify(FAKE));
const outName = `dist-test-${process.pid}`;
const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
test.after(() => { fs.rmSync(path.join(root, outName), {recursive: true, force: true}); fs.rmSync(tmp, {recursive: true, force: true}); });

test('the committed production file names the production project, never staging', () => {
  const prod = loadEnvironment('production');
  assert.equal(prod.name, 'production');
  assert.match(prod.project_ref, /^[a-z0-9]{20}$/);
  assert.notEqual(prod.project_ref, staging.project_ref);
  assert.notEqual(prod.publishable_key, staging.publishable_key);
  assert.ok(!/REPLACE_WITH/.test(JSON.stringify(prod)), 'no placeholder text is left');
});

test('a production build refuses the staging project and bad names', () => {
  const same = path.join(tmp, 'same.json');
  fs.writeFileSync(same, JSON.stringify({...staging, name: 'production'}));
  assert.throws(() => loadEnvironment('production', same), /points at the staging project/);
  assert.throws(() => loadEnvironment('qa'), /--env staging or --env production/);
  assert.throws(() => loadEnvironment('staging', fakeFile), /not "staging"/);
});

test('production output carries the production project and not one trace of staging', () => {
  const r = build({env: 'production', out: outName, file: fakeFile});
  const dist = path.join(root, outName);
  assert.ok(r.files > 50, 'the app files are copied');
  for (const f of walk(dist)) {
    if (!/\.(html|js|mjs|css|json|csv|txt)$|(^|[\\/])_(headers|redirects)$/.test(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    assert.ok(!t.includes(staging.project_ref), `${path.relative(dist, f)} still names the staging project`);
    assert.ok(!t.includes(staging.publishable_key), `${path.relative(dist, f)} still holds the staging key`);
  }
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  assert.match(headers, new RegExp(`connect-src https://${FAKE.project_ref}\\.supabase\\.co wss://${FAKE.project_ref}\\.supabase\\.co`));
  assert.match(fs.readFileSync(path.join(dist, 'staff.html'), 'utf8'), new RegExp(`connect-src https://${FAKE.project_ref}\\.supabase\\.co`));
  assert.match(fs.readFileSync(path.join(dist, 'staff-pilot.mjs'), 'utf8'), new RegExp(`https://${FAKE.project_ref}\\.supabase\\.co/functions/v1/staff-workspace-v12`));
  assert.match(fs.readFileSync(path.join(dist, 'staff-messenger.mjs'), 'utf8'), new RegExp(FAKE.publishable_key));
  const staffHeaders = headers.split('\n\n').find(block => block.startsWith('/staff\n'));
  assert.ok(staffHeaders, 'the live route has its own headers');
  assert.match(staffHeaders, /Cache-Control: no-store/);
  assert.match(staffHeaders, /Referrer-Policy: no-referrer/);
  assert.match(staffHeaders, /frame-ancestors 'none'/);
  assert.equal(fs.readFileSync(path.join(dist, '_redirects'), 'utf8').trim(), '/ /staff 302');
  assert.match(fs.readFileSync(path.join(dist, '404.html'), 'utf8'), /<a href="\/staff">/);
  assert.match(fs.readFileSync(path.join(dist, 'staff-communication-qr.mjs'), 'utf8'), /new URL\('\/staff',origin\)/);
});

test('the built site publishes only the staff app, never SQL, tests, notes or the old browser-local preview', () => {
  const dist = path.join(root, outName);
  const rel = walk(dist).map(f => path.relative(dist, f).split(path.sep).join('/'));
  for (const bad of ['index.html', 'app.js', 'database_schema.sql', 'README.md', 'package.json'])
    assert.ok(!rel.includes(bad), `${bad} must not be published`);
  assert.ok(!rel.some(f => /^(supabase|tests|archive|scripts|node_modules|environments)\//.test(f)), 'no source folders are published');
  assert.ok(rel.includes('staff.html') && rel.includes('staff-pilot.mjs') && rel.includes('_headers'));
  assert.ok(!rel.includes('staff-pilot.html'), 'the old production URL has no published page');
});

test('staging labels and the test warning appear only on the staging workspace', () => {
  const stagingPage = fs.readFileSync(path.join(root, 'staff-pilot.html'), 'utf8');
  const productionPage = fs.readFileSync(path.join(root, outName, 'staff.html'), 'utf8');
  for (const warning of [/Staging workspace/, /staff UAT/, /STAGING · UAT IN PROGRESS/, /DO NOT FILE OR SEND/i, /Isolated UAT data/, /approved staging test clients only/]) {
    assert.match(stagingPage, warning);
    assert.doesNotMatch(productionPage, warning);
  }
  assert.match(productionPage, /id="uatScopeNotice"[^>]*\bhidden\b/);
  assert.match(productionPage, /Sessions end after 30 minutes of inactivity/);
});

test('every staff screen module that the app imports is in the build', () => {
  const set = new Set(reachable());
  const missing = [];
  for (const f of fs.readdirSync(root).filter(n => /^staff-.*\.mjs$/.test(n))) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of t.matchAll(/from\s+['"]\.\/([A-Za-z0-9_.-]+\.mjs)(?:\?[^'"]*)?['"]/g))
      if (set.has(f) && !set.has(m[1]) && fs.existsSync(path.join(root, m[1]))) missing.push(`${f} -> ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('rates in Testing status are honoured on the staging project only', () => {
  assert.equal(taxTestingEnabled(`https://${staging.project_ref}.supabase.co`), true);
  assert.equal(taxTestingEnabled(`https://${FAKE.project_ref}.supabase.co`), false);
  assert.equal(taxTestingEnabled(''), false);
  const rows = [{rate_id: 'a', status: 'Approved', rate_key: 'X'}, {rate_id: 'b', status: 'Testing', rate_key: 'Y'}];
  assert.deepEqual(stagingRates(rows, `https://${FAKE.project_ref}.supabase.co`).map(r => r.rate_id), ['a']);
  assert.deepEqual(stagingRates(rows, `https://${staging.project_ref}.supabase.co`).map(r => r.rate_id).sort(), ['a', 'b']);
});

test('the fictional-client guard is off by default in the database', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261031203851_uat_scope_and_activation_gates.sql'), 'utf8');
  assert.match(sql, /enabled boolean NOT NULL DEFAULT false/);
  const all = fs.readdirSync(path.join(root, 'supabase/migrations')).map(f => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8')).join('\n');
  assert.ok(!/workspace_features[^;]*enabled\s*=\s*true|insert into erp_private\.workspace_features[^;]*true/i.test(all), 'no migration may switch the guard on');
});

test('allowed browser origins: staging keeps its list, production allows only what it is given', () => {
  assert.equal(allowedOrigin('https://backend-staging-foundation.pcl-crm.pages.dev'), true, 'staging default unchanged');
  assert.equal(allowedOrigin('https://evil.example'), false);
  assert.equal(allowedOrigin('https://pcl.phamalarcon.com', ['https://pcl.phamalarcon.com']), true);
  assert.equal(allowedOrigin('https://backend-staging-foundation.pcl-crm.pages.dev', ['https://pcl.phamalarcon.com']), false, 'production does not trust the staging site');
  assert.equal(allowedOrigin('https://pcl.phamalarcon.com', []), false, 'an unconfigured production project allows no browser at all');
  assert.ok(DEFAULT_ORIGINS.length >= 3);
});

test('the server takes its setup-link address from settings and falls back to staging only on the staging project', () => {
  const src = fs.readFileSync(path.join(root, 'supabase/functions/staff-workspace-v12/index.ts'), 'utf8');
  assert.match(src, /Deno\.env\.get\('PCL_SITE_ORIGIN'\)/);
  assert.match(src, /Deno\.env\.get\('PCL_ALLOWED_ORIGINS'\)/);
  assert.match(src, /IS_STAGING_PROJECT\?'https:\/\/backend-staging-foundation\.pcl-crm\.pages\.dev':''/, 'staging address only as the staging default');
  assert.match(src, /if\(!SETUP_BASE\)fail\(503/, 'no setup link is issued without a configured address');
  assert.match(src, /IS_STAGING_PROJECT\?'\/staff-pilot\.html':'\/staff'/, 'new production links use the live staff route');
  const loose = src.split('\n').filter(l => l.includes('backend-staging-foundation') && !l.includes('IS_STAGING_PROJECT?'));
  assert.deepEqual(loose, [], 'no other staging address in the server');
});

test('the Edge Function applies the configured origin list before serving a preflight', () => {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/staff-workspace-v12/index.ts'), 'utf8');
  const requestGate = source.match(/Deno\.serve\(async\(req:Request\)=>\{\n([\s\S]*?)\n try\{/);
  assert.ok(requestGate, 'the request gate runs before the request body and database work');
  const handlerSource = `(req, allowedOrigin, ORIGIN_LIST) => {\n${requestGate[1]}\n}`;
  const handlePreflight = new Function(`return ${stripTypeScriptTypes(handlerSource)}`)();
  const preflight = origin => new Request('https://example.test', {method: 'OPTIONS', headers: {origin}});
  const productionOrigin = 'https://pclnexus.com';
  const stagingOrigin = 'https://backend-staging-foundation.pcl-crm.pages.dev';

  const production = handlePreflight(preflight(productionOrigin), allowedOrigin, [productionOrigin]);
  assert.equal(production.status, 204);
  assert.equal(production.headers.get('Access-Control-Allow-Origin'), productionOrigin);

  const denied = handlePreflight(preflight(stagingOrigin), allowedOrigin, [productionOrigin]);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(handlePreflight(preflight(productionOrigin), allowedOrigin, []).status, 403);
  assert.equal(handlePreflight(preflight(stagingOrigin), allowedOrigin, null).status, 204);
});

test('the build stops, and deletes nothing, when the staff entry page is missing', () => {
  assert.throws(() => reachable(['no-such-entry-page.html']), /entry page is missing/);
  const src = fs.readFileSync(path.join(root, 'scripts/build-site.mjs'), 'utf8');
  assert.ok(src.indexOf('const files = reachable()') < src.indexOf('fs.rmSync(dist'), 'the entry page is checked before the output folder is cleared');
  assert.ok(reachable().includes('staff-pilot.html'), 'the real entry page is found');
});
