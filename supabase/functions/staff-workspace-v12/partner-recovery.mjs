const emailPattern = /^[^\s<>,@]+@[^\s<>,@]+\.[^\s<>,@]+$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function partnerRecoveryConfig(get, siteOrigin, isStaging) {
  if (isStaging || !/^https:\/\/[a-z0-9.-]+$/.test(siteOrigin)) return null;

  const staffId = get('PCL_RECOVERY_PARTNER_STAFF_ID')?.trim().toLowerCase();
  const email = get('PCL_RECOVERY_EMAIL')?.trim().toLowerCase();
  const from = get('PCL_RECOVERY_EMAIL_FROM')?.trim().toLowerCase();
  const accountId = get('PCL_RECOVERY_CF_ACCOUNT_ID')?.trim();
  const token = get('PCL_RECOVERY_CF_EMAIL_TOKEN')?.trim();
  if (!staffId || !uuidPattern.test(staffId) || !email || !emailPattern.test(email) ||
      !from || !emailPattern.test(from) || !accountId || !/^[a-f0-9]{32}$/.test(accountId) || !token) return null;

  return {staffId, email, from, accountId, token};
}

// Staff administrators issue links for other staff. A self-issued link is email recovery.
export function allowsPartnerRecoveryLink(row, configuredStaffId) {
  if (!row?.issued_by || row.issued_by !== row.staff_id) return true;
  return row.staff_id === configuredStaffId && row.category_code === 'PARTNER';
}

export async function sendPartnerRecoveryEmail(config, setupLink, fetcher = fetch) {
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      to: config.email,
      from: config.from,
      subject: 'Set your PCL Nexus password',
      text: `Open this link to set your PCL Nexus password. It expires in 15 minutes and can be used once.\n\n${setupLink}\n\nIf you did not request this, ignore this email.`,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  const delivery = await response.json();
  if (!response.ok || delivery.success !== true ||
      ![delivery.result?.delivered, delivery.result?.queued].some(list => Array.isArray(list) && list.includes(config.email))) {
    throw new Error('Password recovery email could not be sent.');
  }
}
