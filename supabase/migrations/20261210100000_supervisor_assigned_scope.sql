-- Supervisor record scope (access alignment, step 3).
-- A Supervisor now reaches only the clients they own or are allocated for onboarding, and the projects (and through them the clients) they are
-- assigned to. They no longer read every client and project in their firms. Managers and Partners are unchanged.
-- Tasks, documents, chat and the other records that follow a project or a client narrow with it, because they check these two functions.
-- Both functions are patched in place so that nothing else in them changes; the migration stops if either has an unexpected shape.
DO $$
DECLARE def text;
 project_old text:='AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code IN(''PARTNER'',''MANAGER'',''SUPERVISOR'')';
 project_new text:='AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code IN(''PARTNER'',''MANAGER'')';
 client_old text:='((erp_private.actor()).category_code IN(''MANAGER'',''SUPERVISOR'') AND (';
 client_new text:='((erp_private.actor()).category_code=''MANAGER'' AND (';
BEGIN
 def:=pg_get_functiondef('erp_private.project_allowed(uuid)'::regprocedure);
 IF position(project_old IN def)=0 THEN RAISE EXCEPTION 'project_allowed has an unexpected shape; the Supervisor scope was not narrowed.'; END IF;
 EXECUTE replace(def,project_old,project_new);
 def:=pg_get_functiondef('erp_private.client_allowed(uuid)'::regprocedure);
 IF position(client_old IN def)=0 THEN RAISE EXCEPTION 'client_allowed has an unexpected shape; the Supervisor scope was not narrowed.'; END IF;
 EXECUTE replace(def,client_old,client_new);
END $$;
