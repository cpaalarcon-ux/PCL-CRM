-- Build 2863: the stored set-up time baseline (build 2861) is withdrawn. The firm gauges the time saved itself, so the system no longer keeps a baseline or target.
-- Staging only; nothing was recorded against it. The set-up time report from build 2807 is unchanged.
DROP TABLE IF EXISTS erp_private.setup_baselines;
DROP FUNCTION IF EXISTS erp_private.setup_baselines_guard();
