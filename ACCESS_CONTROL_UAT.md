# Client visibility, task access and allocation UAT

The access policy is in `access_control_core_v1.js`. The ERP loads it as
`window.PCLAccessControl` for the browser preview and the same functions can be
required from Node for automated UAT.

## Expected access

| Role | Client and project visibility | Work changes |
| --- | --- | --- |
| Engagement Partner | All records in authorised firms | Work must be allocated or sent as a review task; independent approval and posting remain separate actions. |
| Manager | All client and project records in authorised firms | May edit allocated or task-assigned work; approves work prepared by someone else. |
| Audit Supervisor | Read all client, project and working records allowed by the role matrix in authorised firms | Edits only allocated or task-assigned work. |
| Audit Assistant | Full client directory and project summaries; client details and working data open when allocated or sent a task | Prepares and submits assigned work; cannot approve their own work. |
| Intern | Client and project details only through a task assigned to them | Restricted to the task rights granted by the role matrix. |

Every record remains firm-scoped. A task recipient is granted access using the
task's assigned staff ID, and a reviewer must be explicitly recorded on the
submitted work. The review list should contain active Managers or Partners in
the same firm, excluding the preparer and last editor.

## Allocation workflow

1. A non-intern requests to join or take over a project and gives a reason and
   start date.
2. A different active Manager or Engagement Partner in the same firm approves
   or declines. Declines require a reason.
3. An approved takeover ends the current preparer's allocation the day before
   the new start date. Existing drafts keep their original owner until a
   separate reassignment is approved.
4. The decision, assignment changes and reviewer actions are written to the
   audit history by the ERP service.

`createAllocationRequest()` and `decideAllocationRequest()` return proposed
records and assignment changes; they do not write to storage. The main ERP
service must persist those changes in one transaction and append the audit
event.

## Automated test

Run from the repository root:

```sh
node --test tests/access_control_core.test.cjs
```

The suite covers visibility by role, task-recipient access, reviewer
independence, firm boundaries, allocation approval, takeover dates, decline
reasons and draft ownership.

## Production requirement

The current ERP is a browser preview. Loading this policy in the browser enables
UAT and hides or shows preview workboard rows, but it is not a security control.
Before production, the authenticated server must call `can()` on every read and
write, derive firm/project/task assignments from trusted database records, and
persist approval, posting and allocation transitions server-side. Do not rely
on browser role switching or local storage to grant production access.
