export function stockMethodChoices() {
  return [
    ['Periodic', 'Periodic — update stock totals at stock counts'],
    ['Perpetual', 'Perpetual — update stock records for each receipt and issue'],
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
  if (!stockEvidenceChoices().some(([value]) => value === source)) {
    throw new Error('Choose the type of policy evidence.');
  }
  if (source === 'Other' && detail.length < 3) {
    throw new Error('Describe the other evidence type.');
  }
  if (ref.length < 8) {
    throw new Error('Enter the policy document title or reference (at least 8 characters).');
  }
  return `${source === 'Other' ? `Other — ${detail}` : source}: ${ref}`;
}
