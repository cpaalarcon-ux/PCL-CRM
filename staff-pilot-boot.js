// The lightweight sign-in bootstrap signals readiness independently of the ERP screen modules.
(() => {
  const signInReady = () => {
    document.documentElement.dataset.staffPilotReady = 'true';
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
      notice.textContent = 'The sign-in controls did not finish loading. Refresh the page once. If the problem continues, contact your ERP Manager.';
      notice.className = 'error';
    }
  }, 15000);
})();
