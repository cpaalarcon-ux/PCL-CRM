// Keep sign-in unavailable until the application module has registered its handlers.
(() => {
  const signInReady = () => {
    document.documentElement.dataset.staffPilotReady = 'true';
    const button = document.querySelector('#loginForm button[type="submit"]');
    if (button) button.disabled = false;
    const notice = document.querySelector('#notice');
    if (notice?.textContent.startsWith('Loading secure sign-in')) {
      notice.textContent = '';
      notice.className = '';
    }
  };

  document.addEventListener('pcl-staff-pilot-ready', signInReady, { once: true });
  window.setTimeout(() => {
    if (document.documentElement.dataset.staffPilotReady === 'true') return;
    const notice = document.querySelector('#notice');
    if (notice) {
      notice.textContent = 'The sign-in screen did not finish loading. Refresh the page. If it still does not respond, contact your ERP Manager.';
      notice.className = 'error';
    }
  }, 8000);
})();
