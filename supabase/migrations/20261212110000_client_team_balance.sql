-- Client team, balancing (follows 20261212100000_client_team.sql).
-- 1. team_pick: choose the available person with the fewest open tasks, instead of always the earliest named.
-- 2. team_route_task uses it, and never gives a task to the project's own reviewer (the independent check must stay independent).
-- 3. team_defaults: who the new-project form suggests as preparer and reviewer.
-- "Available" means: active, contract not ended, works in the firm that handles the work, and not on approved leave on the date the task is due.

-- The people who could take this work, best first: a project's own owners before the client's, then the fewest open tasks, then the earliest named.
CREATE FUNCTION erp_private.team_rank(p_client uuid,p_project uuid,p_firm uuid,p_role text,p_workstream text,p_due timestamptz,p_exclude uuid[])
RETURNS TABLE(staff_id uuid,is_override boolean,open_tasks integer,assigned_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f uuid; d date;
BEGIN
 f:=coalesce(p_firm,(SELECT pr.handling_firm_id FROM erp_private.projects pr WHERE pr.project_id=p_project));
 d:=(coalesce(p_due,now()) AT TIME ZONE 'Africa/Nairobi')::date;
 RETURN QUERY
 SELECT m.staff_id,(m.project_id IS NOT NULL),(SELECT count(*)::integer FROM erp_private.tasks k WHERE k.assigned_to=m.staff_id AND k.deleted_at IS NULL AND k.status NOT IN ('Completed','Cancelled')),m.assigned_at
  FROM erp_private.client_team_members m JOIN erp_private.staff_members s ON s.staff_id=m.staff_id
  WHERE m.client_id=p_client AND m.role=p_role AND coalesce(m.workstream,'')=coalesce(p_workstream,'') AND m.ended_at IS NULL
   AND (m.project_id IS NULL OR m.project_id=p_project)
   AND s.deleted_at IS NULL AND s.access_status='Active' AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
   AND (s.category_code='PARTNER' OR f IS NULL OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=m.staff_id AND a.firm_id=f AND a.deleted_at IS NULL))
   AND NOT (m.staff_id=ANY(coalesce(array_remove(p_exclude,NULL),'{}'::uuid[])))
   AND NOT EXISTS(SELECT 1 FROM erp_private.leave_requests l WHERE l.staff_id=m.staff_id AND l.status='Approved' AND l.deleted_at IS NULL AND d BETWEEN l.starts_on AND l.ends_on)
  ORDER BY (m.project_id IS NOT NULL) DESC,
   (SELECT count(*) FROM erp_private.tasks k WHERE k.assigned_to=m.staff_id AND k.deleted_at IS NULL AND k.status NOT IN ('Completed','Cancelled')),
   m.assigned_at,m.team_member_id;
END $$;
REVOKE ALL ON FUNCTION erp_private.team_rank(uuid,uuid,uuid,text,text,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.team_rank(uuid,uuid,uuid,text,text,timestamptz,uuid[]) TO erp_api;

CREATE FUNCTION erp_private.team_pick(p_client uuid,p_project uuid,p_firm uuid,p_role text,p_workstream text,p_due timestamptz,p_exclude uuid[]) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
 SELECT r.staff_id FROM erp_private.team_rank(p_client,p_project,p_firm,p_role,p_workstream,p_due,p_exclude) r LIMIT 1
$$;
REVOKE ALL ON FUNCTION erp_private.team_pick(uuid,uuid,uuid,text,text,timestamptz,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.team_pick(uuid,uuid,uuid,text,text,timestamptz,uuid[]) TO erp_api;

CREATE OR REPLACE FUNCTION erp_private.team_route_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE ws text; owner uuid; pr record; rev uuid;
BEGIN
 IF NEW.template_key IS NULL OR NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
 ws:=erp_private.team_workstream(NEW.template_key);
 IF ws IS NULL THEN RETURN NEW; END IF;
 SELECT p.client_id,p.handling_firm_id INTO pr FROM erp_private.projects p WHERE p.project_id=NEW.project_id;
 IF pr.client_id IS NULL THEN RETURN NEW; END IF;
 SELECT s.reviewer_id INTO rev FROM erp_private.project_schedules s WHERE s.project_id=NEW.project_id;
 owner:=erp_private.team_pick(pr.client_id,NEW.project_id,pr.handling_firm_id,'WORKSTREAM_OWNER',ws,NEW.due_at,ARRAY[rev]::uuid[]);
 IF owner IS NULL OR owner=NEW.assigned_to THEN RETURN NEW; END IF;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job)
  SELECT NEW.project_id,s.staff_id,pr.handling_firm_id,s.category_code FROM erp_private.staff_members s WHERE s.staff_id=owner
  ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL WHERE erp_private.project_assignments.deleted_at IS NOT NULL;
 NEW.assigned_to:=owner;
 RETURN NEW;
END $$;

-- Suggested preparer and reviewer for a new project of this client in this firm. A reviewer is never the same person as the preparer.
CREATE FUNCTION erp_private.team_defaults(p_client uuid,p_firm uuid) RETURNS TABLE(preparer_id uuid,reviewer_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE pre uuid; rev uuid;
BEGIN
 IF NOT erp_private.is_leader() OR NOT erp_private.client_allowed(p_client) THEN RETURN; END IF;
 pre:=erp_private.team_pick(p_client,NULL,p_firm,'PREPARER',NULL,now()+interval '7 days',NULL);
 rev:=erp_private.team_pick(p_client,NULL,p_firm,'REVIEWER',NULL,now()+interval '7 days',ARRAY[pre]::uuid[]);
 RETURN QUERY SELECT pre,rev;
END $$;
REVOKE ALL ON FUNCTION erp_private.team_defaults(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.team_defaults(uuid,uuid) TO erp_api;
