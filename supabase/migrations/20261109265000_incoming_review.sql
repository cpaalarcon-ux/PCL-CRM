-- Step 8 of the joined-practice review (2026-11-10): Incoming Review and linked documents (the internal side only).
--
-- What this adds:
--  * Two document categories: "Correspondence" and "KRA Notices". Nothing else is added to the 10 existing categories.
--  * A WhatsApp channel on the communications register, plus a direction (Incoming / Outgoing) and a sender address.
--  * Documents now record where they came from (source type), who may see them (confidentiality Normal / Restricted) and the message that
--    carried them (the originating communication).
--  * A holding area, incoming_items, for files that arrive before the client is known. documents.client_id stays mandatory: a file becomes a
--    document only when a reviewer accepts it and links it to a client. The queue is for Supervisors, Managers and Partners; Assistants,
--    Interns and administrators never see it (build 109).
--  * Review actions: choose the client, accept and link (category, firm, optional project / task / KRA notice / period / originating
--    message), request a replacement, reject. Nothing is deleted: a rejected item is archived with a reason.
--  * Sender matching against client contacts (phone or email): one client matched is routed; none or several goes to Needs Review.
--  * A duplicate check on the SHA-256 of the file, against filed documents and against other waiting items.
--  * document_links: a document can be linked to more than one record (more messages, projects, tasks, KRA notices, periods) with same-client
--    and same-firm checks. A link is removed with a reason; it is never deleted.
--  * Settings for the open Partner decisions, each shown as "Default - not yet confirmed" until a Partner confirms it in writing.
-- Live WhatsApp and mailbox connections need outside accounts and are NOT part of this step. Staff log a received file by hand.

-- 1. Categories, channel, direction, sender address and the new document columns.
ALTER TABLE erp_private.documents DROP CONSTRAINT documents_category_check;
ALTER TABLE erp_private.documents ADD CONSTRAINT documents_category_check CHECK(category IN ('Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports','Import Sources','KYC Pending','Correspondence','KRA Notices'));

ALTER TABLE erp_private.documents
 ADD COLUMN source_type text NOT NULL DEFAULT 'Upload' CHECK(source_type IN('Upload','WhatsApp','Email','Hand delivered','Post or courier')),
 ADD COLUMN confidentiality text NOT NULL DEFAULT 'Normal' CHECK(confidentiality IN('Normal','Restricted')),
 ADD COLUMN communication_id uuid REFERENCES erp_private.communications,
 ADD COLUMN incoming_item_id uuid;
CREATE INDEX documents_communication_idx ON erp_private.documents(communication_id) WHERE communication_id IS NOT NULL;
CREATE INDEX documents_sha256_idx ON erp_private.documents(sha256);

ALTER TABLE erp_private.communications DROP CONSTRAINT communications_channel_check;
ALTER TABLE erp_private.communications ADD CONSTRAINT communications_channel_check CHECK(channel IN('Letter','Email','WhatsApp','Call','Meeting','Visit','Internal note'));
ALTER TABLE erp_private.communications
 ADD COLUMN direction text CHECK(direction IN('Incoming','Outgoing')),
 ADD COLUMN sender_address text CHECK(sender_address IS NULL OR length(btrim(sender_address)) BETWEEN 3 AND 200),
 ADD CONSTRAINT communications_direction_channel CHECK((channel<>'WhatsApp' OR direction IS NOT NULL) AND (direction IS NULL OR channel IN('Letter','Email','WhatsApp','Call')));

-- 2. Settings (the open Partner decisions). All are defaults; none is confirmed.
CREATE TABLE erp_private.incoming_settings(
 setting_key text PRIMARY KEY,
 label text NOT NULL,
 int_value integer,
 text_value text,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed')),
 source_note text,
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((int_value IS NULL)<>(text_value IS NULL)),
 CHECK(rule_status='Suggested' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(COALESCE(source_note,'')))>=10)),
 CHECK(rule_status<>'Suggested' OR (confirmed_by IS NULL AND confirmed_at IS NULL))
);
CREATE INDEX incoming_settings_confirmed_by_idx ON erp_private.incoming_settings(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX incoming_settings_updated_by_idx ON erp_private.incoming_settings(updated_by) WHERE updated_by IS NOT NULL;
INSERT INTO erp_private.incoming_settings(setting_key,label,int_value,text_value) VALUES
 ('accept_min_role','The lowest role that may accept or reject an incoming file (SUPERVISOR, MANAGER or PARTNER)',NULL,'SUPERVISOR'),
 ('restricted_min_role','The lowest role that may see, accept or reject a Restricted incoming file or document (MANAGER or PARTNER)',NULL,'MANAGER'),
 ('kyc_route','Identity and KYC files: LEADERS_ONLY keeps them out of the Supervisor queue; SAME_QUEUE lets a Supervisor accept them into the KYC Pending holding category',NULL,'LEADERS_ONLY'),
 ('retention_days','Archived (rejected or unmatched) files are shown as past retention after this many days. Nothing is deleted automatically',365,NULL);
ALTER TABLE erp_private.incoming_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.incoming_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON erp_private.incoming_settings TO erp_api;
CREATE POLICY incoming_settings_read ON erp_private.incoming_settings FOR SELECT TO erp_api USING(true);
CREATE POLICY incoming_settings_update ON erp_private.incoming_settings FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');

CREATE FUNCTION erp_private.incoming_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_changed boolean;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF ROW(NEW.setting_key,NEW.label) IS DISTINCT FROM ROW(OLD.setting_key,OLD.label) THEN RAISE EXCEPTION 'A setting cannot be renamed' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change or confirm an incoming-file setting' USING ERRCODE='42501'; END IF;
 IF (NEW.int_value IS NULL)<>(OLD.int_value IS NULL) THEN RAISE EXCEPTION 'This setting holds %', CASE WHEN OLD.int_value IS NULL THEN 'text' ELSE 'a number' END USING ERRCODE='23514'; END IF;
 v_changed:=NEW.int_value IS DISTINCT FROM OLD.int_value OR NEW.text_value IS DISTINCT FROM OLD.text_value;
 IF v_changed THEN
  IF NEW.setting_key='accept_min_role' AND NEW.text_value NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Choose Supervisor, Manager or Partner' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='restricted_min_role' AND NEW.text_value NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Choose Manager or Partner' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='kyc_route' AND NEW.text_value NOT IN('LEADERS_ONLY','SAME_QUEUE') THEN RAISE EXCEPTION 'Choose LEADERS_ONLY or SAME_QUEUE' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='retention_days' AND (NEW.int_value<30 OR NEW.int_value>3650) THEN RAISE EXCEPTION 'Use a number of days from 30 to 3650' USING ERRCODE='23514'; END IF;
  IF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN RAISE EXCEPTION 'Change the value first; a Partner then records the confirmation' USING ERRCODE='23514'; END IF;
  NEW.rule_status:='Suggested';NEW.confirmed_by:=NULL;NEW.confirmed_at:=NULL;NEW.source_note:=NULL;NEW.updated_by:=v_actor;
 ELSIF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN
  IF NEW.rule_status<>'Confirmed' THEN RAISE EXCEPTION 'A confirmation is withdrawn by changing the value' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the confirmation must be the signed-in Partner' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.source_note,'')))<10 THEN RAISE EXCEPTION 'Say who confirmed this and where it is written (at least 10 characters)' USING ERRCODE='23514'; END IF;
  NEW.confirmed_at:=now();NEW.updated_by:=v_actor;
 ELSIF ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.source_note) IS DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at,OLD.source_note) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be edited' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER incoming_guard BEFORE UPDATE ON erp_private.incoming_settings FOR EACH ROW EXECUTE FUNCTION erp_private.incoming_settings_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.incoming_settings FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.incoming_settings FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER UPDATE ON erp_private.incoming_settings FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('setting_key');

