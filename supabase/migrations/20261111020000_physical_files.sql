-- Build 2781: physical file register. From the Partner's reception note of 11 Nov 2026 (PHYSICAL FILES RECEIVING, ASSIGNING AND DISPATCHING).
-- A physical file gets a unique reference PHY-YYYY-NNN (the format the Partner gave as an example), is tied to a client and, optionally, a client support ticket, and has a movement log
-- that is only ever added to. A file can be returned to the client (with a dispatch note) or archived; once either has happened the record is locked.
-- Not built here, and not decided: the retention periods. Nothing in this migration stores or enforces a period.
CREATE TABLE erp_private.physical_file_counters(file_year integer PRIMARY KEY, last_no integer NOT NULL CHECK(last_no>0));
ALTER TABLE erp_private.physical_file_counters ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.physical_file_counters FORCE ROW LEVEL SECURITY;

CREATE TABLE erp_private.physical_files(
 file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 file_ref text NOT NULL UNIQUE,
 client_id uuid NOT NULL,
 firm_id uuid NOT NULL,
 ticket_id uuid REFERENCES erp_private.client_support_tickets,
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 3 AND 300),
 received_on date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Nairobi')::date),
 received_from text CHECK(received_from IS NULL OR char_length(received_from)<=200),
 location text NOT NULL CHECK(char_length(btrim(location)) BETWEEN 2 AND 200),
 holder_id uuid REFERENCES erp_private.staff_members,
 status text NOT NULL DEFAULT 'In store' CHECK(status IN('In store','With staff','Pending dispatch','Returned to client','Archived')),
 digital_document_id uuid REFERENCES erp_private.documents,
 no_scan_reason text CHECK(no_scan_reason IS NULL OR char_length(btrim(no_scan_reason))>=10),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links
);
CREATE INDEX physical_files_client_idx ON erp_private.physical_files(client_id,firm_id,status);
CREATE INDEX physical_files_ticket_idx ON erp_private.physical_files(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX physical_files_holder_idx ON erp_private.physical_files(holder_id) WHERE holder_id IS NOT NULL;
CREATE INDEX physical_files_document_idx ON erp_private.physical_files(digital_document_id) WHERE digital_document_id IS NOT NULL;
CREATE INDEX physical_files_created_by_idx ON erp_private.physical_files(created_by);

CREATE TABLE erp_private.physical_file_movements(
 movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 file_id uuid NOT NULL REFERENCES erp_private.physical_files,
 kind text NOT NULL CHECK(kind IN('Received','Moved','Pending dispatch','Returned to client','Archived')),
 moved_at timestamptz NOT NULL DEFAULT now(),
 moved_by uuid NOT NULL REFERENCES erp_private.staff_members,
 from_holder uuid REFERENCES erp_private.staff_members,
 to_holder uuid REFERENCES erp_private.staff_members,
 from_location text,
 to_location text CHECK(to_location IS NULL OR char_length(to_location)<=200),
 status_after text NOT NULL,
 note text CHECK(note IS NULL OR char_length(note)<=1000),
 dispatch_note_no text,
 dispatch_method text CHECK(dispatch_method IS NULL OR dispatch_method IN('Hand delivery','Courier','Post','Collected by client')),
 dispatch_recipient text CHECK(dispatch_recipient IS NULL OR char_length(dispatch_recipient)<=200),
 dispatch_reference text CHECK(dispatch_reference IS NULL OR char_length(dispatch_reference)<=200),
 CHECK(kind<>'Returned to client' OR (dispatch_note_no IS NOT NULL AND dispatch_method IS NOT NULL AND char_length(btrim(coalesce(dispatch_recipient,'')))>=3 AND char_length(btrim(coalesce(dispatch_reference,'')))>=3)),
 CHECK(kind='Returned to client' OR (dispatch_note_no IS NULL AND dispatch_method IS NULL AND dispatch_recipient IS NULL AND dispatch_reference IS NULL))
);
CREATE INDEX physical_file_movements_file_idx ON erp_private.physical_file_movements(file_id,moved_at);
CREATE INDEX physical_file_movements_by_idx ON erp_private.physical_file_movements(moved_by);
CREATE INDEX physical_file_movements_from_idx ON erp_private.physical_file_movements(from_holder) WHERE from_holder IS NOT NULL;
CREATE INDEX physical_file_movements_to_idx ON erp_private.physical_file_movements(to_holder) WHERE to_holder IS NOT NULL;

-- A new file gets its reference (PHY-year-number, counted per year) and is tied to a live ticket of the same client and firm.
CREATE FUNCTION erp_private.physical_file_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;t erp_private.client_support_tickets;d erp_private.documents;y integer;n integer;
BEGIN
 IF TG_OP='INSERT' THEN
  a:=erp_private.actor();
  IF a.staff_id IS NULL OR a.category_code IN('INTERN','ADMIN') THEN RAISE EXCEPTION 'Your role does not register physical files.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'In store' OR NEW.holder_id IS NOT NULL OR NEW.digital_document_id IS NOT NULL OR NEW.no_scan_reason IS NOT NULL THEN RAISE EXCEPTION 'A new physical file starts in store. Link the scanned copy afterwards.' USING ERRCODE='23514'; END IF;
  IF NEW.received_on>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'The received date cannot be in the future.' USING ERRCODE='23514'; END IF;
  IF NEW.ticket_id IS NOT NULL THEN
   SELECT * INTO t FROM erp_private.client_support_tickets WHERE ticket_id=NEW.ticket_id;
   IF NOT FOUND OR t.client_id<>NEW.client_id OR t.firm_id<>NEW.firm_id THEN RAISE EXCEPTION 'Link a ticket of this client and firm.' USING ERRCODE='23514'; END IF;
   IF t.status IN('Closed','Cancelled') THEN RAISE EXCEPTION 'That ticket is closed. Open a new ticket for this file.' USING ERRCODE='23514'; END IF;
  END IF;
  y:=extract(year FROM (now() AT TIME ZONE 'Africa/Nairobi'))::integer;
  INSERT INTO erp_private.physical_file_counters(file_year,last_no) VALUES(y,1) ON CONFLICT(file_year) DO UPDATE SET last_no=erp_private.physical_file_counters.last_no+1 RETURNING last_no INTO n;
  NEW.file_ref:='PHY-'||y||'-'||lpad(n::text,3,'0');
  NEW.created_by:=a.staff_id; NEW.created_at:=now();
  RETURN NEW;
 END IF;
 IF OLD.status IN('Returned to client','Archived') THEN RAISE EXCEPTION 'This file was % and its record is locked.',lower(OLD.status) USING ERRCODE='23514'; END IF;
 IF ROW(NEW.file_id,NEW.file_ref,NEW.client_id,NEW.firm_id,NEW.ticket_id,NEW.received_on,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.file_id,OLD.file_ref,OLD.client_id,OLD.firm_id,OLD.ticket_id,OLD.received_on,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'The reference, client, firm, ticket and received date of a physical file cannot be changed.' USING ERRCODE='23514'; END IF;
 IF NEW.digital_document_id IS NOT NULL AND NEW.digital_document_id IS DISTINCT FROM OLD.digital_document_id THEN
  SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.digital_document_id AND deleted_at IS NULL;
  IF NOT FOUND OR d.client_id<>NEW.client_id OR d.handling_firm_id<>NEW.firm_id THEN RAISE EXCEPTION 'Link a document of this client and firm.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER physical_file_guard BEFORE INSERT OR UPDATE ON erp_private.physical_files FOR EACH ROW EXECUTE FUNCTION erp_private.physical_file_guard();
CREATE TRIGGER physical_file_no_delete BEFORE DELETE ON erp_private.physical_files FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.physical_files FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.physical_files FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('file_id');

-- Every movement is added by this trigger's rules and applied to the file. The first entry ("Received") is written by the system when the file is registered.
CREATE FUNCTION erp_private.physical_file_movement_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.physical_files;w erp_private.staff_members;st text;hold uuid;loc text;
BEGIN
 SELECT * INTO f FROM erp_private.physical_files WHERE file_id=NEW.file_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That physical file is unavailable.' USING ERRCODE='23514'; END IF;
 IF NEW.kind='Received' THEN
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'A file is received when it is registered; add the file instead.' USING ERRCODE='23514'; END IF;
  NEW.moved_by:=f.created_by; NEW.moved_at:=now(); NEW.from_holder:=NULL; NEW.from_location:=NULL; NEW.to_holder:=NULL; NEW.to_location:=f.location; NEW.status_after:='In store';
  RETURN NEW;
 END IF;
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code IN('INTERN','ADMIN') THEN RAISE EXCEPTION 'Your role does not move physical files.' USING ERRCODE='23514'; END IF;
 IF f.status IN('Returned to client','Archived') THEN RAISE EXCEPTION 'This file was % and its record is locked.',lower(f.status) USING ERRCODE='23514'; END IF;
 NEW.moved_by:=a.staff_id; NEW.moved_at:=now(); NEW.from_holder:=f.holder_id; NEW.from_location:=f.location;
 NEW.to_location:=nullif(btrim(coalesce(NEW.to_location,'')),'');
 hold:=f.holder_id; loc:=f.location; st:=f.status;
 IF NEW.kind='Moved' THEN
  IF NEW.to_holder IS NULL AND NEW.to_location IS NULL THEN RAISE EXCEPTION 'Say who has the file now, or where it is kept.' USING ERRCODE='23514'; END IF;
  IF NEW.to_holder IS NOT NULL THEN
   SELECT * INTO w FROM erp_private.staff_members WHERE staff_id=NEW.to_holder AND deleted_at IS NULL AND access_status='Active';
   IF NOT FOUND OR w.category_code IN('INTERN','ADMIN') THEN RAISE EXCEPTION 'Hand the file to an active member of staff who handles client work.' USING ERRCODE='23514'; END IF;
   hold:=NEW.to_holder; IF st<>'Pending dispatch' THEN st:='With staff'; END IF;
  ELSE
   hold:=NULL; IF st<>'Pending dispatch' THEN st:='In store'; END IF;
  END IF;
  IF NEW.to_location IS NOT NULL THEN loc:=NEW.to_location; END IF;
 ELSIF NEW.kind='Pending dispatch' THEN
  IF f.status='Pending dispatch' THEN RAISE EXCEPTION 'The file is already pending dispatch.' USING ERRCODE='23514'; END IF;
  st:='Pending dispatch'; NEW.to_holder:=f.holder_id; IF NEW.to_location IS NOT NULL THEN loc:=NEW.to_location; END IF;
 ELSIF NEW.kind='Returned to client' THEN
  IF f.status<>'Pending dispatch' THEN RAISE EXCEPTION 'Mark the file pending dispatch before it is returned to the client.' USING ERRCODE='23514'; END IF;
  IF f.digital_document_id IS NULL AND f.no_scan_reason IS NULL THEN RAISE EXCEPTION 'Link the scanned copy, or record why there is none, before the file leaves the office.' USING ERRCODE='23514'; END IF;
  NEW.dispatch_note_no:='DN-'||substr(f.file_ref,5); NEW.to_holder:=NULL; NEW.to_location:='Returned to client';
  hold:=NULL; loc:='Returned to client'; st:='Returned to client';
 ELSIF NEW.kind='Archived' THEN
  IF NEW.to_location IS NULL OR char_length(NEW.to_location)<2 THEN RAISE EXCEPTION 'Say which archive shelf or box the file goes to.' USING ERRCODE='23514'; END IF;
  IF f.digital_document_id IS NULL AND f.no_scan_reason IS NULL THEN RAISE EXCEPTION 'Link the scanned copy, or record why there is none, before the file is archived.' USING ERRCODE='23514'; END IF;
  NEW.to_holder:=NULL; hold:=NULL; loc:=NEW.to_location; st:='Archived';
 END IF;
 NEW.status_after:=st;
 UPDATE erp_private.physical_files SET status=st,holder_id=hold,location=loc WHERE file_id=f.file_id;
 RETURN NEW;
END $$;
CREATE TRIGGER physical_file_movement_guard BEFORE INSERT ON erp_private.physical_file_movements FOR EACH ROW EXECUTE FUNCTION erp_private.physical_file_movement_guard();

CREATE FUNCTION erp_private.physical_file_received_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 INSERT INTO erp_private.physical_file_movements(file_id,kind,moved_by,status_after,note) VALUES(NEW.file_id,'Received',NEW.created_by,'In store',NULLIF(btrim(coalesce(NEW.received_from,'')),''));
 RETURN NEW;
END $$;
CREATE TRIGGER physical_file_received_entry AFTER INSERT ON erp_private.physical_files FOR EACH ROW EXECUTE FUNCTION erp_private.physical_file_received_entry();

CREATE FUNCTION erp_private.physical_file_movement_fixed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'The movement log is only added to; an entry cannot be changed or removed.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER physical_file_movement_fixed BEFORE UPDATE OR DELETE ON erp_private.physical_file_movements FOR EACH ROW EXECUTE FUNCTION erp_private.physical_file_movement_fixed();

-- A ticket cannot be closed or cancelled while one of its physical files is still in the office (not returned to the client or archived).
CREATE FUNCTION erp_private.ticket_physical_files_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r text;
BEGIN
 IF NEW.status IN('Closed','Cancelled') AND OLD.status NOT IN('Closed','Cancelled') THEN
  SELECT string_agg(file_ref,', ' ORDER BY file_ref) INTO r FROM erp_private.physical_files WHERE ticket_id=NEW.ticket_id AND status NOT IN('Returned to client','Archived');
  IF r IS NOT NULL THEN RAISE EXCEPTION 'Physical file % linked to this ticket has not been returned to the client or archived yet.',r USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ticket_physical_files_guard BEFORE UPDATE ON erp_private.client_support_tickets FOR EACH ROW EXECUTE FUNCTION erp_private.ticket_physical_files_guard();

ALTER TABLE erp_private.physical_files ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.physical_files FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.physical_file_movements ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.physical_file_movements FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.physical_files TO erp_api;
GRANT UPDATE(digital_document_id,no_scan_reason,description) ON erp_private.physical_files TO erp_api;
GRANT SELECT,INSERT ON erp_private.physical_file_movements TO erp_api;
CREATE POLICY physical_files_read ON erp_private.physical_files FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id));
CREATE POLICY physical_files_insert ON erp_private.physical_files FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id));
CREATE POLICY physical_files_update ON erp_private.physical_files FOR UPDATE TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id));
CREATE POLICY physical_file_movements_read ON erp_private.physical_file_movements FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.physical_files f WHERE f.file_id=physical_file_movements.file_id));
CREATE POLICY physical_file_movements_insert ON erp_private.physical_file_movements FOR INSERT TO erp_api WITH CHECK(EXISTS(SELECT 1 FROM erp_private.physical_files f WHERE f.file_id=physical_file_movements.file_id));

REVOKE ALL ON FUNCTION erp_private.physical_file_guard(),erp_private.physical_file_movement_guard(),erp_private.physical_file_received_entry(),erp_private.physical_file_movement_fixed(),erp_private.ticket_physical_files_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.physical_file_guard(),erp_private.physical_file_movement_guard(),erp_private.physical_file_received_entry(),erp_private.physical_file_movement_fixed(),erp_private.ticket_physical_files_guard() TO erp_api;
