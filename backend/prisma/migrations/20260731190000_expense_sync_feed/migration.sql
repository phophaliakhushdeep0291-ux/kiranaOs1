INSERT INTO "ChangeLog" ("shopId", "entityType", "entityId", "operation", "payloadJson", "createdAt")
SELECT "shopId", 'expense', "id", 'insert', '{}', CURRENT_TIMESTAMP FROM "Expense";

CREATE TRIGGER "sync_expense_insert" AFTER INSERT ON "Expense" BEGIN
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  VALUES (NEW."shopId",'expense',NEW."id",'insert','{}',CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_expense_update" AFTER UPDATE ON "Expense" BEGIN
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  VALUES (NEW."shopId",'expense',NEW."id",'update','{}',CURRENT_TIMESTAMP);
END;
CREATE TRIGGER "sync_expense_delete" AFTER DELETE ON "Expense" BEGIN
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  VALUES (OLD."shopId",'expense',OLD."id",'delete','{}',CURRENT_TIMESTAMP);
END;
