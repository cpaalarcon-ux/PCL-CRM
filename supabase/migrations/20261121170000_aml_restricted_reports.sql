-- Build 2865: POCAMLA leftovers.
-- 1. A restricted store for internal suspicious-activity concerns. Any staff member can raise one and gets back only a reference. Nobody else can read it:
--    the tables grant nothing to the application role, and the MLRO reads and decides through functions that write an access-log row every time, including
--    a refused attempt. The text of a concern is never copied into the general change audit.
-- 2. The firm's annual compliance report as a dated obligation: created for each firm every 1 January, due 31 January, assigned to the firm's MLRO.
-- Nothing here states a legal threshold or a reporting deadline of the regulator; the dates are the practice's own rule, shown as such.

CREATE FUNCTION erp_private.aml_insert_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'This record is kept as written. It is not changed or removed.' USING ERRCODE='23514'; END $$;

CREATE SEQUENCE erp_private.aml_report_ref_seq;
CREATE TABLE erp_private.aml_reports(
 report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_ref text NOT NULL UNIQUE DEFAULT ('SAR-'||to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY')||'-'||lpad(nextval('erp_private.aml_report_ref_seq')::text,5,'0')),
 client_id uuid REFERENCES erp_private.clients,
 summary text NOT NULL CHECK(char_length(btrim(summary)) BETWEEN 20 AND 4000),
 raised_by uuid NOT NULL REFERENCES erp_private.staff_members,
 raised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_reports_client_idx ON erp_private.aml_reports(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX aml_reports_by_idx ON erp_private.aml_reports(raised_by);
CREATE TABLE erp_private.aml_report_events(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid NOT NULL REFERENCES erp_private.aml_reports,
 event_type text NOT NULL CHECK(event_type IN('Received','Under review','Reported to FRC','Closed without report','Note')),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 3 AND 2000),
 frc_reference text CHECK(frc_reference IS NULL OR char_length(btrim(frc_reference)) BETWEEN 3 AND 100),
 reported_on date,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,
 at timestamptz NOT NULL DEFAULT now(),
 CHECK(event_type<>'Reported to FRC' OR (frc_reference IS NOT NULL AND reported_on IS NOT NULL)),
 CHECK(event_type NOT IN('Closed without report','Note') OR note IS NOT NULL)
);
CREATE INDEX aml_report_events_report_idx ON erp_private.aml_report_events(report_id,at);
CREATE INDEX aml_report_events_actor_idx ON erp_private.aml_report_events(actor_id);
CREATE TABLE erp_private.aml_report_access_log(
 log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 report_id uuid REFERENCES erp_private.aml_reports,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,
 action text NOT NULL CHECK(action IN('Raised','Listed','Read','Event','Log viewed','Denied')),
 detail text CHECK(detail IS NULL OR char_length(detail)<=200),
 at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_report_log_report_idx ON erp_private.aml_report_access_log(report_id,at);
CREATE INDEX aml_report_log_actor_idx ON erp_private.aml_report_access_log(actor_id,at);
CREATE TRIGGER insert_only BEFORE UPDATE OR DELETE ON erp_private.aml_reports FOR EACH ROW EXECUTE FUNCTION erp_private.aml_insert_only();
CREATE TRIGGER insert_only BEFORE UPDATE OR DELETE ON erp_private.aml_report_events FOR EACH ROW EXECUTE FUNCTION erp_private.aml_insert_only();
CREATE TRIGGER insert_only BEFORE UPDATE OR DELETE ON erp_private.aml_report_access_log FOR EACH ROW EXECUTE FUNCTION erp_private.aml_insert_only();
ALTER TABLE erp_private.aml_reports ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aml_report_events ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_report_events FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aml_report_access_log ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_report_access_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.aml_reports,erp_private.aml_report_events,erp_private.aml_report_access_log FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON SEQUENCE erp_private.aml_report_ref_seq FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- Raise a concern: any signed-in staff member. The reply is the reference only, so the person raising it learns nothing about what happens next.
CREATE FUNCTION erp_private.aml_report_raise(p_client uuid,p_summary text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;r record;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again.' USING ERRCODE='42501'; END IF;
 IF char_length(btrim(coalesce(p_summary,''))) NOT BETWEEN 20 AND 4000 THEN RAISE EXCEPTION 'Describe what you saw in 20 to 4000 characters.' USING ERRCODE='22023'; END IF;
 IF p_client IS NOT NULL AND NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'This client is unavailable to your account.' USING ERRCODE='42501'; END IF;
 INSERT INTO erp_private.aml_reports(client_id,summary,raised_by) VALUES(p_client,btrim(p_summary),me) RETURNING report_id,report_ref INTO r;
 INSERT INTO erp_private.aml_report_events(report_id,event_type,actor_id) VALUES(r.report_id,'Received',me);
 INSERT INTO erp_private.aml_report_access_log(report_id,actor_id,action) VALUES(r.report_id,me,'Raised');
 RETURN jsonb_build_object('ref',r.report_ref);
END $$;

CREATE FUNCTION erp_private.aml_report_list() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;out jsonb;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.is_mlro() THEN INSERT INTO erp_private.aml_report_access_log(actor_id,action,detail) VALUES(me,'Denied','list'); RETURN jsonb_build_object('denied',true); END IF;
 INSERT INTO erp_private.aml_report_access_log(actor_id,action) VALUES(me,'Listed');
 SELECT coalesce(jsonb_agg(x ORDER BY (x->>'raised_at') DESC),'[]'::jsonb) INTO out FROM (
  SELECT jsonb_build_object('report_id',r.report_id,'report_ref',r.report_ref,'client_id',r.client_id,'company_name',c.company_name,'raised_at',r.raised_at,'raised_by_name',erp_private.aml_staff_name(r.raised_by),
   'status',(SELECT e.event_type FROM erp_private.aml_report_events e WHERE e.report_id=r.report_id ORDER BY e.at DESC,e.event_id DESC LIMIT 1)) AS x
  FROM erp_private.aml_reports r LEFT JOIN erp_private.clients c ON c.client_id=r.client_id ORDER BY r.raised_at DESC LIMIT 500) q;
 RETURN jsonb_build_object('reports',out);
END $$;

CREATE FUNCTION erp_private.aml_report_read(p_report uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;rep jsonb;ev jsonb;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.is_mlro() THEN INSERT INTO erp_private.aml_report_access_log(report_id,actor_id,action,detail) SELECT r.report_id,me,'Denied','read' FROM erp_private.aml_reports r WHERE r.report_id=p_report; IF NOT FOUND THEN INSERT INTO erp_private.aml_report_access_log(actor_id,action,detail) VALUES(me,'Denied','read'); END IF; RETURN jsonb_build_object('denied',true); END IF;
 SELECT jsonb_build_object('report_id',r.report_id,'report_ref',r.report_ref,'client_id',r.client_id,'company_name',c.company_name,'summary',r.summary,'raised_at',r.raised_at,'raised_by_name',erp_private.aml_staff_name(r.raised_by)) INTO rep
  FROM erp_private.aml_reports r LEFT JOIN erp_private.clients c ON c.client_id=r.client_id WHERE r.report_id=p_report;
 IF rep IS NULL THEN RAISE EXCEPTION 'That report does not exist.' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('event_type',e.event_type,'note',e.note,'frc_reference',e.frc_reference,'reported_on',e.reported_on,'actor_name',erp_private.aml_staff_name(e.actor_id),'at',e.at) ORDER BY e.at,e.event_id),'[]'::jsonb) INTO ev FROM erp_private.aml_report_events e WHERE e.report_id=p_report;
 INSERT INTO erp_private.aml_report_access_log(report_id,actor_id,action) VALUES(p_report,me,'Read');
 RETURN jsonb_build_object('report',rep,'events',ev);
END $$;

CREATE FUNCTION erp_private.aml_report_event(p_report uuid,p_type text,p_note text,p_frc text,p_on date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;last text;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.is_mlro() THEN INSERT INTO erp_private.aml_report_access_log(actor_id,action,detail) VALUES(me,'Denied','event'); RETURN jsonb_build_object('denied',true); END IF;
 IF p_type NOT IN('Under review','Reported to FRC','Closed without report','Note') THEN RAISE EXCEPTION 'Choose what happened.' USING ERRCODE='22023'; END IF;
 SELECT e.event_type INTO last FROM erp_private.aml_report_events e WHERE e.report_id=p_report ORDER BY e.at DESC,e.event_id DESC LIMIT 1;
 IF last IS NULL THEN RAISE EXCEPTION 'That report does not exist.' USING ERRCODE='P0002'; END IF;
 IF last IN('Reported to FRC','Closed without report') THEN RAISE EXCEPTION 'This report is concluded. It is not changed.' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.aml_report_events(report_id,event_type,note,frc_reference,reported_on,actor_id) VALUES(p_report,p_type,nullif(btrim(coalesce(p_note,'')),''),nullif(btrim(coalesce(p_frc,'')),''),p_on,me);
 INSERT INTO erp_private.aml_report_access_log(report_id,actor_id,action,detail) VALUES(p_report,me,'Event',p_type);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.aml_report_log(p_limit integer DEFAULT 200) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;out jsonb;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'Sign in again.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.is_mlro() THEN INSERT INTO erp_private.aml_report_access_log(actor_id,action,detail) VALUES(me,'Denied','log'); RETURN jsonb_build_object('denied',true); END IF;
 INSERT INTO erp_private.aml_report_access_log(actor_id,action) VALUES(me,'Log viewed');
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO out FROM (
  SELECT jsonb_build_object('at',l.at,'action',l.action,'detail',l.detail,'actor_name',erp_private.aml_staff_name(l.actor_id),'report_ref',r.report_ref) AS x
  FROM erp_private.aml_report_access_log l LEFT JOIN erp_private.aml_reports r ON r.report_id=l.report_id ORDER BY l.at DESC LIMIT greatest(1,least(coalesce(p_limit,200),500))) q;
 RETURN jsonb_build_object('log',out);
END $$;
REVOKE ALL ON FUNCTION erp_private.aml_report_raise(uuid,text),erp_private.aml_report_list(),erp_private.aml_report_read(uuid),erp_private.aml_report_event(uuid,text,text,text,date),erp_private.aml_report_log(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.aml_report_raise(uuid,text),erp_private.aml_report_list(),erp_private.aml_report_read(uuid),erp_private.aml_report_event(uuid,text,text,text,date),erp_private.aml_report_log(integer) TO erp_api;

-- The firm's annual compliance report. One per firm per year it covers, created for the year just ended and due on 31 January.
CREATE TABLE erp_private.aml_annual_reports(
 annual_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 firm_id uuid NOT NULL REFERENCES erp_private.firms,
 covers_year integer NOT NULL CHECK(covers_year BETWEEN 2000 AND 2100),
 due_on date NOT NULL,
 assigned_to uuid REFERENCES erp_private.staff_members,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Prepared','Submitted')),
 prepared_by uuid REFERENCES erp_private.staff_members,prepared_at timestamptz,
 submitted_by uuid REFERENCES erp_private.staff_members,submitted_at timestamptz,
 submitted_on date,receipt_reference text CHECK(receipt_reference IS NULL OR char_length(btrim(receipt_reference)) BETWEEN 3 AND 100),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 3 AND 1000),
 created_by uuid REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(firm_id,covers_year),
 CHECK(status<>'Submitted' OR (submitted_by IS NOT NULL AND submitted_on IS NOT NULL AND receipt_reference IS NOT NULL))
);
CREATE INDEX aml_annual_assigned_idx ON erp_private.aml_annual_reports(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX aml_annual_prepared_idx ON erp_private.aml_annual_reports(prepared_by) WHERE prepared_by IS NOT NULL;
CREATE INDEX aml_annual_submitted_idx ON erp_private.aml_annual_reports(submitted_by) WHERE submitted_by IS NOT NULL;
CREATE INDEX aml_annual_created_idx ON erp_private.aml_annual_reports(created_by) WHERE created_by IS NOT NULL;
CREATE FUNCTION erp_private.aml_annual_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.status='Submitted' THEN RAISE EXCEPTION 'A submitted annual report is history and is not changed.' USING ERRCODE='23514'; END IF;
  IF (NEW.annual_id,NEW.firm_id,NEW.covers_year,NEW.due_on,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.annual_id,OLD.firm_id,OLD.covers_year,OLD.due_on,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'The year and due date of an annual report are fixed.' USING ERRCODE='23514'; END IF;
  IF OLD.status='Prepared' AND NEW.status='Open' THEN RAISE EXCEPTION 'An annual report moves forward only.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aml_annual_guard BEFORE INSERT OR UPDATE ON erp_private.aml_annual_reports FOR EACH ROW EXECUTE FUNCTION erp_private.aml_annual_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aml_annual_reports FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aml_annual_reports FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('annual_id');
ALTER TABLE erp_private.aml_annual_reports ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_annual_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.aml_annual_reports FROM PUBLIC,anon,authenticated,service_role,erp_api;
GRANT SELECT ON erp_private.aml_annual_reports TO erp_api;
CREATE POLICY aml_annual_read ON erp_private.aml_annual_reports FOR SELECT TO erp_api USING(erp_private.is_mlro() OR assigned_to=(erp_private.actor()).staff_id);

-- Creates this year's rows when 1 January has come. Safe to run any number of times. The first automatic year is 2027 (covering 2026); an earlier year is added by the MLRO.
CREATE FUNCTION erp_private.aml_annual_ensure(p_today date DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t date:=coalesce(p_today,(now() AT TIME ZONE 'Africa/Nairobi')::date);y integer:=extract(year FROM coalesce(p_today,(now() AT TIME ZONE 'Africa/Nairobi')::date));n integer;
BEGIN
 IF y<2027 THEN RETURN 0; END IF;
 INSERT INTO erp_private.aml_annual_reports(firm_id,covers_year,due_on,assigned_to)
 SELECT f.firm_id,y-1,make_date(y,1,31),(SELECT c.staff_id FROM erp_private.staff_capabilities c JOIN erp_private.staff_firm_access a ON a.staff_id=c.staff_id AND a.firm_id=f.firm_id AND a.deleted_at IS NULL
   WHERE c.capability='MLRO' AND c.deleted_at IS NULL AND (c.expires_on IS NULL OR c.expires_on>=t) ORDER BY c.created_at LIMIT 1)
 FROM erp_private.firms f ON CONFLICT(firm_id,covers_year) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.aml_annual_ensure(date) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.aml_annual_ensure(date) TO erp_api;
-- The MLRO adds a past year, for example the report that fell due before this record existed.
CREATE FUNCTION erp_private.aml_annual_add(p_firm uuid,p_year integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;id uuid;
BEGIN
 IF me IS NULL OR NOT erp_private.is_mlro() THEN RAISE EXCEPTION 'Only the appointed MLRO or an Engagement Partner does this.' USING ERRCODE='42501'; END IF;
 IF p_year<2000 OR p_year>=extract(year FROM (now() AT TIME ZONE 'Africa/Nairobi')::date) THEN RAISE EXCEPTION 'Choose a year that has ended.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.firms WHERE firm_id=p_firm) THEN RAISE EXCEPTION 'That firm does not exist.' USING ERRCODE='P0002'; END IF;
 INSERT INTO erp_private.aml_annual_reports(firm_id,covers_year,due_on,assigned_to,created_by) VALUES(p_firm,p_year,make_date(p_year+1,1,31),me,me) RETURNING annual_id INTO id;
 RETURN id;
END $$;
REVOKE ALL ON FUNCTION erp_private.aml_annual_add(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.aml_annual_add(uuid,integer) TO erp_api;
CREATE FUNCTION erp_private.aml_annual_move(p_id uuid,p_status text,p_note text,p_receipt text,p_on date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me uuid:=(erp_private.actor()).staff_id;cur text;
BEGIN
 IF me IS NULL OR NOT erp_private.is_mlro() THEN RAISE EXCEPTION 'Only the appointed MLRO or an Engagement Partner does this.' USING ERRCODE='42501'; END IF;
 SELECT status INTO cur FROM erp_private.aml_annual_reports WHERE annual_id=p_id FOR UPDATE;
 IF cur IS NULL THEN RAISE EXCEPTION 'That annual report does not exist.' USING ERRCODE='P0002'; END IF;
 IF p_status='Prepared' THEN UPDATE erp_private.aml_annual_reports SET status='Prepared',prepared_by=me,prepared_at=now(),note=coalesce(nullif(btrim(coalesce(p_note,'')),''),note) WHERE annual_id=p_id;
 ELSIF p_status='Submitted' THEN UPDATE erp_private.aml_annual_reports SET status='Submitted',submitted_by=me,submitted_at=now(),submitted_on=p_on,receipt_reference=nullif(btrim(coalesce(p_receipt,'')),''),note=coalesce(nullif(btrim(coalesce(p_note,'')),''),note) WHERE annual_id=p_id;
 ELSE RAISE EXCEPTION 'Choose Prepared or Submitted.' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION erp_private.aml_annual_move(uuid,text,text,text,date) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.aml_annual_move(uuid,text,text,text,date) TO erp_api;
SELECT cron.schedule('aml-annual-report','15 0 * * *','select erp_private.aml_annual_ensure();');
