export function stockMethodChoices() {
  return [
    ['Periodic', 'At stock counts (Periodic)'],
    ['Perpetual', 'For each receipt or issue (Perpetual)'],
  ];
}

export function stockCountChoices() {
  return ['Weekly', 'Monthly', 'Annually'];
}

export function nextStockDay(value) {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function stockPolicyStartDate(activity, policies = [], blockedEnds = []) {
  if (!activity) return '';
  const activityStart = String(activity.effective_from || '').slice(0, 10);
  const related = policies.filter(policy => policy.activity_id === activity.activity_id);
  const previousStart = related.map(policy => String(policy.effective_from || '').slice(0, 10)).filter(Boolean).sort().at(-1) || '';
  const blockedEnd = blockedEnds.map(value => String(value || '').slice(0, 10)).filter(Boolean).sort().at(-1) || '';
  const limits = [activityStart, nextStockDay(previousStart), nextStockDay(blockedEnd)].filter(Boolean).sort();
  return limits.at(-1) || '';
}

export function stockEvidenceChoices() {
  return [
    ['Client inventory policy', 'Client inventory policy'],
    ['Approved accounting manual', 'Approved accounting manual'],
    ['Management or Board approval', 'Management or Board approval'],
    ['Stock-system settings or report', 'Stock-system settings or report'],
    ['Stock count or valuation working paper', 'Stock count or valuation working paper'],
    ['Other', 'Other — specify'],
  ];
}

export function stockPolicyEvidenceText(type, reference, other = '') {
  const source = String(type || '').trim();
  const ref = String(reference || '').trim();
  const detail = String(other || '').trim();
  if (!source && !ref && !detail) return '';
  if (!stockEvidenceChoices().some(([value]) => value === source)) {
    throw new Error('Choose the type of policy evidence.');
  }
  if (source === 'Other' && detail.length < 3) {
    throw new Error('Describe the other evidence type.');
  }
  return `${source === 'Other' ? `Other — ${detail}` : source}${ref ? `: ${ref}` : ''}`;
}