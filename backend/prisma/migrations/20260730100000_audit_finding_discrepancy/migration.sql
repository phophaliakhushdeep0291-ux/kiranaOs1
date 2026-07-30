-- The gap a rule actually measured, kept apart from `amountPaise` (the size of
-- the record involved). Dashboards and reports total this column: summing record
-- sizes across entity types double-counts the same rupee and mixes inventory
-- valuation with cash. Null means no rule could put a number on the gap.
--
-- The PostgreSQL counterpart is 000070_audit_finding_discrepancy.
ALTER TABLE "AuditFinding" ADD COLUMN "discrepancyPaise" BIGINT;
