const test = require('node:test');
const assert = require('node:assert/strict');
const access = require('../access_control_core_v1.js');

const staff = (id, role, firmIds = ['F1'], projectIds = []) => ({
  id, role, status: 'Active', firmIds, projectIds, overrides: {},
});
const project = (extra = {}) => ({
  firmId: 'F1', projectId: 'P1', scope: 'detail', allocatedStaffIds: [],
  taskAssigneeIds: [], taskReviewerIds: [], ...extra,
});

test('Managers and Supervisors can see every project in their firm but cannot edit unallocated work', () => {
  for (const role of ['MANAGER', 'SUPERVISOR', 'PARTNER']) {
    const actor = staff(`u-${role}`, role);
    assert.equal(access.can(actor, 'projects', 'V', project()).ok, true, `${role} should see the project`);
    assert.equal(access.can(actor, 'opening_tb', 'V', project()).ok, true, `${role} should read project working data`);
    assert.equal(access.can(actor, 'opening_tb', 'E', project()).ok, false, `${role} must request allocation before editing`);
  }
});

test('Assistants can see the client directory, while client details require allocation or task assignment', () => {
  const assistant = staff('assistant-1', 'ASSISTANT');
  assert.equal(access.can(assistant, 'clients', 'V', { firmId: 'F1', scope: 'directory' }).ok, true);
  assert.equal(access.can(assistant, 'projects', 'V', project({ scope: 'summary' })).ok, true);
  assert.equal(access.can(assistant, 'clients', 'V', project({ scope: 'directory' })).ok, false);
  assert.equal(access.can(assistant, 'clients', 'V', project()).ok, false);
  assert.equal(access.can(assistant, 'clients', 'V', project({ taskAssigneeIds: ['assistant-1'] })).ok, true);
  assert.equal(access.can(assistant, 'ledger', 'V', project({ projectStaffIds: ['assistant-1'] })).ok, true);
});

test('Interns can see client and project details only through a task sent to them', () => {
  const intern = staff('intern-1', 'INTERN');
  assert.equal(access.can(intern, 'clients', 'V', { firmId: 'F1', scope: 'directory' }).ok, false);
  assert.equal(access.can(intern, 'projects', 'V', project()).ok, false);
  assert.equal(access.can(intern, 'clients', 'V', project({ taskAssigneeIds: ['intern-1'] })).ok, true);
  assert.equal(access.can(intern, 'audit_workpapers', 'V', project({ taskAssigneeIds: ['intern-1'] })).ok, false);
});

test('Firm access remains a hard boundary, including for Partner reads', () => {
  const partner = staff('partner-1', 'PARTNER', ['F1']);
  assert.equal(access.can(partner, 'projects', 'V', project({ firmId: 'F2' })).ok, false);
});

test('Review routing exposes only an independent Manager or Partner in the same firm', () => {
  const record = { firmId: 'F1', preparedBy: 'assistant-1', lastEditedBy: 'manager-1' };
  const candidates = [
    staff('assistant-1', 'ASSISTANT'), staff('manager-1', 'MANAGER'),
    staff('manager-2', 'MANAGER'), staff('partner-1', 'PARTNER'), staff('manager-other-firm', 'MANAGER', ['F2']),
  ];
  assert.deepEqual(access.eligibleReviewers(candidates, record).map(person => person.id), ['manager-2', 'partner-1']);
});

test('Only the designated independent reviewer can approve submitted work', () => {
  const reviewer = staff('manager-2', 'MANAGER');
  const record = project({ taskReviewerIds: ['manager-2'], preparedBy: 'assistant-1', lastEditedBy: 'assistant-1', status: 'SUBMITTED' });
  assert.equal(access.can(reviewer, 'opening_tb', 'A', record).ok, true);
  assert.equal(access.can(staff('manager-3', 'MANAGER'), 'opening_tb', 'A', record).ok, false);
  assert.equal(access.can(staff('assistant-1', 'ASSISTANT'), 'opening_tb', 'A', record).ok, false);
  assert.match(access.can(staff('assistant-1', 'ASSISTANT'), 'opening_tb', 'A', record).reason, /cannot approve/i);
  assert.equal(access.can(reviewer, 'opening_tb', 'A', { ...record, preparedBy: 'manager-2' }).ok, false);
});

