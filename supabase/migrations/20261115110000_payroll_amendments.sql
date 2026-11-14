-- Build 2806: a confirmed payroll month can be amended the same way a confirmed sales period can. Someone asks with a reason, a different Manager or Partner approves,
-- the posted entries built from it are reversed (reviewed and posted by yet another approver), and then a corrected run replaces it or it is withdrawn.
-- The guard, states and approvals are unchanged; only the kind of summary that may be amended grows.
ALTER TABLE erp_private.import_amendments DROP CONSTRAINT import_amendments_kind_check;
ALTER TABLE erp_private.import_amendments ADD CONSTRAINT import_amendments_kind_check CHECK(kind IN('Sales','Payroll'));
