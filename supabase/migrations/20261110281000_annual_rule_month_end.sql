-- Annual due-date rules: a blank day means "the last day of that month" (build 2026-11-10.2771), from the Partner's answer of 10 Nov 2026 20:53.
-- Companies and partnerships: the period end plus six months, then the last day of the resulting month (30 June for a 31 December year end, 31 December for a 30 June year end).
-- The Individual rule is unchanged (starts with periods ending on or after 31 December 2026; 4 months, day 30 = 30 April) and still needs the Tax Lead's check against the Finance Act 2026.
ALTER TABLE erp_private.annual_due_rules ALTER COLUMN external_deadline_day DROP NOT NULL;
UPDATE erp_private.annual_due_rules SET external_deadline_day=NULL,
 source_note='Partner answer of 10 Nov 2026 20:53: due the last day of the sixth month after the period end (30 June for 31 December, 31 December for 30 June); internal 31 May. Not yet checked by the Tax Lead.'
 WHERE tax_kind IN('Company','Partnership') AND rule_status='Suggested';

CREATE OR REPLACE FUNCTION erp_private.rule_date(p_ends date,p_months integer,p_day integer) RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT make_date(extract(year FROM m)::int,extract(month FROM m)::int,CASE WHEN p_day IS NULL THEN extract(day FROM (m+interval '1 month'-interval '1 day'))::int ELSE least(p_day,extract(day FROM (m+interval '1 month'-interval '1 day'))::int) END)
 FROM (SELECT (date_trunc('month',p_ends)+make_interval(months=>p_months))::date AS m) x
$$;
CREATE OR REPLACE FUNCTION erp_private.period_due_rule_text(p_kind text,p_ends date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE erp_private.period_due_class(p_kind)
  WHEN 'PAYE' THEN '9th of the following month' WHEN 'VAT' THEN '20th of the following month'
  WHEN 'ANNUAL' THEN (SELECT format('%s: %s months after the period end, %s (%s)',r.tax_kind,r.due_month_offset,CASE WHEN r.external_deadline_day IS NULL THEN 'on the last day of that month' ELSE 'on day '||r.external_deadline_day END,CASE r.rule_status WHEN 'Confirmed' THEN 'rule confirmed by a Partner' ELSE 'rule suggested, not yet confirmed by a Partner' END) FROM erp_private.annual_due_rules r WHERE r.rule_id=erp_private.annual_due_rule_row(p_kind,p_ends)) END
$$;
-- A blank day is allowed when a Partner changes a rule.
DO $patch$ DECLARE d text;o text; BEGIN
 d:=pg_get_functiondef('erp_private.annual_due_rule_set(uuid,integer,integer,integer,integer)'::regprocedure);
 o:='IF p_day NOT BETWEEN 1 AND 31 OR p_int_day NOT BETWEEN 1 AND 31 THEN'; IF position(o IN d)=0 THEN RAISE EXCEPTION 'rule_set patch'; END IF;
 EXECUTE replace(d,o,'IF (p_day IS NOT NULL AND p_day NOT BETWEEN 1 AND 31) OR p_int_day NOT BETWEEN 1 AND 31 THEN');
END $patch$;
