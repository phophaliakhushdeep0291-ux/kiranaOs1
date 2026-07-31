-- Expenses are first-class offline entities. Seed existing rows, then publish
-- every insert/update/delete into the monotonic per-shop sync feed.
INSERT INTO "ChangeLog" ("shopId", "entityType", "entityId", "operation", "payloadJson", "createdAt")
SELECT "shopId", 'expense', "id", 'insert', '{}', CURRENT_TIMESTAMP
FROM "Expense";

CREATE TRIGGER sync_expense_change
AFTER INSERT OR UPDATE OR DELETE ON "Expense"
FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('expense');