test('Approval and posting are separate actions', () => {
  const reviewer = staff('manager-2', 'MANAGER');
  const submitted = project({ taskReviewerIds: ['manager-2'], preparedBy: 'assistant-1', status: 'SUBMITTED' });
  assert.equal(access.can(reviewer, 'opening_tb', 'P', submitted).ok, false);
  assert.equal(access.can(reviewer, 'opening_tb', 'P', { ...submitted, status: 'APPROVED' }).ok, true);
});

test('Allocation requests require a reason, valid firm access, an active non-intern requester and a valid date', () => {
  const projectRecord = { id: 'P1', firmId: 'F1' };
  assert.equal(access.createAllocationRequest({ requester: staff('intern-1', 'INTERN'), project: projectRecord, reason: 'Cover', requestedStartDate: '2026-11-03' }).ok, false);
  assert.equal(access.createAllocationRequest({ requester: staff('assistant-1', 'ASSISTANT'), project: projectRecord, reason: '', requestedStartDate: '2026-11-03' }).ok, false);
  assert.equal(access.createAllocationRequest({ requester: staff('assistant-1', 'ASSISTANT', ['F2']), project: projectRecord, reason: 'Cover', requestedStartDate: '2026-11-03' }).ok, false);
  assert.equal(access.createAllocationRequest({ requester: staff('assistant-1', 'ASSISTANT'), project: projectRecord, reason: 'Cover', requestedStartDate: '2026-02-30' }).ok, false);
});

test('Only another Manager or Partner can decide a pending allocation request', () => {
  const requestResult = access.createAllocationRequest({
    requester: staff('assistant-1', 'ASSISTANT'), project: { id: 'P1', firmId: 'F1' },
    reason: 'Take over fieldwork', takeover: true, requestedStartDate: '2026-11-03', id: 'REQ-1', requestedAt: '2026-11-02T00:00:00Z',
  });
  assert.equal(requestResult.ok, true);
  const request = requestResult.request;
  assert.equal(access.decideAllocationRequest({ approver: staff('assistant-1', 'ASSISTANT'), request, decision: 'APPROVE', effectiveDate: '2026-11-03' }).ok, false);
  assert.equal(access.decideAllocationRequest({ approver: staff('assistant-1', 'ASSISTANT'), request, decision: 'APPROVE', effectiveDate: '2026-11-03' }).reason, 'Only an active Manager or Engagement Partner can decide allocation requests.');
  assert.equal(access.decideAllocationRequest({ approver: staff('manager-1', 'MANAGER'), request, decision: 'DECLINE' }).ok, false);
});

test('Approved takeover ends the prior allocation the day before and keeps drafts with their original owner', () => {
  const request = access.createAllocationRequest({
    requester: staff('assistant-2', 'ASSISTANT'), project: { id: 'P1', firmId: 'F1' },
    reason: 'Assume the project after handover', takeover: true, requestedStartDate: '2026-11-05', id: 'REQ-2',
  }).request;
  const result = access.decideAllocationRequest({
    approver: staff('partner-1', 'PARTNER'), request, decision: 'APPROVE', effectiveDate: '2026-11-05',
    currentAssignments: [{ id: 'ASG-1', projectId: 'P1', staffId: 'assistant-1', role: 'PREPARER', startDate: '2026-10-01', endDate: null }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignmentChanges[0].endDate, '2026-11-04');
  assert.equal(result.assignmentChanges[0].projectId, 'P1');
  assert.deepEqual(result.assignmentChanges[1], { type: 'ADD', projectId: 'P1', firmId: 'F1', staffId: 'assistant-2', id: 'allocation-REQ-2', role: 'PREPARER', startDate: '2026-11-05', endDate: null, approvedBy: 'partner-1' });
  assert.equal(result.draftsRemainWithOriginalOwner, true);
});

test('Allocation decline requires a reason and leaves assignments unchanged', () => {
  const request = access.createAllocationRequest({
    requester: staff('assistant-1', 'ASSISTANT'), project: { id: 'P1', firmId: 'F1' },
    reason: 'Additional capacity needed', requestedStartDate: '2026-11-03', id: 'REQ-3',
  }).request;
  const declined = access.decideAllocationRequest({ approver: staff('manager-1', 'MANAGER'), request, decision: 'DECLINE', reason: 'Capacity is full' });
  assert.equal(declined.ok, true);
  assert.equal(declined.request.status, 'DECLINED');
  assert.deepEqual(declined.assignmentChanges, []);
});
