import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { isPreparationParticipant, openingImportDecision } = await import('../supabase/functions/staff-workspace-v12/workflow-gate-rules.mjs');
const source = fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/ledger-actions.ts', import.meta.url), 'utf8');

test('segregation of duties includes both the original preparer and the last editor', () => {
  assert.equal(isPreparationParticipant('assistant-1', 'assistant-1', 'manager-1'), true);
  assert.equal(isPreparationParticipant('manager-1', 'assistant-1', 'manager-1'), true);
  assert.equal(isPreparationParticipant('reviewer-1', 'assistant-1', 'manager-1'), false);
});

test('a returned Excel opening TB is replaced in place rather than creating a second journal', () => {
  assert.deepEqual(openingImportDecision(null), { action: 'create' });
  assert.deepEqual(openingImportDecision({ status: 'Returned', source_snapshot: { kind: 'Excel' } }), { action: 'replace' });
  assert.deepEqual(openingImportDecision({ status: 'Draft', source_snapshot: { kind: 'Excel' } }), { action: 'replace' });
});

test('opening TB imports stay locked during review and after posting', () => {
  const submitted = openingImportDecision({ status: 'Submitted', source_snapshot: { kind: 'Excel' } });
  const posted = openingImportDecision({ status: 'Posted', source_snapshot: { kind: 'Excel' } });
  assert.equal(submitted.action, 'reject');
  assert.match(submitted.message, /waiting for independent review/);
  assert.equal(posted.action, 'reject');
  assert.match(posted.message, /already posted/);
});

test('non-Excel opening journals cannot be overwritten by a workbook upload', () => {
  const decision = openingImportDecision({ status: 'Draft', source_snapshot: { kind: 'Manual' } });
  assert.equal(decision.action, 'reject');
  assert.match(decision.message, /edit the draft there/);
});

test('server action paths use the shared gates for review and opening import', () => {
  assert.match(source, /isPreparationParticipant\(a\.staff_id,j\.prepared_by,j\.last_prepared_by\)/);
  assert.match(source, /openingImportDecision\(openingDraft\)/);
  assert.match(source, /openingDecision\.action==='replace'\)edit\(openingDraft,a\)/);
});
