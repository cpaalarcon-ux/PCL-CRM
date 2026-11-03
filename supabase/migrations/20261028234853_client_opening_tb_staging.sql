-- Stage the opening trial balance against the client before project/task setup.
ALTER TABLE erp_private.documents
 ADD COLUMN import_purpose text NOT NULL DEFAULT 'General';

ALTER TABLE erp_private.documents
 ADD CONSTRAINT documents_import_purpose_check CHECK (
  import_purpose='General'
  OR (import_purpose='Opening TB' AND category='Import Sources' AND project_id IS NULL AND task_id IS NULL
      AND mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 );

ALTER TABLE erp_private.clients
 ADD COLUMN opening_balance_status text NOT NULL DEFAULT 'Pending',
 ADD COLUMN opening_balance_note text NOT NULL DEFAULT '',
 ADD COLUMN opening_balance_confirmed_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ADD COLUMN opening_balance_confirmed_at timestamptz;

ALTER TABLE erp_private.clients
 ADD CONSTRAINT client_opening_balance_state_check CHECK (
  (opening_balance_status='Pending' AND opening_balance_note='' AND opening_balance_confirmed_by IS NULL AND opening_balance_confirmed_at IS NULL)
  OR (opening_balance_status='No opening balances' AND length(btrim(opening_balance_note))>=10
      AND opening_balance_confirmed_by IS NOT NULL AND opening_balance_confirmed_at IS NOT NULL)
 );

CREATE INDEX documents_client_opening_tb_idx ON erp_private.documents(client_id,handling_firm_id,uploaded_at DESC)
 WHERE import_purpose='Opening TB' AND archived_at IS NULL AND deleted_at IS NULL;

