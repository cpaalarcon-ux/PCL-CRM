import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  allowsPartnerRecoveryLink,
  partnerRecoveryConfig,
  sendPartnerRecoveryEmail,
} from '../supabase/functions/staff-workspace-v12/partner-recovery.mjs';

const ownerId = '01234567-89ab-4def-8012-3456789abcde';
const anotherId = '01234567-89ab-4def-8012-3456789abcd0';
const settings = {
  PCL_RECOVERY_PARTNER_STAFF_ID: ownerId,
  PCL_RECOVERY_EMAIL: 'owner@example.test',
  PCL_RECOVERY_EMAIL_FROM: 'accounts@example.test',
  PCL_RECOVERY_CF_ACCOUNT_ID: 'abcdefabcdefabcdefabcdefabcdefab',
  PCL_RECOVERY_CF_EMAIL_TOKEN: 'fictional-sending-token',
};
const origin = 'https://pcl.example.test';
const configured = partnerRecoveryConfig(key => settings[key], origin, false);
const setupLink = origin + '/staff-pilot.html#setup=' + 'a'.repeat(64);

test('email recovery needs a single staff UUID and complete server-side mail settings', () => {
  assert.equal(configured.staffId, ownerId);
  assert.equal(partnerRecoveryConfig(key => settings[key], origin, true), null);
  assert.equal(partnerRecoveryConfig(key => settings[key], origin + '/path', false), null);
  for (const missing of Object.keys(settings)) {
    assert.equal(partnerRecoveryConfig(key => key === missing ? undefined : settings[key], origin, false), null);
  }
  assert.equal(partnerRecoveryConfig(key => key === 'PCL_RECOVERY_PARTNER_STAFF_ID' ? 'pcl0001' : settings[key], origin, false), null);
});

test('email links can be used only by the designated Partner while private staff links still work', () => {
  const selfIssued = {staff_id: ownerId, issued_by: ownerId, category_code: 'PARTNER'};
  assert.equal(allowsPartnerRecoveryLink(selfIssued, ownerId), true);
  assert.equal(allowsPartnerRecoveryLink(selfIssued, anotherId), false);
  assert.equal(allowsPartnerRecoveryLink(selfIssued, null), false);
  assert.equal(allowsPartnerRecoveryLink({...selfIssued, category_code: 'MANAGER'}, ownerId), false);
  assert.equal(allowsPartnerRecoveryLink({staff_id: anotherId, issued_by: ownerId}, ownerId), true);
  assert.equal(allowsPartnerRecoveryLink({staff_id: ownerId, issued_by: null}, null), true);
});

test('delivery uses only the configured mailbox and requires provider acceptance', async () => {
  await sendPartnerRecoveryEmail(configured, setupLink, async (url, options) => {
    assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/' + configured.accountId + '/email/sending/send');
    assert.equal(options.redirect, 'error');
    const message = JSON.parse(options.body);
    assert.equal(message.to, settings.PCL_RECOVERY_EMAIL);
    assert.equal(message.from, settings.PCL_RECOVERY_EMAIL_FROM);
    assert.ok(message.text.includes(setupLink));
    return Response.json({success: true, result: {queued: [configured.email]}});
  });
  await assert.rejects(sendPartnerRecoveryEmail(configured, setupLink, async () =>
    Response.json({success: true, result: {permanent_bounces: [configured.email]}})
  ), /could not be sent/);
});

test('the public recovery handler matches both staff identity and login, then returns a generic reply', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/index.ts', import.meta.url), 'utf8');
  const handler = source.split('async function emailPartnerRecovery(')[1].split('async function signIn(')[0];
  assert.match(handler, /where staff_id=\$\{config\.staffId\}::uuid and lower\(login_id\)=\$\{loginId\} and category_code='PARTNER'/);
  assert.match(handler, /access_status in \('Active','Pending setup'\) and deleted_at is null/);
  assert.match(handler, /limit\('partner-email-recovery:'\+owner\.staff_id,3,tx\)/);
  assert.match(handler, /EdgeRuntime\.waitUntil\(emailPartnerRecovery\(loginId,PARTNER_RECOVERY\)/);
  assert.match(handler, /return \{ok:true\}/);
  assert.doesNotMatch(handler, /p\.(email|recipient|redirect_to)/);
});
