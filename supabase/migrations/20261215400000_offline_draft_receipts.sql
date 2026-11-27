-- The receipt and its draft or task comment commit in the same transaction.
create table erp_private.offline_draft_receipts (
 staff_id uuid not null references erp_private.staff_members,
 operation_id uuid not null,
 payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
 result jsonb not null check (jsonb_typeof(result) = 'object'),
 created_at timestamptz not null default now(),
 primary key (staff_id, operation_id)
);

alter table erp_private.offline_draft_receipts enable row level security;
alter table erp_private.offline_draft_receipts force row level security;
revoke all on erp_private.offline_draft_receipts from public, anon, authenticated, service_role;
grant select, insert on erp_private.offline_draft_receipts to erp_api;
create policy offline_receipt_read on erp_private.offline_draft_receipts
 for select to erp_api using (staff_id = (select (erp_private.actor()).staff_id));
create policy offline_receipt_write on erp_private.offline_draft_receipts
 for insert to erp_api with check (staff_id = (select (erp_private.actor()).staff_id));
