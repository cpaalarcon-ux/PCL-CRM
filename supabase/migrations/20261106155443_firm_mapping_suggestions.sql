-- Learned opening TB mapping suggestions. A preparer only sees the client accounts of projects they work on, so a suggestion built from the
-- firm's other clients needs a definer function. It returns counts only (which ERP account other clients of the same firm mapped the same
-- source code or name to, and how many clients agreed), never client names, amounts or mapping rows. Only approved (Active) mappings count.
CREATE FUNCTION erp_private.firm_mapping_suggestions(p_project uuid,p_codes text[],p_names text[])
RETURNS TABLE(source_code text,source_name text,erp_account_code text,clients integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pr erp_private.projects;
BEGIN
 IF NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'This project is unavailable to your account.' USING ERRCODE='42501'; END IF;
 SELECT * INTO pr FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
 IF pr.project_id IS NULL THEN RAISE EXCEPTION 'This project is unavailable to your account.' USING ERRCODE='42501'; END IF;
 IF coalesce(array_length(p_codes,1),0)>600 OR coalesce(array_length(p_names,1),0)>600 THEN RAISE EXCEPTION 'Ask for at most 600 accounts at a time.' USING ERRCODE='22023'; END IF;
 RETURN QUERY
  SELECT nullif(btrim(m.source_account_code),''),lower(btrim(m.source_account_name)),m.erp_account_code,count(DISTINCT m.client_id)::integer
  FROM erp_private.client_account_mappings m
  JOIN erp_private.clients c ON c.client_id=m.client_id AND c.deleted_at IS NULL
  WHERE m.status='Active' AND m.client_id<>pr.client_id AND m.erp_account_code<'40000'
   AND EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=m.client_id AND l.firm_id=pr.handling_firm_id)
   AND ((nullif(btrim(m.source_account_code),'') IS NOT NULL AND btrim(m.source_account_code)=ANY(coalesce(p_codes,'{}'::text[])))
     OR lower(btrim(m.source_account_name))=ANY(coalesce(p_names,'{}'::text[])))
  GROUP BY 1,2,3;
END $$;
REVOKE ALL ON FUNCTION erp_private.firm_mapping_suggestions(uuid,text[],text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.firm_mapping_suggestions(uuid,text[],text[]) TO erp_api;
