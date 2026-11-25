-- The MLRO may be appointed from the Manager or Supervisor rank (an Engagement Partner still grants it, with a reason and an end date).
-- Assistants and Interns cannot hold it. Everything else about the right is unchanged: the person who prepared a profile still cannot decide it.
DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.staff_right_grant(uuid,text,text,date)'::regprocedure);
 o:=$q$IF p_capability='MLRO' AND t.category_code<>'MANAGER' THEN RAISE EXCEPTION 'The MLRO is appointed at management level. Choose a Manager (Engagement Partners already hold every right).' USING ERRCODE='23514'; END IF;$q$;
 n:=$q$IF p_capability='MLRO' AND t.category_code NOT IN('MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'The MLRO is appointed from the Manager or Supervisor rank. Choose a Manager or Supervisor (Engagement Partners already hold every right).' USING ERRCODE='23514'; END IF;$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: MLRO rank rule not found'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;
