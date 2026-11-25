const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.PCL_BROWSER_MODULES || process.cwd()] }));

const root = path.resolve(__dirname, '..');
const siteRoot = process.env.PCL_SITE_ROOT ? path.resolve(process.env.PCL_SITE_ROOT) : root; // set to a build folder to test the built site
const server = http.createServer((req, res) => {
  let file = path.join(siteRoot, decodeURIComponent(req.url.split('?')[0]));
  if (!path.extname(file)) file += '.html';
  if (!file.startsWith(siteRoot) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.mjs') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
  res.setHeader('Content-Type', type);
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    ...(process.env.PCL_BROWSER_EXECUTABLE ? { executablePath: process.env.PCL_BROWSER_EXECUTABLE } : {}),
    headless: true,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    let mainRequested = false, releaseChecks = 0, serverBuild = '', emailRecoveryEnabled = false, landingChecks = 0;
    const workspaceStarts = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/staff-pilot.mjs*', route => {
      mainRequested = true;
      workspaceStarts.push(landingChecks);
      return route.abort();
    });
    await page.route('https://yfjiculexbzpkvtapudk.supabase.co/**', async route => {
      const payload = route.request().postDataJSON() || {};
      if (payload.action === 'release_info') {
        releaseChecks += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify({ function: 'staff-workspace-v12', build: serverBuild, commit: null, partner_email_recovery: emailRecoveryEnabled }) });
        return;
      }
      if (payload.action === 'request_partner_recovery') {
        assert.deepEqual(payload, { action: 'request_partner_recovery', login_id: 'fictional-test-user' });
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify({ ok: true }) });
        return;
      }
      if (payload.action === 'workspace_landing') {
        landingChecks += 1;
        assert.equal(route.request().headers().authorization, 'Bearer fictional-access-token');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
          json: {
            me: { staff_id: 'fictional-staff', login_id: 'fictional-test-user', full_name: 'Test Staff', category_code: 'ASSISTANT', allowed_areas: ['projects'] },
            firms: [], firm_id: null, uat_client_scope: false,
            my_work: { open_count: 1, overdue_count: 0, tasks: [{ task_id: 'fictional-task', task_name: 'Prepare test work', project_name: 'Test project', status: 'Pending', due_at: null }] }
          }
        });
        return;
      }
      if (payload.action === 'session_activity') {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, json: { ok: true } });
        return;
      }
      assert.equal(payload.action, 'login');
      assert.equal(payload.login_id, 'fictional-test-user');
      assert.equal(payload.password, 'fictional-test-password');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
        body: JSON.stringify({
          access_token: 'fictional-access-token',
          refresh_token: 'fictional-refresh-token',
          session_id: 'fictional-session',
          expires_at: Date.now() / 1000 + 3600
        })
      });
    });

    serverBuild = '2000-01-01.1';
    await page.goto(`http://127.0.0.1:${server.address().port}/staff-pilot`);
    await page.locator('#releaseCheck').waitFor({ state: 'visible' });
    assert.match(await page.locator('#releaseCheck').textContent(), /ERP server is build 2000-01-01\.1/);
    assert.equal(await page.locator('#loginForm button[type="submit"]').isDisabled(), false, 'a release mismatch warns but never blocks sign-in');
    assert.equal(await page.getByRole('button', { name: 'Forgot password?' }).isVisible(), false);
    serverBuild = await page.evaluate(() => document.documentElement.dataset.build);
    emailRecoveryEnabled = true;
    await page.goto(`http://127.0.0.1:${server.address().port}/staff-pilot`);
    await page.waitForFunction(() => document.documentElement.dataset.serverBuild);
    assert.equal(await page.locator('#releaseCheck').isVisible(), false, 'matching builds show no warning');
    assert.ok(releaseChecks >= 2);
    const signIn = page.locator('#loginForm button[type="submit"]');
    await signIn.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#loginForm button[type="submit"]').disabled);
    assert.equal(mainRequested, false, 'the full ERP module must not be needed to enable sign-in');

    await page.fill('[name="login_id"]', 'fictional-test-user');
    await page.fill('#loginForm [name="password"]', 'fictional-test-password');
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByText('If email recovery is enabled for this login ID', { exact: false }).waitFor();
    assert.equal(mainRequested, false, 'requesting recovery must not open the ERP workspace');
    await signIn.click();
    const assignedTasks = page.locator('#content summary').filter({ hasText: 'Assigned tasks' });
    await assignedTasks.waitFor();
    assert.equal(await page.getByText('Prepare test work', { exact: true }).isVisible(), false);
    await assignedTasks.click();
    await page.getByText('Prepare test work', { exact: true }).waitFor();
    assert.equal(landingChecks, 1);
    assert.equal(mainRequested, false, 'My Work must render without the full workspace module');
    assert.equal(await page.getByRole('link', { name: 'Staff & access' }).count(), 0);
    await page.getByRole('link', { name: 'Open task' }).click();
    await page.getByRole('button', { name: 'Retry workspace area' }).waitFor();
    assert.equal(mainRequested, true, 'opening a task loads the full workspace module');
    assert.equal(await page.getByText('Prepare test work', { exact: true }).isVisible(), true, 'a load error keeps the dashboard usable');
    await page.goto(`http://127.0.0.1:${server.address().port}/staff-pilot?from=bookmark#view=clients`);
    await page.getByRole('button', { name: 'Retry workspace area' }).waitFor();
    assert.deepEqual(workspaceStarts, [1, 2], 'opening a saved Clients link also requests the landing dashboard before loading full modules');
    await assignedTasks.click();
    assert.equal(await page.getByText('Prepare test work', { exact: true }).isVisible(), true, 'a saved-link failure keeps Home visible');
    assert.equal(await page.locator('#signin').isVisible(), false, 'a detail failure leaves the saved sign-in active');
    assert.deepEqual(errors, []);
    console.log('PASS Chromium: sign-in and My Work open without full ERP modules. Selecting a task loads the modules and keeps the dashboard usable if they fail.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
