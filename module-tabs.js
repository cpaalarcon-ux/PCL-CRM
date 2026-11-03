(function () {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const tabBar = document.querySelector('.tabs');
  if (!tabs.length || !tabBar) return;

  const validTabs = tabs
    .map((tab) => tab.dataset.tab)
    .filter(Boolean);

  function activateModule(tabName, options = {}) {
    const { updateUrl = true } = options;
    const resolvedTab = validTabs.includes(tabName) ? tabName : validTabs[0];

    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === resolvedTab;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === resolvedTab);
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', resolvedTab);
      history.replaceState({}, '', url);
    }
  }

  const requestedTab = new URLSearchParams(window.location.search).get('tab') || 'clients';
  activateModule(requestedTab, { updateUrl: false });

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activateModule(tab.dataset.tab);
    });
  });

  const openCurrentModuleButton = document.createElement('button');
  openCurrentModuleButton.type = 'button';
  openCurrentModuleButton.className = 'btn secondary';
  openCurrentModuleButton.id = 'openCurrentModule';
  openCurrentModuleButton.textContent = 'Open in new tab';

  openCurrentModuleButton.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab.active')?.dataset.tab || validTabs[0];
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeTab);
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  });

  tabBar.appendChild(openCurrentModuleButton);
})();
