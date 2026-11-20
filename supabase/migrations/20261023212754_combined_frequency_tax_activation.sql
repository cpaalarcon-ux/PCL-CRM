-- Combined recurrence; tax projects never use independent audit EQR.
ALTER TABLE erp_private.project_schedules DROP CONSTRAINT project_schedules_frequency_check;
ALTER TABLE erp_private.project_schedules ADD CONSTRAINT project_schedules_frequency_check CHECK(frequency IN ('Once-off','Weekly','Monthly','Weekly + Monthly','Weekly + Monthly + Annually','Quarterly','Annually'));
CREATE OR REPLACE FUNCTION erp_private.schedule_occurrences(freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH periods AS (
 SELECT 'Weekly'::text kind,d::date first_day,(d+interval '6 days')::date last_day FROM generate_series(date_trunc('week',starts::timestamp),ends::timestamp,interval '7 days') d
 WHERE freq IN ('Weekly','Weekly + Monthly','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Monthly',d::date,(d+interval '1 month -1 day')::date FROM generate_series(date_trunc('month',starts::timestamp),ends::timestamp,interval '1 month') d
 WHERE freq IN ('Monthly','Weekly + Monthly','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Quarterly',d::date,(d+interval '3 months -1 day')::date FROM generate_series(date_trunc('quarter',starts::timestamp),ends::timestamp,interval '3 months') d WHERE freq='Quarterly'
 UNION ALL SELECT 'Annually',d::date,(d+interval '1 year -1 day')::date FROM generate_series(date_trunc('year',starts::timestamp),ends::timestamp,interval '1 year') d WHERE freq IN ('Annually','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Once-off',starts,ends WHERE freq='Once-off'
 ), templates(key,label,kind,release_day,due_day,doc,review,obligation) AS (VALUES
 ('weekly-sales','Upload weekly sales','Weekly',0,6,true,false,''),
 ('weekly-purchases','Upload weekly purchases','Weekly',0,6,true,false,''),
 ('weekly-bank','Upload bank transactions','Weekly',0,6,true,false,''),
 ('weekly-mapping','Map purchases and reconcile bank','Weekly',0,6,false,false,''),
 ('weekly-review','Review weekly tax compilation','Weekly',0,6,false,true,''),
 ('weekly-report','Prepare weekly client report','Weekly',0,6,false,false,''),
 ('monthly-compile','Compile monthly tax schedules','Monthly',1,5,false,false,''),
 ('monthly-review','Review monthly tax compilation','Monthly',1,6,false,true,''),
 ('monthly-report','Prepare monthly client report','Monthly',1,7,false,false,''),
 ('monthly-paye','File PAYE return','Monthly',6,7,false,false,'PAYE'),
 ('monthly-vat','File VAT return','Monthly',15,18,false,false,'VAT'),
 ('monthly-tot','File TOT return','Monthly',15,18,false,false,'TOT'),
 ('annual-compile','Prepare annual tax schedules','Annually',1,365,false,false,''),
 ('annual-review','Review annual tax compilation','Annually',335,365,false,true,''),
 ('annual-report','Prepare annual client report','Annually',349,365,false,false,''),
 ('monthly-payroll','Prepare payroll','Monthly',22,25,false,false,'Payroll')),
 occurrences AS (
 SELECT t.key,t.label,p.first_day,p.last_day,
 CASE WHEN p.kind='Annually' THEN p.first_day::timestamp+(t.release_day-1)*interval '1 day'+interval '1 minute' WHEN p.kind='Weekly' THEN p.first_day::timestamp+interval '1 minute'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.release_day-1)*interval '1 day'+interval '1 minute' END rel,
 CASE WHEN p.kind='Annually' THEN p.last_day::timestamp+interval '23 hours 59 minutes' WHEN p.kind='Weekly' THEN p.last_day::timestamp+interval '23 hours 59 minutes'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.due_day-1)*interval '1 day'+interval '23 hours 59 minutes' END due,
 t.doc,t.review FROM periods p JOIN templates t ON t.kind=p.kind
 WHERE pack_name='Tax Compilation' AND (t.obligation='' OR t.obligation=ANY(obligations))
 UNION ALL
 SELECT 'general-'||lower(p.kind),'Complete '||lower(p.kind)||' project work',p.first_day,p.last_day,
 greatest(p.first_day,starts)::timestamp+interval '1 minute',least(p.last_day,ends)::timestamp+interval '23 hours 59 minutes',false,false
 FROM periods p WHERE pack_name='General' OR p.kind IN ('Once-off','Quarterly')
 ) SELECT key,label,first_day,last_day,
 greatest(rel,starts::timestamp+interval '1 minute',CASE WHEN key LIKE 'annual-%' THEN effective::timestamp+interval '1 minute' ELSE rel END) AT TIME ZONE 'Africa/Nairobi',due AT TIME ZONE 'Africa/Nairobi',doc,review
 FROM occurrences WHERE last_day>=starts AND first_day<=ends AND (effective<=starts OR first_day>=effective OR (key LIKE 'annual-%' AND last_day>=effective))
 AND (key NOT LIKE 'annual-%' OR rel<ends::timestamp+interval '1 day')
 AND (greatest(rel,starts::timestamp+interval '1 minute',CASE WHEN key LIKE 'annual-%' THEN effective::timestamp+interval '1 minute' ELSE rel END) AT TIME ZONE 'Africa/Nairobi')<=through_at
 ORDER BY rel,key
$$;

CREATE FUNCTION erp_private.audit_eqr_only() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.projects WHERE project_id=NEW.project_id AND service_code LIKE 'AUD-%') THEN
  NEW.eqr_required=false;NEW.eqr_reviewer_id=null;NEW.eqr_document_id=null;NEW.eqr_cleared_by=null;
  IF NEW.stage='EQR' THEN NEW.stage='Manager Review';END IF;
 END IF;RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.audit_eqr_only() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.audit_eqr_only() TO erp_api;
CREATE TRIGGER audit_eqr_only BEFORE INSERT OR UPDATE ON erp_private.engagement_controls FOR EACH ROW EXECUTE FUNCTION erp_private.audit_eqr_only();
UPDATE erp_private.engagement_controls e SET eqr_required=false,eqr_reviewer_id=null,eqr_document_id=null,eqr_cleared_by=null,stage=CASE WHEN stage='EQR' THEN 'Manager Review' ELSE stage END
WHERE (eqr_required OR eqr_reviewer_id IS NOT NULL OR eqr_document_id IS NOT NULL OR stage='EQR') AND EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=e.project_id AND p.service_code NOT LIKE 'AUD-%');
