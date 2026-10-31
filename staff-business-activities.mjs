const activities = [
  ['agriculture', 'Agriculture and agribusiness', 'Other'],
  ['construction', 'Construction and building works', 'Construction'],
  ['education', 'Education and training', 'Other'],
  ['financial', 'Financial and insurance services', 'Other'],
  ['healthcare', 'Healthcare and medical services', 'Other'],
  ['hospitality', 'Hospitality and food services', 'Hospitality'],
  ['ict', 'Information and communications technology', 'Other'],
  ['manufacturing', 'Manufacturing and processing', 'Other'],
  ['mining', 'Mining and quarrying', 'Other'],
  ['nonprofit', 'Non-profit and donor-funded operations', 'Other'],
  ['professional', 'Professional and consultancy services', 'Consultancy'],
  ['public', 'Public sector and infrastructure', 'Other'],
  ['real_estate', 'Real estate and rental services', 'Other'],
  ['retail', 'Retail trade', 'Wholesale'],
  ['transport', 'Transport and logistics', 'Other'],
  ['utilities', 'Utilities and energy', 'Other'],
  ['wholesale', 'Wholesale trade', 'Wholesale'],
  ['other', 'Other — specify', 'Other'],
];

const byCode = new Map(activities.map(([code, label, pack]) => [code, { label, pack }]));

export function businessActivityChoices() {
  return activities.map(([code, label]) => [code, label]);
}

export function businessActivityName(code, other = '') {
  if (code === 'other') {
    const detail = String(other || '').trim();
    if (!detail) throw new Error('Describe the other business activity.');
    return `Other — ${detail}`.slice(0, 160);
  }
  const activity = byCode.get(String(code || ''));
  if (!activity) throw new Error('Choose a business activity from the list.');
  return activity.label;
}

export function suggestedIndustryPack(code) {
  return byCode.get(String(code || ''))?.pack || '';
}
