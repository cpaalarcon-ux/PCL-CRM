-- Request Documents (Chatter groundwork, build .1092). Final decision: Assistants never write to clients. They can only pick a PRE-APPROVED document
-- request template and tick items from it. A Supervisor, Manager or Partner then sends it to the client through their own channel and records that it was sent.
-- Templates are approved by a Manager or Partner. Nothing is sent from the ERP itself until an email or WhatsApp channel is connected.
CREATE TABLE erp_private.doc_request_templates (
 template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 100),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 20 AND 1500),
 items text[] NOT NULL CHECK(cardinality(items) BETWEEN 1 AND 20),
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Approved','Retired')),
 created_by uuid REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Pending' AND approved_by IS NULL AND approved_at IS NULL) OR (status IN('Approved','Retired') AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX doc_request_templates_created_idx ON erp_private.doc_request_templates(created_by);
CREATE INDEX doc_request_templates_approved_idx ON erp_private.doc_request_templates(approved_by);
CREATE TABLE erp_private.document_requests (
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 project_id uuid REFERENCES erp_private.projects,
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 template_id uuid NOT NULL REFERENCES erp_private.doc_request_templates,
 title text NOT NULL,
 items text[] NOT NULL CHECK(cardinality(items) BETWEEN 1 AND 20),
 period_start date NOT NULL,
 period_end date NOT NULL,
 message_text text NOT NULL,
 contact_id uuid REFERENCES erp_private.client_contacts,
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 status text NOT NULL DEFAULT 'Awaiting sending' CHECK(status IN('Awaiting sending','Sent','Cancelled')),
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 sent_via text CHECK(sent_via IS NULL OR sent_via IN('Email','WhatsApp','Phone','In person','Client portal')),
 decision_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(period_end>=period_start AND period_end<period_start+interval '1 year 1 day'),
 CHECK((status='Awaiting sending' AND decided_by IS NULL AND decided_at IS NULL AND sent_via IS NULL) OR (status='Sent' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND sent_via IS NOT NULL) OR (status='Cancelled' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(btrim(decision_note))>=10))
);
CREATE INDEX document_requests_client_idx ON erp_private.document_requests(client_id,created_at DESC);
CREATE INDEX document_requests_project_idx ON erp_private.document_requests(project_id);
CREATE INDEX document_requests_firm_idx ON erp_private.document_requests(handling_firm_id);
CREATE INDEX document_requests_template_idx ON erp_private.document_requests(template_id);
CREATE INDEX document_requests_contact_idx ON erp_private.document_requests(contact_id);
CREATE INDEX document_requests_by_idx ON erp_private.document_requests(requested_by);
CREATE INDEX document_requests_decided_idx ON erp_private.document_requests(decided_by);
CREATE INDEX document_requests_open_idx ON erp_private.document_requests(created_at) WHERE status='Awaiting sending';
DO $do$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['doc_request_templates','document_requests'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
  EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
 END LOOP;
END $do$;
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.doc_request_templates FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('template_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.document_requests FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('request_id');
-- Everyone who works on documents can read the templates. Requests are visible to people with access to the client and, for Assistants, only their own.
CREATE POLICY doc_request_templates_read ON erp_private.doc_request_templates FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (status='Approved' OR erp_private.is_leader()));
CREATE POLICY document_requests_read ON erp_private.document_requests FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id) AND (requested_by=(erp_private.actor()).staff_id OR erp_private.is_leader() OR (erp_private.actor()).category_code='SUPERVISOR'));

-- Three starter templates, waiting for a Manager or Partner to approve them. Wording is generic and has no client details.
INSERT INTO erp_private.doc_request_templates(title,body,items) VALUES
 ('Monthly bookkeeping documents','Dear {client}, to complete your records for {period} please send us the documents listed below. If an item does not apply this month, tell us and we will note it.',ARRAY['Bank statements for all accounts','Sales invoices or eTIMS sales report','Purchase invoices and receipts','Payroll summary and payslips','Petty cash and cash book']),
 ('VAT return documents','Dear {client}, to prepare your VAT return for {period} please send the documents listed below before the filing date so we can check them in good time.',ARRAY['eTIMS sales and purchases report','Purchase invoices with supplier PINs','Credit notes issued and received','Import documents, if any']),
 ('Year-end accounts documents','Dear {client}, to prepare your annual accounts for {period} please send the documents listed below.',ARRAY['Bank statements and bank reconciliation','Fixed asset purchase and disposal documents','Loan statements and agreements','Stock count sheets','Payroll and statutory payment records','Supplier and customer balance listings']);