CREATE FUNCTION erp_private.incoming_int(p_key text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT int_value FROM erp_private.incoming_settings WHERE setting_key=p_key
$$;
CREATE FUNCTION erp_private.incoming_txt(p_key text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT text_value FROM erp_private.incoming_settings WHERE setting_key=p_key
$$;
-- Role rank: Partner 3, Manager 2, Supervisor 1, everyone else 0 (Assistants, Interns and administrators never handle incoming files).
CREATE FUNCTION erp_private.incoming_rank(p_category text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE p_category WHEN 'PARTNER' THEN 3 WHEN 'MANAGER' THEN 2 WHEN 'SUPERVISOR' THEN 1 ELSE 0 END
$$;
CREATE FUNCTION erp_private.incoming_my_rank() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT erp_private.incoming_rank((erp_private.actor()).category_code)
$$;
-- May the signed-in person see Restricted material?
CREATE FUNCTION erp_private.incoming_restricted_ok() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT erp_private.incoming_my_rank()>=erp_private.incoming_rank(erp_private.incoming_txt('restricted_min_role'))
$$;
-- Phone numbers are compared on their last nine digits (0712 345 678, +254712345678 and 254712345678 are the same number).
CREATE FUNCTION erp_private.incoming_norm_phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p IS NULL OR position('@' in p)>0 THEN NULL
  WHEN length(regexp_replace(p,'\D','','g'))>=9 THEN right(regexp_replace(p,'\D','','g'),9) ELSE NULL END
$$;
CREATE FUNCTION erp_private.incoming_norm_email(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p IS NOT NULL AND position('@' in p)>0 THEN lower(btrim(p)) ELSE NULL END
$$;
CREATE FUNCTION erp_private.incoming_norm_key(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT COALESCE(erp_private.incoming_norm_email(p),erp_private.incoming_norm_phone(p))
$$;

-- 3. The holding area.
CREATE TABLE erp_private.incoming_items(
 item_id uuid PRIMARY KEY,
 source_type text NOT NULL CHECK(source_type IN('WhatsApp','Email','Hand delivered','Post or courier')),
 sender_name text CHECK(sender_name IS NULL OR length(btrim(sender_name)) BETWEEN 1 AND 200),
 sender_address text CHECK(sender_address IS NULL OR length(btrim(sender_address)) BETWEEN 3 AND 200),
 sender_key text,
 received_at timestamptz NOT NULL,
 subject text NOT NULL CHECK(length(btrim(subject)) BETWEEN 3 AND 200),
 message_text text NOT NULL DEFAULT '' CHECK(length(message_text)<=8000),
 file_name text NOT NULL CHECK(btrim(file_name)<>''),
 object_key text NOT NULL UNIQUE CHECK(btrim(object_key)<>'' AND object_key !~ '(^/|(^|/)\.\.(/|$)|://)'),
 file_size_bytes bigint NOT NULL CHECK(file_size_bytes>0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 mime_type text NOT NULL,
 is_kyc boolean NOT NULL DEFAULT false,
 confidentiality text NOT NULL DEFAULT 'Normal' CHECK(confidentiality IN('Normal','Restricted')),
 client_id uuid REFERENCES erp_private.clients,
 contact_id uuid REFERENCES erp_private.client_contacts,
 match_result text NOT NULL CHECK(match_result IN('One match','No match','Several matches','Chosen by staff')),
 match_count integer NOT NULL DEFAULT 0 CHECK(match_count>=0),
 duplicate_document_id uuid REFERENCES erp_private.documents,
 duplicate_item_id uuid REFERENCES erp_private.incoming_items,
 status text NOT NULL DEFAULT 'Needs Review' CHECK(status IN('Received','Needs Review','Accepted and Linked','Archived')),
 logged_by uuid NOT NULL REFERENCES erp_private.staff_members,
 logged_at timestamptz NOT NULL DEFAULT now(),
 category text,
 handling_firm_id uuid REFERENCES erp_private.firms,
 project_id uuid REFERENCES erp_private.projects,
 task_id uuid REFERENCES erp_private.tasks,
 kra_case_id uuid REFERENCES erp_private.kra_cases,
 period_start date,
 period_end date,
 communication_id uuid REFERENCES erp_private.communications,
 document_id uuid REFERENCES erp_private.documents,
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 decision_note text,
 resolution text CHECK(resolution IN('Accepted','Rejected','Replacement requested','Duplicate','Withdrawn')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 deleted_at timestamptz,
 CHECK((period_start IS NULL)=(period_end IS NULL) AND (period_start IS NULL OR period_end>=period_start)),
 CHECK(status NOT IN('Received') OR (client_id IS NOT NULL)),
 CHECK((status='Accepted and Linked')=(document_id IS NOT NULL)),
 CHECK(status NOT IN('Accepted and Linked','Archived') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND resolution IS NOT NULL)),
 CHECK((status<>'Accepted and Linked') OR resolution='Accepted'),
 CHECK((status<>'Archived') OR (resolution IN('Rejected','Replacement requested','Duplicate','Withdrawn') AND length(btrim(COALESCE(decision_note,'')))>=10))
);
CREATE INDEX incoming_items_status_idx ON erp_private.incoming_items(status,received_at);
CREATE INDEX incoming_items_client_idx ON erp_private.incoming_items(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX incoming_items_sha_idx ON erp_private.incoming_items(sha256);
CREATE INDEX incoming_items_logged_by_idx ON erp_private.incoming_items(logged_by);
CREATE INDEX incoming_items_document_idx ON erp_private.incoming_items(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX incoming_items_dup_item_idx ON erp_private.incoming_items(duplicate_item_id) WHERE duplicate_item_id IS NOT NULL;
CREATE INDEX incoming_items_dup_doc_idx ON erp_private.incoming_items(duplicate_document_id) WHERE duplicate_document_id IS NOT NULL;
CREATE INDEX incoming_items_contact_idx ON erp_private.incoming_items(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX incoming_items_decided_by_idx ON erp_private.incoming_items(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX incoming_items_firm_idx ON erp_private.incoming_items(handling_firm_id) WHERE handling_firm_id IS NOT NULL;
CREATE INDEX incoming_items_project_idx ON erp_private.incoming_items(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX incoming_items_task_idx ON erp_private.incoming_items(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX incoming_items_kra_idx ON erp_private.incoming_items(kra_case_id) WHERE kra_case_id IS NOT NULL;
CREATE INDEX incoming_items_comm_idx ON erp_private.incoming_items(communication_id) WHERE communication_id IS NOT NULL;

ALTER TABLE erp_private.documents ADD CONSTRAINT documents_incoming_item_fk FOREIGN KEY(incoming_item_id) REFERENCES erp_private.incoming_items;
CREATE INDEX documents_incoming_item_idx ON erp_private.documents(incoming_item_id) WHERE incoming_item_id IS NOT NULL;

-- Who may see an incoming item (also used by the row policy):
--  * Supervisor, Manager, Partner only. Restricted items need the restricted role. KYC items follow the KYC route setting.
--  * An item with no client yet is visible to all reviewers; once a client is set, the reviewer must have access to that client and
--    must be allowed to handle that client's external communication (build 109).
CREATE FUNCTION erp_private.incoming_can_see(p_client uuid,p_conf text,p_kyc boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE
  WHEN erp_private.incoming_my_rank()<1 THEN false
  WHEN p_conf='Restricted' AND NOT erp_private.incoming_restricted_ok() THEN false
  WHEN p_kyc AND erp_private.incoming_txt('kyc_route')='LEADERS_ONLY' AND erp_private.incoming_my_rank()<2 THEN false
  WHEN p_client IS NULL THEN true
  ELSE erp_private.client_allowed(p_client) AND erp_private.comm_external_allowed(p_client) END
$$;

ALTER TABLE erp_private.incoming_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.incoming_items FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.incoming_items TO erp_api;
CREATE POLICY incoming_items_read ON erp_private.incoming_items FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.incoming_can_see(client_id,confidentiality,is_kyc));

CREATE FUNCTION erp_private.incoming_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.item_id,NEW.source_type,NEW.sender_name,NEW.sender_address,NEW.sender_key,NEW.received_at,NEW.subject,NEW.message_text,NEW.file_name,NEW.object_key,NEW.file_size_bytes,NEW.sha256,NEW.mime_type,NEW.logged_by,NEW.logged_at)
     IS DISTINCT FROM ROW(OLD.item_id,OLD.source_type,OLD.sender_name,OLD.sender_address,OLD.sender_key,OLD.received_at,OLD.subject,OLD.message_text,OLD.file_name,OLD.object_key,OLD.file_size_bytes,OLD.sha256,OLD.mime_type,OLD.logged_by,OLD.logged_at) THEN
   RAISE EXCEPTION 'The file and the message details of an incoming item cannot change. Reject it and log it again if it was logged wrongly' USING ERRCODE='23514'; END IF;
  IF OLD.status IN('Accepted and Linked','Archived') THEN
   RAISE EXCEPTION 'This incoming item is already %; it can no longer change',lower(OLD.status) USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER incoming_items_guard BEFORE INSERT OR UPDATE ON erp_private.incoming_items FOR EACH ROW EXECUTE FUNCTION erp_private.incoming_items_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.incoming_items FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.incoming_items FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.incoming_items FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('item_id');

-- 4. Links from a document to more than one record.
CREATE TABLE erp_private.document_links(
 link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES erp_private.documents,
 communication_id uuid REFERENCES erp_private.communications,
 project_id uuid REFERENCES erp_private.projects,
 task_id uuid REFERENCES erp_private.tasks,
 kra_case_id uuid REFERENCES erp_private.kra_cases,
 period_start date,
 period_end date,
 note text CHECK(note IS NULL OR length(note)<=500),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,
 removed_by uuid REFERENCES erp_private.staff_members,
 removal_reason text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(num_nonnulls(communication_id,project_id,task_id,kra_case_id,period_start)=1),
 CHECK((period_start IS NULL)=(period_end IS NULL) AND (period_start IS NULL OR period_end>=period_start)),
 CHECK((removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL) OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND length(btrim(COALESCE(removal_reason,'')))>=10))
);
CREATE UNIQUE INDEX document_links_unique ON erp_private.document_links(document_id,COALESCE(communication_id,project_id,task_id,kra_case_id,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE(period_start,'0001-01-01'::date),COALESCE(period_end,'0001-01-01'::date)) WHERE removed_at IS NULL;
CREATE INDEX document_links_doc_idx ON erp_private.document_links(document_id);
CREATE INDEX document_links_comm_idx ON erp_private.document_links(communication_id) WHERE communication_id IS NOT NULL;
CREATE INDEX document_links_project_idx ON erp_private.document_links(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX document_links_task_idx ON erp_private.document_links(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX document_links_kra_idx ON erp_private.document_links(kra_case_id) WHERE kra_case_id IS NOT NULL;
CREATE INDEX document_links_created_by_idx ON erp_private.document_links(created_by);
CREATE INDEX document_links_removed_by_idx ON erp_private.document_links(removed_by) WHERE removed_by IS NOT NULL;

ALTER TABLE erp_private.document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.document_links FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.document_links TO erp_api;
-- A link is visible to anyone who can see its document (the documents policy applies inside the sub-select).
CREATE POLICY document_links_read ON erp_private.document_links FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_links.document_id));

-- Same client and same firm. Runs with definer rights because the targets are hidden from some staff by row security.
CREATE FUNCTION erp_private.document_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d record;ok boolean:=true;
BEGIN
 SELECT client_id,handling_firm_id INTO d FROM erp_private.documents WHERE document_id=NEW.document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That document does not exist' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.document_id,NEW.communication_id,NEW.project_id,NEW.task_id,NEW.kra_case_id,NEW.period_start,NEW.period_end,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.document_id,OLD.communication_id,OLD.project_id,OLD.task_id,OLD.kra_case_id,OLD.period_start,OLD.period_end,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'A link cannot be changed. Remove it with a reason and add another' USING ERRCODE='23514'; END IF;
  IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'This link has already been removed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.communication_id IS NOT NULL THEN
  ok:=EXISTS(SELECT 1 FROM erp_private.communications c WHERE c.communication_id=NEW.communication_id AND c.client_id=d.client_id AND c.firm_id=d.handling_firm_id AND c.deleted_at IS NULL);
 ELSIF NEW.project_id IS NOT NULL THEN
  ok:=EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=d.client_id AND p.handling_firm_id=d.handling_firm_id AND p.deleted_at IS NULL);
 ELSIF NEW.task_id IS NOT NULL THEN
  ok:=EXISTS(SELECT 1 FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id WHERE t.task_id=NEW.task_id AND p.client_id=d.client_id AND p.handling_firm_id=d.handling_firm_id AND t.deleted_at IS NULL);
 ELSIF NEW.kra_case_id IS NOT NULL THEN
  ok:=EXISTS(SELECT 1 FROM erp_private.kra_cases k WHERE k.case_id=NEW.kra_case_id AND k.client_id=d.client_id AND k.handling_firm_id=d.handling_firm_id);
 END IF;
 IF NOT ok THEN RAISE EXCEPTION 'A document can only be linked to a record of the same client and the same firm' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_links_guard BEFORE INSERT OR UPDATE ON erp_private.document_links FOR EACH ROW EXECUTE FUNCTION erp_private.document_link_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.document_links FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.document_links FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.document_links FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('link_id');

-- The originating communication of a document must belong to the same client and firm.
CREATE FUNCTION erp_private.document_comm_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.source_type,NEW.incoming_item_id,NEW.communication_id,NEW.confidentiality) IS DISTINCT FROM ROW(OLD.source_type,OLD.incoming_item_id,OLD.communication_id,OLD.confidentiality)
    AND current_user='erp_api' THEN
  RAISE EXCEPTION 'Where a document came from, its confidentiality and its originating message cannot be edited here' USING ERRCODE='23514'; END IF;
 IF NEW.communication_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.communication_id IS DISTINCT FROM OLD.communication_id) THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.communications c WHERE c.communication_id=NEW.communication_id AND c.client_id=NEW.client_id AND c.firm_id=NEW.handling_firm_id AND c.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'The originating communication must belong to the same client and firm as the document' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER documents_comm_guard BEFORE INSERT OR UPDATE ON erp_private.documents FOR EACH ROW EXECUTE FUNCTION erp_private.document_comm_guard();

-- 5. Row security for the new document rules.
-- Supervisors file correspondence and KRA notices under a project they can see (like other Supervisor evidence);
-- Restricted documents are visible only to the restricted role and above.
CREATE OR REPLACE FUNCTION erp_private.document_allowed(c uuid,f uuid,p uuid,t uuid,cat text,writing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT erp_private.firm_allowed(f) AND (
 (erp_private.is_leader() AND erp_private.client_allowed(c)) OR
 ((erp_private.actor()).category_code='SUPERVISOR' AND erp_private.project_allowed(p)
 AND cat IN ('Current Year Audit','Tax Returns','Working Papers','PBC Documents','Import Sources','Correspondence','KRA Notices')) OR
 ((erp_private.actor()).category_code IN ('ASSISTANT','INTERN') AND (cat='Working Papers' OR cat='Import Sources' AND (erp_private.actor()).category_code='ASSISTANT')
 AND (NOT writing OR (erp_private.actor()).category_code='ASSISTANT')
 AND EXISTS(SELECT 1 FROM erp_private.tasks x WHERE x.task_id=t AND x.assigned_to=(erp_private.actor()).staff_id AND erp_private.task_allowed(t))) OR
 (writing AND cat='KYC Pending' AND p IS NULL AND t IS NULL AND (erp_private.actor()).category_code IN ('ASSISTANT','SUPERVISOR') AND erp_private.client_allowed(c)))
$$;
ALTER POLICY documents_read ON erp_private.documents USING(deleted_at IS NULL AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false) AND (confidentiality='Normal' OR erp_private.incoming_restricted_ok()));

-- The KRA notice screen lists a client's filed documents with definer rights: keep Restricted files out of it for staff who may not see them.
CREATE OR REPLACE FUNCTION erp_private.kra_document_ok(p_document uuid,p_client uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=p_document AND d.client_id=p_client AND d.deleted_at IS NULL AND d.archived_at IS NULL AND d.category<>'KYC Pending'
  AND (d.confidentiality='Normal' OR erp_private.incoming_restricted_ok()))
$$;
CREATE OR REPLACE FUNCTION erp_private.kra_client_documents(p_client uuid) RETURNS TABLE(document_id uuid,file_name text,category text,uploaded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT d.document_id,d.file_name,d.category,d.uploaded_at FROM erp_private.documents d
 WHERE d.client_id=p_client AND d.deleted_at IS NULL AND d.archived_at IS NULL AND d.category<>'KYC Pending'
  AND (d.confidentiality='Normal' OR erp_private.incoming_restricted_ok())
  AND erp_private.client_allowed(p_client) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
 ORDER BY d.uploaded_at DESC LIMIT 200
$$;

-- 6. Sender matching and the duplicate check.
CREATE FUNCTION erp_private.incoming_matches(p_key text) RETURNS TABLE(client_id uuid,contact_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT c.client_id,c.contact_id FROM erp_private.client_contacts c JOIN erp_private.clients cl ON cl.client_id=c.client_id
 WHERE p_key IS NOT NULL AND p_key<>'' AND c.deleted_at IS NULL AND cl.deleted_at IS NULL
  AND (erp_private.incoming_norm_phone(c.phone_number)=p_key OR erp_private.incoming_norm_email(c.email_address)=p_key)
  AND erp_private.client_allowed(c.client_id) AND erp_private.comm_external_allowed(c.client_id)
$$;

-- Log a received file by hand (and, later, a connection can call the same function). The file is already in storage under p_object_key.
CREATE FUNCTION erp_private.incoming_register(p_item uuid,p_source text,p_sender_name text,p_sender_address text,p_received_at timestamptz,p_subject text,p_message text,
 p_file_name text,p_object_key text,p_size bigint,p_sha256 text,p_mime text,p_is_kyc boolean,p_client uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_key text;v_clients uuid[];v_contacts uuid[];v_client uuid;v_contact uuid;v_result text;v_count int;
 v_dup_doc uuid;v_dup_item uuid;v_status text;v_conf text:='Normal';
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR erp_private.incoming_rank(a.category_code)<1 THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner can log an incoming file' USING ERRCODE='42501'; END IF;
 IF p_source NOT IN('WhatsApp','Email','Hand delivered','Post or courier') THEN RAISE EXCEPTION 'Choose how the file was received' USING ERRCODE='22023'; END IF;
 IF p_is_kyc AND erp_private.incoming_txt('kyc_route')='LEADERS_ONLY' AND erp_private.incoming_rank(a.category_code)<2 THEN
  RAISE EXCEPTION 'Identity and KYC files are logged by a Manager or Partner' USING ERRCODE='42501'; END IF;
 v_key:=erp_private.incoming_norm_key(p_sender_address);
 IF p_client IS NOT NULL THEN
  IF NOT (erp_private.client_allowed(p_client) AND erp_private.comm_external_allowed(p_client)) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
  v_client:=p_client;v_result:='Chosen by staff';v_count:=1;
  SELECT array_agg(m.contact_id) INTO v_contacts FROM erp_private.incoming_matches(v_key) m WHERE m.client_id=p_client;
  IF COALESCE(array_length(v_contacts,1),0)=1 THEN v_contact:=v_contacts[1]; END IF;
 ELSE
  SELECT array_agg(DISTINCT m.client_id) INTO v_clients FROM erp_private.incoming_matches(v_key) m;
  v_count:=COALESCE(array_length(v_clients,1),0);
  IF v_count=1 THEN
   v_client:=v_clients[1];v_result:='One match';
   SELECT array_agg(m.contact_id) INTO v_contacts FROM erp_private.incoming_matches(v_key) m WHERE m.client_id=v_client;
   IF COALESCE(array_length(v_contacts,1),0)=1 THEN v_contact:=v_contacts[1]; END IF;
  ELSIF v_count=0 THEN v_result:='No match';
  ELSE v_result:='Several matches'; END IF;
 END IF;
 SELECT d.document_id INTO v_dup_doc FROM erp_private.documents d WHERE d.sha256=p_sha256 AND d.deleted_at IS NULL AND d.archived_at IS NULL
  AND erp_private.client_allowed(d.client_id) AND (d.confidentiality='Normal' OR erp_private.incoming_restricted_ok()) ORDER BY d.uploaded_at LIMIT 1;
 SELECT i.item_id INTO v_dup_item FROM erp_private.incoming_items i WHERE i.sha256=p_sha256 AND i.item_id<>p_item AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review','Accepted and Linked')
  AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc) ORDER BY i.logged_at LIMIT 1;
 v_status:=CASE WHEN v_client IS NOT NULL AND v_dup_doc IS NULL AND v_dup_item IS NULL THEN 'Received' ELSE 'Needs Review' END;
 INSERT INTO erp_private.incoming_items(item_id,source_type,sender_name,sender_address,sender_key,received_at,subject,message_text,file_name,object_key,file_size_bytes,sha256,mime_type,
  is_kyc,confidentiality,client_id,contact_id,match_result,match_count,duplicate_document_id,duplicate_item_id,status,logged_by)
 VALUES(p_item,p_source,NULLIF(btrim(COALESCE(p_sender_name,'')),''),NULLIF(btrim(COALESCE(p_sender_address,'')),''),v_key,p_received_at,btrim(p_subject),COALESCE(p_message,''),p_file_name,p_object_key,p_size,p_sha256,p_mime,
  COALESCE(p_is_kyc,false),v_conf,v_client,v_contact,v_result,v_count,v_dup_doc,v_dup_item,v_status,a.staff_id);
 RETURN jsonb_build_object('item_id',p_item,'status',v_status,'match_result',v_result,'match_count',v_count,'client_id',v_client,'duplicate_document_id',v_dup_doc,'duplicate_item_id',v_dup_item);
END $$;

-- The reviewer picks (or changes) the client.
CREATE FUNCTION erp_private.incoming_choose_client(p_item uuid,p_client uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE it erp_private.incoming_items;v_contacts uuid[];v_contact uuid;
BEGIN
 SELECT * INTO it FROM erp_private.incoming_items WHERE item_id=p_item AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT erp_private.incoming_can_see(it.client_id,it.confidentiality,it.is_kyc) THEN RAISE EXCEPTION 'That incoming file is not available to you' USING ERRCODE='42501'; END IF;
 IF it.status NOT IN('Received','Needs Review') THEN RAISE EXCEPTION 'This incoming file is already %',lower(it.status) USING ERRCODE='23514'; END IF;
 IF erp_private.incoming_my_rank()<erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role')) THEN RAISE EXCEPTION 'Your role may not review incoming files (a Partner sets this)' USING ERRCODE='42501'; END IF;
 IF NOT (erp_private.client_allowed(p_client) AND erp_private.comm_external_allowed(p_client)) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 SELECT array_agg(m.contact_id) INTO v_contacts FROM erp_private.incoming_matches(it.sender_key) m WHERE m.client_id=p_client;
 IF COALESCE(array_length(v_contacts,1),0)=1 THEN v_contact:=v_contacts[1]; END IF;
 UPDATE erp_private.incoming_items SET client_id=p_client,contact_id=v_contact,match_result='Chosen by staff',
  status=CASE WHEN duplicate_document_id IS NULL AND duplicate_item_id IS NULL THEN 'Received' ELSE 'Needs Review' END
 WHERE item_id=p_item;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Mark an item Restricted or as identity / KYC evidence. Marking an item Restricted can hide it from the person who marked it:
-- that is the point (it passes to the restricted role).
CREATE FUNCTION erp_private.incoming_set_handling(p_item uuid,p_confidentiality text,p_is_kyc boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE it erp_private.incoming_items;
BEGIN
 SELECT * INTO it FROM erp_private.incoming_items WHERE item_id=p_item AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT erp_private.incoming_can_see(it.client_id,it.confidentiality,it.is_kyc) THEN RAISE EXCEPTION 'That incoming file is not available to you' USING ERRCODE='42501'; END IF;
 IF it.status NOT IN('Received','Needs Review') THEN RAISE EXCEPTION 'This incoming file is already %',lower(it.status) USING ERRCODE='23514'; END IF;
 IF erp_private.incoming_my_rank()<erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role')) THEN RAISE EXCEPTION 'Your role may not review incoming files (a Partner sets this)' USING ERRCODE='42501'; END IF;
 IF p_confidentiality NOT IN('Normal','Restricted') THEN RAISE EXCEPTION 'Choose Normal or Restricted. The Forensic level is not offered until the forensic file exists' USING ERRCODE='22023'; END IF;
 UPDATE erp_private.incoming_items SET confidentiality=p_confidentiality,is_kyc=COALESCE(p_is_kyc,is_kyc) WHERE item_id=p_item;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Accept and link: the file becomes a document of the chosen client.
CREATE FUNCTION erp_private.incoming_accept(p_item uuid,p_client uuid,p_firm uuid,p_category text,p_project uuid,p_task uuid,p_kra_case uuid,
 p_period_start date,p_period_end date,p_confidentiality text,p_communication uuid,p_create_comm boolean,p_comm_reference text,p_comm_request uuid,
 p_confirm_duplicate boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r int;it erp_private.incoming_items;v_conf text;v_cat text;v_comm uuid;v_doc uuid:=gen_random_uuid();v_channel text;v_dup uuid;
 v_proj record;v_contact uuid;v_note text:=NULLIF(btrim(COALESCE(p_note,'')),'');
BEGIN
 a:=erp_private.actor();r:=erp_private.incoming_rank(a.category_code);
 SELECT * INTO it FROM erp_private.incoming_items WHERE item_id=p_item AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT erp_private.incoming_can_see(it.client_id,it.confidentiality,it.is_kyc) THEN RAISE EXCEPTION 'That incoming file is not available to you' USING ERRCODE='42501'; END IF;
 IF it.status NOT IN('Received','Needs Review') THEN RAISE EXCEPTION 'This incoming file is already %',lower(it.status) USING ERRCODE='23514'; END IF;
 IF r<erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role')) THEN RAISE EXCEPTION 'Your role may not accept incoming files (a Partner sets this)' USING ERRCODE='42501'; END IF;
 v_conf:=COALESCE(p_confidentiality,it.confidentiality);
 IF v_conf NOT IN('Normal','Restricted') THEN RAISE EXCEPTION 'Choose Normal or Restricted' USING ERRCODE='22023'; END IF;
 IF v_conf='Restricted' AND NOT erp_private.incoming_restricted_ok() THEN RAISE EXCEPTION 'A Restricted file is accepted by a Manager or Partner (a Partner sets this)' USING ERRCODE='42501'; END IF;
 IF it.confidentiality='Restricted' AND v_conf='Normal' AND NOT erp_private.incoming_restricted_ok() THEN RAISE EXCEPTION 'Only the restricted role can lower the confidentiality' USING ERRCODE='42501'; END IF;
 IF it.is_kyc AND erp_private.incoming_txt('kyc_route')='LEADERS_ONLY' AND r<2 THEN RAISE EXCEPTION 'Identity and KYC files are accepted by a Manager or Partner' USING ERRCODE='42501'; END IF;
 IF p_client IS NULL THEN RAISE EXCEPTION 'Choose the client first' USING ERRCODE='22023'; END IF;
 IF NOT (erp_private.client_allowed(p_client) AND erp_private.comm_external_allowed(p_client)) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 IF p_firm IS NULL OR NOT erp_private.firm_allowed(p_firm) OR NOT erp_private.kra_firm_handles(p_client,p_firm) THEN RAISE EXCEPTION 'Choose a firm that handles this client and that you may work in' USING ERRCODE='22023'; END IF;
 -- Category rules.
 IF it.is_kyc THEN
  IF p_project IS NOT NULL OR p_task IS NOT NULL THEN RAISE EXCEPTION 'An identity or KYC file is filed at client level, not under a project or task' USING ERRCODE='22023'; END IF;
  v_cat:=CASE WHEN r>=2 THEN 'Permanent File' ELSE 'KYC Pending' END;
 ELSE
  v_cat:=p_category;
  IF v_cat IS NULL OR v_cat NOT IN('Correspondence','KRA Notices','Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports') THEN
   RAISE EXCEPTION 'Choose a document category' USING ERRCODE='22023'; END IF;
  IF r<2 AND v_cat NOT IN('Correspondence','KRA Notices') AND NOT (v_cat IN('Current Year Audit','Tax Returns','Working Papers','PBC Documents') AND p_project IS NOT NULL) THEN
   RAISE EXCEPTION 'A Supervisor files correspondence and KRA notices at client level, and other evidence under a project. A Manager or Partner files the rest' USING ERRCODE='42501'; END IF;
 END IF;
 -- Project and task.
 IF p_task IS NOT NULL AND p_project IS NULL THEN RAISE EXCEPTION 'Choose a project before choosing a task' USING ERRCODE='22023'; END IF;
 IF p_project IS NOT NULL THEN
  SELECT project_id,client_id,handling_firm_id,status INTO v_proj FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
  IF NOT FOUND OR NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'That project is not available to you' USING ERRCODE='42501'; END IF;
  IF v_proj.client_id<>p_client OR v_proj.handling_firm_id<>p_firm THEN RAISE EXCEPTION 'The project must belong to the chosen client and firm' USING ERRCODE='22023'; END IF;
  IF v_proj.status='Archived' THEN RAISE EXCEPTION 'That project is archived. Choose an open project' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_task IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=p_task AND t.project_id=p_project AND t.deleted_at IS NULL) OR NOT erp_private.task_allowed(p_task) THEN
   RAISE EXCEPTION 'That task is not available, or is not on the chosen project' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_kra_case IS NOT NULL THEN
  IF NOT erp_private.kra_case_allowed(p_kra_case) OR NOT EXISTS(SELECT 1 FROM erp_private.kra_cases k WHERE k.case_id=p_kra_case AND k.client_id=p_client AND k.handling_firm_id=p_firm) THEN
   RAISE EXCEPTION 'That KRA notice is not available, or belongs to another client or firm' USING ERRCODE='22023'; END IF;
 END IF;
 IF (p_period_start IS NULL)<>(p_period_end IS NULL) OR (p_period_start IS NOT NULL AND p_period_end<p_period_start) THEN RAISE EXCEPTION 'Give both ends of the period, the end on or after the start' USING ERRCODE='22023'; END IF;
 -- Duplicate check against what is already filed for this client.
 SELECT d.document_id INTO v_dup FROM erp_private.documents d WHERE d.client_id=p_client AND d.sha256=it.sha256 AND d.deleted_at IS NULL AND d.archived_at IS NULL LIMIT 1;
 IF v_dup IS NOT NULL AND NOT COALESCE(p_confirm_duplicate,false) THEN
  RAISE EXCEPTION 'This exact file is already filed for this client. Confirm to file it again, or reject it as a duplicate' USING ERRCODE='23505'; END IF;
 -- The message that carried the file.
 IF p_communication IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.communications c WHERE c.communication_id=p_communication AND c.client_id=p_client AND c.firm_id=p_firm AND c.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'The linked communication must belong to the chosen client and firm' USING ERRCODE='22023'; END IF;
  v_comm:=p_communication;
 ELSIF COALESCE(p_create_comm,false) THEN
  IF p_comm_reference IS NULL OR p_comm_request IS NULL THEN RAISE EXCEPTION 'A communication needs a reference' USING ERRCODE='22023'; END IF;
  v_channel:=CASE it.source_type WHEN 'WhatsApp' THEN 'WhatsApp' WHEN 'Email' THEN 'Email' ELSE 'Letter' END;
  SELECT contact_id INTO v_contact FROM erp_private.client_contacts WHERE contact_id=it.contact_id AND client_id=p_client AND deleted_at IS NULL;
  INSERT INTO erp_private.communications(request_id,reference,client_id,firm_id,project_id,contact_id,channel,direction,sender_address,subject,purpose,details,communication_date,signatory_id,owner_id,status)
  VALUES(p_comm_request,p_comm_reference,p_client,p_firm,p_project,v_contact,v_channel,'Incoming',it.sender_address,it.subject,'Incoming file',
   COALESCE(NULLIF(btrim(it.message_text),''),'File received: '||it.file_name),(it.received_at AT TIME ZONE 'Africa/Nairobi')::date,a.staff_id,a.staff_id,'Open')
  RETURNING communication_id INTO v_comm;
 END IF;
 INSERT INTO erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by,
  source_type,confidentiality,communication_id,incoming_item_id)
 VALUES(v_doc,p_client,p_firm,p_project,p_task,v_cat,it.file_name,it.object_key,it.file_size_bytes,it.sha256,it.mime_type,a.staff_id,it.source_type,v_conf,v_comm,p_item);
 IF p_kra_case IS NOT NULL THEN
  INSERT INTO erp_private.document_links(document_id,kra_case_id,note,created_by) VALUES(v_doc,p_kra_case,'Linked when the incoming file was accepted',a.staff_id);
 END IF;
 IF p_period_start IS NOT NULL THEN
  INSERT INTO erp_private.document_links(document_id,period_start,period_end,note,created_by) VALUES(v_doc,p_period_start,p_period_end,'Linked when the incoming file was accepted',a.staff_id);
 END IF;
 UPDATE erp_private.incoming_items SET client_id=p_client,confidentiality=v_conf,status='Accepted and Linked',category=v_cat,handling_firm_id=p_firm,project_id=p_project,task_id=p_task,kra_case_id=p_kra_case,
  period_start=p_period_start,period_end=p_period_end,communication_id=v_comm,document_id=v_doc,decided_by=a.staff_id,decided_at=now(),decision_note=v_note,resolution='Accepted'
 WHERE item_id=p_item;
 RETURN jsonb_build_object('ok',true,'document_id',v_doc,'communication_id',v_comm,'category',v_cat);
END $$;

-- Reject, ask for a replacement, or mark as a duplicate. The item is archived with a reason; the file stays in storage.
CREATE FUNCTION erp_private.incoming_archive(p_item uuid,p_resolution text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;it erp_private.incoming_items;why text:=btrim(COALESCE(p_reason,''));
BEGIN
 a:=erp_private.actor();
 SELECT * INTO it FROM erp_private.incoming_items WHERE item_id=p_item AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT erp_private.incoming_can_see(it.client_id,it.confidentiality,it.is_kyc) THEN RAISE EXCEPTION 'That incoming file is not available to you' USING ERRCODE='42501'; END IF;
 IF it.status NOT IN('Received','Needs Review') THEN RAISE EXCEPTION 'This incoming file is already %',lower(it.status) USING ERRCODE='23514'; END IF;
 IF erp_private.incoming_my_rank()<erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role')) THEN RAISE EXCEPTION 'Your role may not reject incoming files (a Partner sets this)' USING ERRCODE='42501'; END IF;
 IF p_resolution NOT IN('Rejected','Replacement requested','Duplicate','Withdrawn') THEN RAISE EXCEPTION 'Choose Rejected, Replacement requested, Duplicate or Withdrawn' USING ERRCODE='22023'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'Write the reason in at least 10 characters' USING ERRCODE='22023'; END IF;
 UPDATE erp_private.incoming_items SET status='Archived',resolution=p_resolution,decision_note=why,decided_by=a.staff_id,decided_at=now() WHERE item_id=p_item;
 RETURN jsonb_build_object('ok',true,'resolution',p_resolution);
END $$;

-- The queue. Definer rights add the client and staff names; the visibility rule is the same as the row policy.
CREATE FUNCTION erp_private.incoming_list(p_archived boolean DEFAULT false) RETURNS TABLE(
 item_id uuid,source_type text,sender_name text,sender_address text,received_at timestamptz,subject text,message_text text,file_name text,file_size_bytes bigint,mime_type text,
 is_kyc boolean,confidentiality text,client_id uuid,client_name text,contact_id uuid,contact_name text,match_result text,match_count integer,duplicate_document_id uuid,duplicate_item_id uuid,
 status text,logged_by_name text,logged_at timestamptz,category text,handling_firm_id uuid,project_id uuid,task_id uuid,kra_case_id uuid,period_start date,period_end date,
 document_id uuid,communication_id uuid,decided_by_name text,decided_at timestamptz,decision_note text,resolution text,revision bigint,past_retention boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT i.item_id,i.source_type,i.sender_name,i.sender_address,i.received_at,i.subject,i.message_text,i.file_name,i.file_size_bytes,i.mime_type,
  i.is_kyc,i.confidentiality,i.client_id,cl.company_name,i.contact_id,ct.full_name,i.match_result,i.match_count,i.duplicate_document_id,i.duplicate_item_id,
  i.status,s.full_name,i.logged_at,i.category,i.handling_firm_id,i.project_id,i.task_id,i.kra_case_id,i.period_start,i.period_end,
  i.document_id,i.communication_id,d.full_name,i.decided_at,i.decision_note,i.resolution,i.revision,
  (i.status='Archived' AND i.decided_at<now()-make_interval(days=>COALESCE(erp_private.incoming_int('retention_days'),365)))
 FROM erp_private.incoming_items i
 LEFT JOIN erp_private.clients cl ON cl.client_id=i.client_id
 LEFT JOIN erp_private.client_contacts ct ON ct.contact_id=i.contact_id
 LEFT JOIN erp_private.staff_members s ON s.staff_id=i.logged_by
 LEFT JOIN erp_private.staff_members d ON d.staff_id=i.decided_by
 WHERE i.deleted_at IS NULL AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc)
  AND ((p_archived AND i.status IN('Accepted and Linked','Archived')) OR (NOT p_archived AND i.status IN('Received','Needs Review')))
 ORDER BY i.received_at DESC LIMIT 300
$$;

-- Clients that match an item's sender, for the reviewer to choose from.
CREATE FUNCTION erp_private.incoming_candidates(p_item uuid) RETURNS TABLE(client_id uuid,client_name text,contact_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT m.client_id,cl.company_name,ct.full_name FROM erp_private.incoming_items i
 JOIN LATERAL erp_private.incoming_matches(i.sender_key) m ON true
 JOIN erp_private.clients cl ON cl.client_id=m.client_id JOIN erp_private.client_contacts ct ON ct.contact_id=m.contact_id
 WHERE i.item_id=p_item AND i.deleted_at IS NULL AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc) ORDER BY cl.company_name
$$;

CREATE FUNCTION erp_private.incoming_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN erp_private.incoming_my_rank()<2 THEN '{}'::jsonb ELSE jsonb_build_object(
  'incoming_waiting',(SELECT count(*) FROM erp_private.incoming_items WHERE deleted_at IS NULL AND status IN('Received','Needs Review')),
  'incoming_needs_review',(SELECT count(*) FROM erp_private.incoming_items WHERE deleted_at IS NULL AND status='Needs Review'),
  'incoming_oldest_days',COALESCE((SELECT ((now() AT TIME ZONE 'Africa/Nairobi')::date-min((logged_at AT TIME ZONE 'Africa/Nairobi')::date)) FROM erp_private.incoming_items WHERE deleted_at IS NULL AND status IN('Received','Needs Review')),0)) END
$$;

-- 7. Add and remove document links.
CREATE FUNCTION erp_private.document_link_add(p_document uuid,p_communication uuid,p_project uuid,p_task uuid,p_kra_case uuid,p_period_start date,p_period_end date,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;d record;v_id uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR erp_private.incoming_rank(a.category_code)<1 THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner can link documents' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM erp_private.documents WHERE document_id=p_document AND deleted_at IS NULL;
 IF NOT FOUND OR NOT erp_private.document_allowed(d.client_id,d.handling_firm_id,d.project_id,d.task_id,d.category,false) OR (d.confidentiality='Restricted' AND NOT erp_private.incoming_restricted_ok()) THEN
  RAISE EXCEPTION 'That document is not available to you' USING ERRCODE='42501'; END IF;
 IF num_nonnulls(p_communication,p_project,p_task,p_kra_case,p_period_start)<>1 THEN RAISE EXCEPTION 'Link one record at a time: a communication, a project, a task, a KRA notice or a period' USING ERRCODE='22023'; END IF;
 IF p_communication IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.communications c WHERE c.communication_id=p_communication AND c.deleted_at IS NULL AND c.client_id=d.client_id AND c.firm_id=d.handling_firm_id
   AND (c.channel='Internal note' OR erp_private.comm_external_allowed(c.client_id)) AND (c.project_id IS NULL OR erp_private.project_allowed(c.project_id))) THEN
  RAISE EXCEPTION 'That communication is not available, or belongs to another client or firm' USING ERRCODE='22023'; END IF;
 IF p_project IS NOT NULL AND NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'That project is not available to you' USING ERRCODE='42501'; END IF;
 IF p_task IS NOT NULL AND NOT erp_private.task_allowed(p_task) THEN RAISE EXCEPTION 'That task is not available to you' USING ERRCODE='42501'; END IF;
 IF p_kra_case IS NOT NULL AND NOT erp_private.kra_case_allowed(p_kra_case) THEN RAISE EXCEPTION 'That KRA notice is not available to you' USING ERRCODE='42501'; END IF;
 INSERT INTO erp_private.document_links(document_id,communication_id,project_id,task_id,kra_case_id,period_start,period_end,note,created_by)
 VALUES(p_document,p_communication,p_project,p_task,p_kra_case,p_period_start,p_period_end,NULLIF(btrim(COALESCE(p_note,'')),''),a.staff_id) RETURNING link_id INTO v_id;
 RETURN jsonb_build_object('ok',true,'link_id',v_id);
END $$;

CREATE FUNCTION erp_private.document_link_remove(p_link uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;l erp_private.document_links;why text:=btrim(COALESCE(p_reason,''));
BEGIN
 a:=erp_private.actor();
 SELECT * INTO l FROM erp_private.document_links WHERE link_id=p_link FOR UPDATE;
 IF NOT FOUND OR erp_private.incoming_rank(a.category_code)<1 OR NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=l.document_id
   AND erp_private.document_allowed(d.client_id,d.handling_firm_id,d.project_id,d.task_id,d.category,false) AND (d.confidentiality='Normal' OR erp_private.incoming_restricted_ok())) THEN
  RAISE EXCEPTION 'That link is not available to you' USING ERRCODE='42501'; END IF;
 IF l.removed_at IS NOT NULL THEN RAISE EXCEPTION 'This link has already been removed' USING ERRCODE='23514'; END IF;
 IF l.created_by<>a.staff_id AND erp_private.incoming_rank(a.category_code)<2 THEN RAISE EXCEPTION 'Only the person who added a link, or a Manager or Partner, can remove it' USING ERRCODE='42501'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'Write the reason in at least 10 characters' USING ERRCODE='22023'; END IF;
 UPDATE erp_private.document_links SET removed_at=now(),removed_by=a.staff_id,removal_reason=why WHERE link_id=p_link;
 RETURN jsonb_build_object('ok',true);
END $$;

-- 8. Function privileges. Trigger functions and the internal helpers are not granted to callers beyond erp_api.
REVOKE EXECUTE ON FUNCTION erp_private.incoming_settings_guard(),erp_private.incoming_items_guard(),erp_private.document_link_guard(),erp_private.document_comm_guard(),
 erp_private.incoming_int(text),erp_private.incoming_txt(text),erp_private.incoming_rank(text),erp_private.incoming_my_rank(),erp_private.incoming_restricted_ok(),
 erp_private.incoming_norm_phone(text),erp_private.incoming_norm_email(text),erp_private.incoming_norm_key(text),erp_private.incoming_can_see(uuid,text,boolean),erp_private.incoming_matches(text),
 erp_private.incoming_register(uuid,text,text,text,timestamptz,text,text,text,text,bigint,text,text,boolean,uuid),erp_private.incoming_choose_client(uuid,uuid),erp_private.incoming_set_handling(uuid,text,boolean),
 erp_private.incoming_accept(uuid,uuid,uuid,text,uuid,uuid,uuid,date,date,text,uuid,boolean,text,uuid,boolean,text),erp_private.incoming_archive(uuid,text,text),erp_private.incoming_list(boolean),
 erp_private.incoming_candidates(uuid),erp_private.incoming_counts(),erp_private.document_link_add(uuid,uuid,uuid,uuid,uuid,date,date,text),erp_private.document_link_remove(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.incoming_int(text),erp_private.incoming_txt(text),erp_private.incoming_rank(text),erp_private.incoming_my_rank(),erp_private.incoming_restricted_ok(),
 erp_private.incoming_norm_phone(text),erp_private.incoming_norm_email(text),erp_private.incoming_norm_key(text),erp_private.incoming_can_see(uuid,text,boolean),erp_private.incoming_matches(text),
 erp_private.incoming_register(uuid,text,text,text,timestamptz,text,text,text,text,bigint,text,text,boolean,uuid),erp_private.incoming_choose_client(uuid,uuid),erp_private.incoming_set_handling(uuid,text,boolean),
 erp_private.incoming_accept(uuid,uuid,uuid,text,uuid,uuid,uuid,date,date,text,uuid,boolean,text,uuid,boolean,text),erp_private.incoming_archive(uuid,text,text),erp_private.incoming_list(boolean),
 erp_private.incoming_candidates(uuid),erp_private.incoming_counts(),erp_private.document_link_add(uuid,uuid,uuid,uuid,uuid,date,date,text),erp_private.document_link_remove(uuid,text)
 TO erp_api;
