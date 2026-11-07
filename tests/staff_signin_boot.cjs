const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.PCL_BROWSER_MODULES || process.cwd()] }));

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!path.extname(file)) file += '.html';
  if (!file.startsWith(root) || !fs.existsSync(file)) {
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
    let mainRequested = false, releaseChecks = 0, serverBuild = '';
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/staff-pilot.mjs*', route => {
      mainRequested = true;
      return route.abort();
    });
    await page.route('https://yfjiculexbzpkvtapudk.supabase.co/**', async route => {
      const payload = route.request().postDataJSON() || {};
      if (payload.action === 'release_info') {
        releaseChecks += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify({ function: 'staff-workspace-v12', build: serverBuild, commit: null }) });
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
    serverBuild = await page.evaluate(() => document.documentElement.dataset.build);
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
    await signIn.click();
    await page.getByText('Your sign-in is saved, but the workspace screens did not load.', { exact: false }).waitFor({ state: 'visible' });
    assert.equal(mainRequested, true, 'the ERP module should load only after authentication succeeds');
    assert.equal(await page.locator('#retryWorkspace').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS Chromium: sign-in becomes usable without the full ERP module; successful authentication then offers a workspace retry if app modules fail.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