CREATE FUNCTION erp_private.doc_request_template_save(p_template uuid,p_title text,p_body text,p_items text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;tid uuid:=p_template;clean text[];
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can change request templates' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(array_agg(btrim(x)),ARRAY[]::text[]) INTO clean FROM unnest(p_items) x WHERE length(btrim(x))>0;
 IF cardinality(clean)<1 OR cardinality(clean)>20 OR EXISTS(SELECT 1 FROM unnest(clean) x WHERE length(x)<3 OR length(x)>120) THEN RAISE EXCEPTION 'List between 1 and 20 documents, each 3 to 120 characters' USING ERRCODE='23514'; END IF;
 IF tid IS NULL THEN
  INSERT INTO erp_private.doc_request_templates(title,body,items,created_by) VALUES(btrim(p_title),btrim(p_body),clean,a.staff_id) RETURNING template_id INTO tid;
 ELSE
  -- Any change sends the template back to Pending and makes the editor the author, so someone else approves the new wording before an Assistant can use it.
  UPDATE erp_private.doc_request_templates SET title=btrim(p_title),body=btrim(p_body),items=clean,created_by=a.staff_id,status='Pending',approved_by=NULL,approved_at=NULL WHERE template_id=tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'That template does not exist' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN tid;
END $$;

CREATE FUNCTION erp_private.doc_request_template_decide(p_template uuid,p_decision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;t erp_private.doc_request_templates;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can approve request templates' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM erp_private.doc_request_templates WHERE template_id=p_template FOR UPDATE;
 IF t.template_id IS NULL THEN RAISE EXCEPTION 'That template does not exist' USING ERRCODE='22023'; END IF;
 IF p_decision='Approve' THEN
  -- The person who wrote the wording cannot approve it.
  IF t.created_by=a.staff_id THEN RAISE EXCEPTION 'Another Manager or Partner must approve the wording you wrote' USING ERRCODE='42501'; END IF;
  UPDATE erp_private.doc_request_templates SET status='Approved',approved_by=a.staff_id,approved_at=now() WHERE template_id=p_template;
 ELSIF p_decision='Retire' THEN
  IF t.status<>'Approved' THEN RAISE EXCEPTION 'Only an approved template can be retired' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.doc_request_templates SET status='Retired' WHERE template_id=p_template;
 ELSE RAISE EXCEPTION 'Choose Approve or Retire' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.doc_request_create(p_client uuid,p_project uuid,p_template uuid,p_items text[],p_start date,p_end date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;c erp_private.clients;t erp_private.doc_request_templates;proj erp_private.projects;firm uuid;rid uuid;txt text;period text;picked text[];
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code NOT IN('ASSISTANT','SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Your role cannot request documents' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM erp_private.clients WHERE client_id=p_client AND deleted_at IS NULL;
 IF c.client_id IS NULL OR c.record_status='Archived' OR c.service_status<>'Active' THEN RAISE EXCEPTION 'Documents can be requested only from an active client' USING ERRCODE='23514'; END IF;
 SELECT * INTO t FROM erp_private.doc_request_templates WHERE template_id=p_template AND status='Approved';
 IF t.template_id IS NULL THEN RAISE EXCEPTION 'Choose an approved request template' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(array_agg(x ORDER BY ord),ARRAY[]::text[]) INTO picked FROM unnest(t.items) WITH ORDINALITY AS u(x,ord) WHERE x=ANY(p_items);
 IF cardinality(picked)<1 OR cardinality(picked)<>(SELECT count(DISTINCT y) FROM unnest(p_items) y) THEN RAISE EXCEPTION 'Tick at least one item from the template. Items outside the template are not allowed' USING ERRCODE='23514'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_end<p_start THEN RAISE EXCEPTION 'Choose the period the documents cover' USING ERRCODE='22023'; END IF;
 IF p_project IS NOT NULL THEN
  SELECT * INTO proj FROM erp_private.projects WHERE project_id=p_project AND client_id=p_client AND deleted_at IS NULL;
  IF proj.project_id IS NULL OR NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'That project is not available' USING ERRCODE='42501'; END IF;
  firm:=proj.handling_firm_id;
 ELSE
  SELECT l.firm_id INTO firm FROM erp_private.client_firm_links l WHERE l.client_id=p_client AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id) ORDER BY l.firm_id LIMIT 1;
  IF firm IS NULL THEN RAISE EXCEPTION 'No firm available for this client' USING ERRCODE='42501'; END IF;
 END IF;
 period:=to_char(p_start,'DD Mon YYYY')||' to '||to_char(p_end,'DD Mon YYYY');
 txt:=replace(replace(t.body,'{client}',c.company_name),'{period}',period)||E'\n\n'||(SELECT string_agg('- '||x,E'\n') FROM unnest(picked) x);
 INSERT INTO erp_private.document_requests(client_id,project_id,handling_firm_id,template_id,title,items,period_start,period_end,message_text,contact_id,requested_by)
 VALUES(p_client,p_project,firm,p_template,t.title,picked,p_start,p_end,txt,c.doc_request_contact_id,a.staff_id) RETURNING request_id INTO rid;
 -- Tell the people who can send it: Supervisors on the project, and the Managers and Partners available for this client.
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 SELECT r.staff_id,a.full_name||' asked to request documents from '||c.company_name||' ('||t.title||', '||period||'). Open the client file, Documents / KYC, to send it.','doc-request:'||rid::text||':'||r.staff_id::text
 FROM (SELECT x.staff_id FROM erp_private.review_candidates(p_client) x
       UNION SELECT pa.staff_id FROM erp_private.project_assignments pa JOIN erp_private.staff_members s ON s.staff_id=pa.staff_id
        WHERE p_project IS NOT NULL AND pa.project_id=p_project AND s.category_code='SUPERVISOR' AND s.access_status='Active') r
 WHERE r.staff_id<>a.staff_id;
 RETURN rid;
END $$;

CREATE FUNCTION erp_private.doc_request_decide(p_request uuid,p_decision text,p_via text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.document_requests;why text:=btrim(COALESCE(p_note,''));
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner can send a document request to a client' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM erp_private.document_requests WHERE request_id=p_request FOR UPDATE;
 IF r.request_id IS NULL OR NOT erp_private.client_allowed(r.client_id) THEN RAISE EXCEPTION 'That request is not available' USING ERRCODE='42501'; END IF;
 IF r.status<>'Awaiting sending' THEN RAISE EXCEPTION 'This request was already handled' USING ERRCODE='23514'; END IF;
 IF NOT erp_private.comm_external_allowed(r.client_id) THEN RAISE EXCEPTION 'Contact with this client is limited to Managers and Partners' USING ERRCODE='42501'; END IF;
 IF p_decision='Sent' THEN
  IF p_via IS NULL OR p_via NOT IN('Email','WhatsApp','Phone','In person','Client portal') THEN RAISE EXCEPTION 'Say how you sent it' USING ERRCODE='22023'; END IF;
  UPDATE erp_private.document_requests SET status='Sent',decided_by=a.staff_id,decided_at=now(),sent_via=p_via,decision_note=NULLIF(why,'') WHERE request_id=p_request;
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.requested_by,a.full_name||' sent your document request ('||r.title||') to the client by '||p_via||'.','doc-request-sent:'||p_request::text) ON CONFLICT DO NOTHING;
 ELSIF p_decision='Cancel' THEN
  IF length(why)<10 THEN RAISE EXCEPTION 'Write the reason in at least 10 characters' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.document_requests SET status='Cancelled',decided_by=a.staff_id,decided_at=now(),decision_note=why WHERE request_id=p_request;
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.requested_by,a.full_name||' cancelled your document request ('||r.title||'): '||left(why,300),'doc-request-cancel:'||p_request::text) ON CONFLICT DO NOTHING;
 ELSE RAISE EXCEPTION 'Choose Sent or Cancel' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION erp_private.doc_request_template_save(uuid,text,text,text[]),erp_private.doc_request_template_decide(uuid,text),erp_private.doc_request_create(uuid,uuid,uuid,text[],date,date),erp_private.doc_request_decide(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.doc_request_template_save(uuid,text,text,text[]),erp_private.doc_request_template_decide(uuid,text),erp_private.doc_request_create(uuid,uuid,uuid,text[],date,date),erp_private.doc_request_decide(uuid,text,text,text) TO erp_api;
