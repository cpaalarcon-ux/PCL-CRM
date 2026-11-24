const mumbaiReads = new Set([
  'settings_approvals_read',
  'settings_approval_items_read',
  'ledger_read',
  'ledger_report_gate',
]);

export function staffReadRequestUrl(api, action, route) {
  if (route !== 'mumbai' || !mumbaiReads.has(action)) return api;
  const url = new URL(api);
  url.searchParams.set('forceFunctionRegion', 'ap-south-1');
  return url.href;
}
