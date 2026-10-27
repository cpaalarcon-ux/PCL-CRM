export function stockMethodChoices() {
  return [
    ['Periodic', 'At stock counts (Periodic)'],
    ['Perpetual', 'For each receipt or issue (Perpetual)'],
  ];
}

export function stockCountChoices() {
  return ['Weekly', 'Monthly', 'Annually'];
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
