// Keep staff sign-in independent of the larger ERP screen module graph.
(() => {
  const API = 'https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v12';
  const KEY = 'sb_publishable_ibWMisivJ2reyfJl1eHP9A_HFuFY3Hc';
  const SESSION_KEY = 'pcl-staff-session-v2';
  const $ = selector => document.querySelector(selector);
  const loginForm = $('#loginForm');
  const setupForm = $('#setupForm');
  const loginButton = loginForm?.querySelector('button[type="submit"]');
  const retryButton = $('#retryWorkspace');
  const recoveryButton = $('#requestPartnerRecovery');
  const setupButton = setupForm?.querySelector('button[type="submit"]');
  if (!loginForm || !setupForm || !loginButton) return;

  let setupToken = null;
  let workspaceLoading = false;
  let landing = null;
  let fullWorkspace = null;

  function notice(message, error = false) {
    const element = $('#notice');
    if (!element) return;
    element.textContent = message;
    element.className = error ? 'error' : '';
  }

  async function send(payload, { headers: extra = {}, timeoutMs = 0 } = {}) {
    const headers = { apikey: KEY, 'x-region': 'ap-south-1', 'Content-Type': 'application/json', ...extra };
    const controller = timeoutMs ? new AbortController() : null;
    let timer;
    let response;
    try {
      if (controller) timer = window.setTimeout(() => controller.abort(), timeoutMs);
      response = await fetch(API, {
        method: 'POST', headers, body: JSON.stringify(payload), cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller?.signal
      });
    } catch (error) {
      if (controller && error?.name === 'AbortError') throw Error('The sign-in service did not respond in time. Check your connection and try again.');
      if (controller && error instanceof TypeError) throw Error('Could not reach the sign-in service. Check your connection and reload the page.');
      throw error;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw Object.assign(Error(result.error || 'The request failed.'), { status: response.status });
    }
    return response.json();
  }

  function readSavedSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (value && typeof value.access_token === 'string' && value.access_token &&
          typeof value.refresh_token === 'string' && value.refresh_token &&
          typeof value.session_id === 'string' && value.session_id &&
          Number.isFinite(value.expires_at) && Number.isFinite(value.last_activity) &&
          value.last_activity <= Date.now()) return value;
    } catch { /* A malformed local session is discarded below. */ }
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  function saveSession(result) {
    const value = { ...result, last_activity: Date.now() };
    if (typeof value.access_token !== 'string' || !value.access_token ||
        typeof value.refresh_token !== 'string' || !value.refresh_token ||
        typeof value.session_id !== 'string' || !value.session_id ||
        !Number.isFinite(value.expires_at)) {
      throw Error('The login response is incomplete. Please sign in again.');
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  }

  function clearSavedSession() {
    const previous = readSavedSession();
    localStorage.removeItem(SESSION_KEY);
    if (previous?.access_token) {
      void send({ action: 'logout' }, { headers: { Authorization: `Bearer ${previous.access_token}` } }).catch(() => {});
    }
  }

  async function openFullWorkspace(options) {
    fullWorkspace ??= await import('./staff-pilot.mjs?v=20261114-setupguide-v1&rev=20261119-2906&upd=20261124-v1&swap=20261124-v1&reset=20261122-v1&vault=20261122-v1&create-client=20261122-v1&review=20261122-v1&bulk=20261122-v1&starter=20261210-v1&screen=20261211-v1&routing=20261124-mumbai-v1&landing=20261125-v2&fold=20261125-v1&single=20261125-v1&ownerbatch=20261125-v1&register=20261125-v2&hours=20261126-v2&agora=1&lead=20261127-v1&followups=1');
    await fullWorkspace.activateStaffWorkspace(options);
    landing=null;
  }

  function sessionEnded(message) {
    document.dispatchEvent(new CustomEvent('pcl-staff-session-ended',{detail:message}));
  }

  async function openWorkspace({started=performance.now(),mode='Saved session'}={}) {
    if (workspaceLoading) return;
    if (!readSavedSession()) {
      workspaceLoading = false;
      loginButton.disabled = false;
      if (retryButton) retryButton.hidden = true;
      notice('Your session ended. Please sign in again.', true);
      return;
    }
    workspaceLoading = true;
    loginButton.disabled = true;
    if (retryButton) retryButton.hidden = true;
    notice('Opening your secure workspace…');
    try {
      const {mountStaffLanding}=await import('./staff-pilot-landing.mjs?v=20261125-v2&fold=20261125-v1&register=20261125-v2&followups=1');
      try{
        landing=await mountStaffLanding({send,notice,openFullWorkspace,sessionEnded,started,mode});
      }catch(error){
        // The frontend can deploy before the backend adds the landing action.
        if(![403,404].includes(error.status))throw error;
        await openFullWorkspace();
      }
    } catch (error) {
      workspaceLoading = false;
      if (readSavedSession()) {
        if (retryButton) retryButton.hidden = false;
        notice('Your sign-in is saved, but the workspace screens did not load. Retry loading them or refresh the page.', true);
      } else {
        loginButton.disabled = false;
        notice(error.status===401?error.message:'The workspace did not load. Please sign in again.', true);
      }
    }
  }

  function setupExpiryText(value) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    }).format(new Date(value)) + ' EAT';
  }

  async function checkSetupLink() {
    const current = setupToken;
    if (!setupButton) return;
    setupButton.disabled = true;
    if (!current) {
      $('#setupState').textContent = 'Open the complete setup link copied by your Manager.';
      return;
    }
    $('#setupState').textContent = 'Checking this setup link…';
    try {
      const result = await send({ action: 'setup_status', token: current });
      if (current !== setupToken) return;
      $('#setupState').textContent = result.state === 'ready'
        ? `Valid until ${setupExpiryText(result.expires_at)}. Opening this page does not use the link.`
        : result.message;
      setupButton.disabled = result.state !== 'ready';
      if (result.state !== 'ready') notice(result.message, true);
      else notice('');
    } catch (error) {
      if (current === setupToken) {
        $('#setupState').textContent = 'Could not check the link. Click Check link again.';
        notice(error.message, true);
      }
    }
  }

  function openSetup(value) {
    setupToken = value;
    landing?.end();
    landing = null;
    clearSavedSession();
    loginForm.hidden = true;
    setupForm.hidden = false;
    setupForm.reset();
    notice('');
    void checkSetupLink();
  }

  function captureSetupLink() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.has('setup')) return false;
    const value = params.get('setup');
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    openSetup(/^[a-f0-9]{64}$/.test(value || '') ? value : null);
    return true;
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    loginButton.disabled = true;
    loginButton.textContent = 'Signing in…';
    loginButton.setAttribute('aria-busy', 'true');
    notice('Checking your staff login…');
    const started=performance.now();
    try {
      const credentials = Object.fromEntries(new FormData(loginForm));
      const result = await send({ ...credentials, action: 'login' }, { timeoutMs: 20000 });
      saveSession(result);
      loginForm.reset();
      loginButton.textContent = 'Sign in';
      await openWorkspace({started,mode:'New sign-in'});
    } catch (error) {
      loginButton.disabled = false;
      notice(error.message, true);
    } finally {
      loginButton.removeAttribute('aria-busy');
      if (!workspaceLoading) loginButton.textContent = 'Sign in';
    }
  });

  recoveryButton?.addEventListener('click', async () => {
    const loginId = loginForm.elements.namedItem('login_id').value.trim();
    if (!loginId) {
      notice('Enter your staff login ID first.', true);
      loginForm.elements.namedItem('login_id').focus();
      return;
    }
    recoveryButton.disabled = true;
    try {
      await send({ action: 'request_partner_recovery', login_id: loginId }, { timeoutMs: 10000 });
      notice('If email recovery is enabled for this login ID, check your inbox for a setup link. For other accounts, contact your Engagement Partner.');
    } catch (error) {
      notice(error.message, true);
    } finally {
      recoveryButton.disabled = false;
    }
  });

  $('#checkSetup')?.addEventListener('click', () => void checkSetupLink());
  $('#backToSignIn')?.addEventListener('click', () => {
    setupToken = null;
    setupForm.reset();
    setupForm.hidden = true;
    loginForm.hidden = false;
    loginButton.disabled = false;
    notice('Sign in using your staff login ID and the password you saved.');
  });
  setupForm.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = new FormData(setupForm);
    if (fields.get('password') !== fields.get('confirmation')) {
      notice('Passwords do not match.', true);
      return;
    }
    const current = setupToken;
    if (!current || !setupButton) return;
    setupButton.disabled = true;
    try {
      await send({ action: 'setup', token: current, password: fields.get('password') });
      if (current !== setupToken) return;
      setupToken = null;
      setupForm.reset();
      setupForm.hidden = true;
      loginForm.hidden = false;
      loginButton.disabled = false;
      notice('Password saved. Sign in using the login ID provided with your link.');
    } catch (error) {
      if (current === setupToken) {
        notice(error.message, true);
        setupButton.disabled = false;
      }
    }
  });

  retryButton?.addEventListener('click', () => {
    workspaceLoading = false;
    void openWorkspace();
  });

  document.addEventListener('pcl-staff-session-ended', event => {
    if (!setupForm.hidden || readSavedSession()) return;
    workspaceLoading = false;
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in';
    loginButton.removeAttribute('aria-busy');
    if (retryButton) retryButton.hidden = true;
    notice(event.detail || 'Your account session ended. Please sign in again.', true);
  });

  if (!localStorage.getItem(SESSION_KEY) && sessionStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_KEY, sessionStorage.getItem(SESSION_KEY));
  }
  sessionStorage.removeItem(SESSION_KEY);

  const hasSetup = captureSetupLink();
  const hasSession = !hasSetup && !!readSavedSession();
  loginButton.disabled = hasSession;
  if (retryButton) retryButton.hidden = true;
  if (hasSession) notice('Opening your secure workspace…');
  else if (!hasSetup) notice('');

  // Release identity: warn (without blocking sign-in) when the page and the ERP server builds differ.
  async function checkRelease() {
    try {
      const result = await send({ action: 'release_info' }, { timeoutMs: 10000 });
      if (recoveryButton) recoveryButton.hidden = result?.partner_email_recovery !== true;
      const pageBuild = document.documentElement.dataset.build || '';
      document.documentElement.dataset.serverBuild = result?.build || '';
      if (result?.build && pageBuild && result.build !== pageBuild) {
        const element = $('#releaseCheck');
        if (element) {
          element.textContent = `This page is build ${pageBuild} but the ERP server is build ${result.build}. Refresh the page (Ctrl+Shift+R). If this message stays, tell your ERP Manager before entering any work.`;
          element.hidden = false;
        }
      }
    } catch { /* The release check never blocks sign-in. */ }
  }

  window.addEventListener('hashchange', captureSetupLink);
  document.documentElement.dataset.staffPilotReady = 'true';
  document.documentElement.dataset.staffPilotAuthBoot = 'true';
  document.dispatchEvent(new Event('pcl-staff-pilot-ready'));
  if (hasSession) void openWorkspace();
  void checkRelease();
})();


