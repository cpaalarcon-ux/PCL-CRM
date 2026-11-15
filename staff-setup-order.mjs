// The order a preparer works through client set-up. Same rule as the server copy in setup-review-rules.mjs (kept identical by a test).
export const SETUP_ORDER=['identity','activity','chart','vat-cats'];
export function nextSetupStep(current){const i=SETUP_ORDER.indexOf(current);return i>=0&&i<SETUP_ORDER.length-1?SETUP_ORDER[i+1]:null;}
