import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/bootstrap/first-partner.sql', import.meta.url), 'utf8');
const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

test('bootstrap refuses to run when any staff record exists, and the inserts depend on that check', () => {
  assert.match(code, /guard AS MATERIALIZED/, 'the check must be computed, not optimised away');
  assert.match(code, /1 \/ \(CASE WHEN EXISTS \(SELECT 1 FROM erp_private\.staff_members\) THEN 0 ELSE 1 END\)/);
  assert.equal((code.match(/WHERE guard\.ok = 1/g) || []).length, 2, 'both the firm and the staff insert wait on the check');
});

test('bootstrap creates one Partner without ever setting a password, and stores only a hash of the link', () => {
  assert.match(code, /'PARTNER'/);
  assert.match(code, /'Pending setup'/);
  assert.ok(!/auth\.users|password|crypt\(/i.test(code), 'no password or auth user is written here; the person sets their own');
  assert.match(code, /extensions\.digest\(raw\.token, 'sha256'\)/);
  assert.match(code, /interval '24 hours'/);
  const insert = code.slice(code.indexOf('INSERT INTO erp_private.setup_tokens'), code.indexOf('RETURNING staff_id, expires_at'));
  assert.match(insert, /SELECT encode\(extensions\.digest\(raw\.token, 'sha256'\), 'hex'\), staff\.staff_id/, 'token_hash receives the hash');
  assert.equal((insert.match(/raw\.token/g) || []).length, 1, 'the raw token appears only inside the hash call');
});

test('bootstrap has only placeholders to fill and is clearly marked once-only', () => {
  const marks = sql.match(/<<[^>]+>>/g) || [];
  assert.ok(marks.length >= 6, 'values the owner must replace are marked');
  assert.match(sql, /run ONCE/i);
  assert.match(sql, /REFUSES to run if any staff record already exists/);
});
