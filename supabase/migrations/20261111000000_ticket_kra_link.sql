-- Build 2774: client support tickets carry a priority, a response due date and a resolution due date, notes for the person they are assigned to, and an optional link to a KRA notice
-- of the same client. From the Partner's reception, support and KRA notes of 11 Nov 2026 (PHYSICAL FILES RECEIVING). The client stays the base of every ticket; the engagement and the
-- KRA notice are optional. Nothing is billed or closed differently: billing still happens only when a billable ticket is closed (build 2750). The SLA alert thresholds, the physical-file
-- register and the dispatch note are not in this build; they wait for the Partner's answers.
ALTER TABLE erp_private.kra_cases ADD CONSTRAINT kra_cases_case_client_key UNIQUE(case_id,client_id);
ALTER TABLE erp_private.client_support_tickets
 ADD COLUMN kra_case_id uuid,
 ADD COLUMN priority text NOT NULL DEFAULT 'Medium' CHECK(priority IN('Low','Medium','High','Urgent')),
 ADD COLUMN response_due_on date,
 ADD COLUMN resolution_due_on date,
 ADD COLUMN assignment_note text CHECK(assignment_note IS NULL OR char_length(assignment_note)<=1000),
 ADD CONSTRAINT client_support_kra_fk FOREIGN KEY(kra_case_id,client_id) REFERENCES erp_private.kra_cases(case_id,client_id),
 ADD CONSTRAINT client_support_due_order CHECK(response_due_on IS NULL OR resolution_due_on IS NULL OR resolution_due_on>=response_due_on);
CREATE INDEX client_support_kra_idx ON erp_private.client_support_tickets(kra_case_id) WHERE kra_case_id IS NOT NULL;
CREATE INDEX client_support_due_idx ON erp_private.client_support_tickets(resolution_due_on) WHERE status NOT IN('Closed','Cancelled');

DO $patch$ DECLARE d text;o text; BEGIN
 d:=pg_get_functiondef('erp_private.client_support_ticket_guard()'::regprocedure);
 o:=E' IF TG_OP=''INSERT'' THEN\n  IF NOT s.is_active';
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'ticket guard patch 1'; END IF;
 d:=replace(d,o,E' IF NEW.kra_case_id IS NOT NULL AND (TG_OP=''INSERT'' OR NEW.kra_case_id IS DISTINCT FROM OLD.kra_case_id) THEN\n  IF NOT EXISTS(SELECT 1 FROM erp_private.kra_cases k WHERE k.case_id=NEW.kra_case_id AND k.client_id=NEW.client_id AND k.status IN(''Open'',''Responded'')) THEN RAISE EXCEPTION ''Link a KRA notice of this client that is still open or responded.'' USING ERRCODE=''23514''; END IF;\n END IF;\n'||o);
 o:='  NEW.opened_by:=a.staff_id; NEW.opened_at:=now();';
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'ticket guard patch 2'; END IF;
 d:=replace(d,o,E'  IF NEW.response_due_on IS NULL OR NEW.resolution_due_on IS NULL THEN RAISE EXCEPTION ''Enter the response due date and the resolution due date.'' USING ERRCODE=''23514''; END IF;\n'||o);
 o:=E' IF OLD.status IN(''Closed'',''Cancelled'') THEN RAISE EXCEPTION ''A closed or cancelled ticket cannot be changed.'' USING ERRCODE=''23514''; END IF;';
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'ticket guard patch 3'; END IF;
 d:=replace(d,o,o||E'\n IF (OLD.response_due_on IS NOT NULL AND NEW.response_due_on IS NULL) OR (OLD.resolution_due_on IS NOT NULL AND NEW.resolution_due_on IS NULL) THEN RAISE EXCEPTION ''A ticket keeps its response and resolution due dates; change them instead.'' USING ERRCODE=''23514''; END IF;');
 EXECUTE d;
END $patch$;
