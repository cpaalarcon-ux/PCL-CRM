-- Run only against the dedicated staging project as its migration administrator.
-- All fictional rows are rolled back. No real staff, clients or files are used.
-- This tests Release 0 constraints and denied access, not operational staff RBAC.
BEGIN;
DO $$
DECLARE
  firm_a uuid := gen_random_uuid(); firm_b uuid := gen_random_uuid();
  staff_a uuid := gen_random_uuid(); staff_b uuid := gen_random_uuid();
  client_a uuid := gen_random_uuid(); client_b uuid := gen_random_uuid();
  project_a uuid := gen_random_uuid(); project_b uuid := gen_random_uuid();
  task_a uuid := gen_random_uuid(); document_a uuid := gen_random_uuid();
  version_a uuid := gen_random_uuid(); batch_a uuid := gen_random_uuid();
  r record; n integer; old_audit_count bigint;
BEGIN
  SELECT count(*) INTO n FROM erp_private.staff_categories;
  IF n <> 5 THEN RAISE EXCEPTION 'Expected five position-based staff categories'; END IF;
  SELECT count(*) INTO n FROM erp_private.services;
  IF n <> 23 THEN RAISE EXCEPTION 'Expected the 23 entries in the supplied master service catalog'; END IF;

  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    IF has_schema_privilege(r.rolname,'erp_private','USAGE') THEN
      RAISE EXCEPTION 'Unexpected schema access: %', r.rolname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
       WHERE s.nspname='erp_private' AND c.relkind='r'
       AND has_table_privilege(r.rolname,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
      RAISE EXCEPTION 'Unexpected table access: %', r.rolname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
       WHERE s.nspname='erp_private' AND has_function_privilege(r.rolname,p.oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'Unexpected function execution: %', r.rolname;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
     WHERE s.nspname='erp_private' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN
    RAISE EXCEPTION 'Every foundation table must have enabled and forced RLS';
  END IF;

  SELECT count(*) INTO old_audit_count FROM erp_private.audit_events;
  INSERT INTO erp_private.firms(firm_id,firm_code,legal_name)
    VALUES (firm_a,'TESTA','Fictional Test Firm A'),(firm_b,'TESTB','Fictional Test Firm B');
  INSERT INTO erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,employment_type)
    VALUES (staff_a,'TEST-A','test.manager','Fictional Test Manager','MANAGER','Permanent'),
           (staff_b,'TEST-B','test.assistant','Fictional Test Assistant','ASSISTANT','Permanent');
  BEGIN
    INSERT INTO erp_private.staff_members(staff_identifier,login_id,full_name,category_code,employment_type)
      VALUES ('TEST-C','TEST.MANAGER','Duplicate login test','MANAGER','Permanent');
    RAISE EXCEPTION 'Case-insensitive duplicate login was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO erp_private.staff_members(staff_identifier,login_id,full_name,category_code,employment_type)
      VALUES ('TEST-I','test.intern','Fictional Intern','INTERN','Internship');
    RAISE EXCEPTION 'Intern without contract end date was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE erp_private.staff_members SET access_status='Active' WHERE staff_id=staff_a;
    RAISE EXCEPTION 'Staff access activated without an authentication identity';
  EXCEPTION WHEN check_violation THEN NULL; END;

  INSERT INTO erp_private.clients(client_id,company_name,record_status)
    VALUES (client_a,'Fictional Existing Client A','Existing'),(client_b,'Fictional Existing Client B','Existing');
  SELECT cardinality(missing_fields) INTO n FROM erp_private.clients WHERE client_id=client_a;
  IF n <> 4 THEN RAISE EXCEPTION 'Incomplete client must identify all four missing fields'; END IF;
  UPDATE erp_private.clients SET primary_sector='SME/Startup',kra_pin='A000000001Z',
    sme_audit_exempt=true,audit_requested=true WHERE client_id=client_a;
  SELECT cardinality(missing_fields) INTO n FROM erp_private.clients WHERE client_id=client_a;
  IF n <> 2 THEN RAISE EXCEPTION 'Missing-field list did not refresh'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_private.clients WHERE client_id=client_a AND revision=2
     AND sme_audit_exempt AND audit_requested) THEN RAISE EXCEPTION 'Optional SME audit/revision failed'; END IF;
  BEGIN
    UPDATE erp_private.clients SET kra_pin='A000000001Z' WHERE client_id=client_b;
    RAISE EXCEPTION 'Duplicate client PIN was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    DELETE FROM erp_private.clients WHERE client_id=client_b;
    RAISE EXCEPTION 'Client hard deletion was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE erp_private.clients SET deleted_at=now() WHERE client_id=client_b;
  IF NOT EXISTS (SELECT 1 FROM erp_private.clients WHERE client_id=client_b AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Client archive failed';
  END IF;

  INSERT INTO erp_private.client_firm_links(client_id,firm_id) VALUES(client_a,firm_a),(client_a,firm_b);
  INSERT INTO erp_private.staff_firm_access(staff_id,firm_id) VALUES(staff_a,firm_a),(staff_b,firm_b);
  INSERT INTO erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code)
    VALUES(project_a,client_a,firm_a,'Fictional Tax Project','TAX-COMP'),
          (project_b,client_a,firm_b,'Separate firm engagement','TAX-COMP');
  BEGIN
    UPDATE erp_private.projects SET handling_firm_id=firm_b WHERE project_id=project_a;
    RAISE EXCEPTION 'Project handling firm changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE erp_private.projects SET status='Active' WHERE project_id=project_a;
    RAISE EXCEPTION 'Project activated before onboarding services exist';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job)
      VALUES(project_a,staff_b,firm_a,'ASSISTANT');
    RAISE EXCEPTION 'Assignment without staff firm membership was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job)
    VALUES(project_a,staff_a,firm_a,'MANAGER');
  BEGIN
    INSERT INTO erp_private.tasks(project_id,assigned_to,task_name) VALUES(project_a,staff_b,'Wrong assignee');
    RAISE EXCEPTION 'Task assignment outside the project was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  INSERT INTO erp_private.tasks(task_id,project_id,assigned_to,task_name,recurring_key)
    VALUES(task_a,project_a,staff_a,'Fictional weekly check','2026-W43:TAX-WEEKLY');
  BEGIN
    INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,recurring_key)
      VALUES(project_a,staff_a,'Duplicate recurring task','2026-W43:TAX-WEEKLY');
    RAISE EXCEPTION 'Duplicate recurring task was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  INSERT INTO erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,
      file_name,object_key,file_size_bytes,sha256,mime_type,version_group,uploaded_by)
    VALUES(document_a,client_a,firm_a,project_a,task_a,'BRS Receipts','fictional.pdf',
      'tests/' || document_a || '_v1.pdf',1,repeat('a',64),'application/pdf',version_a,staff_a);
  IF NOT (SELECT is_locked FROM erp_private.documents WHERE document_id=document_a) THEN
    RAISE EXCEPTION 'BRS receipt was not locked automatically';
  END IF;
  BEGIN
    UPDATE erp_private.documents SET file_name='changed.pdf' WHERE document_id=document_a;
    RAISE EXCEPTION 'Locked document metadata changed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    DELETE FROM erp_private.documents WHERE document_id=document_a;
    RAISE EXCEPTION 'Locked document was deleted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO erp_private.documents(client_id,handling_firm_id,project_id,category,file_name,object_key,
      file_size_bytes,sha256,mime_type,version_group,version,uploaded_by)
    VALUES(client_a,firm_a,project_a,'BRS Receipts','fictional-correction.pdf',
      'tests/' || document_a || '_v2.pdf',2,repeat('b',64),'application/pdf',version_a,2,staff_a);
  SELECT count(*) INTO n FROM erp_private.documents WHERE version_group=version_a;
  IF n <> 2 THEN RAISE EXCEPTION 'Version history was not preserved'; END IF;
  BEGIN
    INSERT INTO erp_private.documents(client_id,handling_firm_id,project_id,task_id,category,
       file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by)
      VALUES(client_a,firm_b,project_b,task_a,'Working Papers','cross-project.pdf',
       'tests/cross-project.pdf',1,repeat('c',64),'application/pdf',staff_a);
    RAISE EXCEPTION 'Document accepted a task from another project';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  BEGIN
    INSERT INTO erp_private.import_batches(dataset,idempotency_key,source_sha256,uploaded_by,source_row_count,
        imported_count,duplicate_count,status)
      VALUES('Clients','test-overcount',repeat('d',64),staff_a,2,2,1,'Committed');
    RAISE EXCEPTION 'Import total exceeded source rows';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO erp_private.import_batches(batch_id,dataset,idempotency_key,source_sha256,uploaded_by,source_row_count,
        imported_count,duplicate_count,incomplete_count,status)
    VALUES(batch_a,'Clients','test-client-import',repeat('e',64),staff_a,3,2,1,2,'Committed');
  INSERT INTO erp_private.import_row_keys(dataset,row_key,batch_id,client_id)
    VALUES('Clients','test-client-a',batch_a,client_a);
  BEGIN
    INSERT INTO erp_private.import_row_keys(dataset,row_key,batch_id,client_id)
      VALUES('Clients','test-client-a',batch_a,client_a);
    RAISE EXCEPTION 'Duplicate imported row key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO erp_private.import_row_keys(dataset,row_key,batch_id,staff_id)
      VALUES('Staff','test-staff-a',batch_a,staff_a);
    RAISE EXCEPTION 'Staff row accepted in a client batch';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  IF (SELECT count(*) FROM erp_private.audit_events) <= old_audit_count THEN
    RAISE EXCEPTION 'Change events were not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_private.audit_events WHERE table_name='clients' AND action='UPDATE'
      AND record_key=client_a::text AND before_values->>'primary_sector' IS NULL
      AND after_values->>'primary_sector'='SME/Startup') THEN
    RAISE EXCEPTION 'Audit event omitted old or new values';
  END IF;
  BEGIN
    UPDATE erp_private.audit_events SET action='TAMPERED' WHERE record_key=client_a::text;
    RAISE EXCEPTION 'Audit event alteration was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;

-- Exercise actual role denial in addition to inspecting privileges.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM erp_private.clients;
    RAISE EXCEPTION 'Anonymous client read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM erp_private.staff_members;
    RAISE EXCEPTION 'Authenticated staff read succeeded before policies were released';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
ROLLBACK;
