PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_ChangeLog" (
  "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "shopId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChangeLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_ChangeLog" ("seq", "shopId", "entityType", "entityId", "operation", "payloadJson", "createdAt")
SELECT "seq", "shopId", "entityType", "entityId", "operation", "payloadJson", "createdAt" FROM "ChangeLog";

DROP TABLE "ChangeLog";
ALTER TABLE "new_ChangeLog" RENAME TO "ChangeLog";
CREATE INDEX "ChangeLog_shopId_seq_idx" ON "ChangeLog"("shopId", "seq");
CREATE INDEX "ChangeLog_shopId_entityType_entityId_idx" ON "ChangeLog"("shopId", "entityType", "entityId");

DROP TRIGGER IF EXISTS "sync_product_delete";
DROP TRIGGER IF EXISTS "sync_customer_delete";
DROP TRIGGER IF EXISTS "sync_bill_delete";
DROP TRIGGER IF EXISTS "sync_stockledger_delete";
DROP TRIGGER IF EXISTS "sync_udharledger_delete";
DROP TRIGGER IF EXISTS "sync_supplier_delete";
DROP TRIGGER IF EXISTS "sync_purchasehistory_delete";
DROP TRIGGER IF EXISTS "sync_expense_delete";
DROP TRIGGER IF EXISTS "sync_product_selling_unit_delete";
DROP TRIGGER IF EXISTS "sync_bill_item_delete";
DROP TRIGGER IF EXISTS "sync_payment_delete";

CREATE TRIGGER "sync_product_delete" AFTER DELETE ON "Product" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'product',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_customer_delete" AFTER DELETE ON "Customer" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'customer',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_bill_delete" AFTER DELETE ON "Bill" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'bill',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_stockledger_delete" AFTER DELETE ON "StockLedger" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'stock_ledger',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_udharledger_delete" AFTER DELETE ON "UdharLedger" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'udhar_ledger',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_supplier_delete" AFTER DELETE ON "Supplier" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'supplier',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_purchasehistory_delete" AFTER DELETE ON "PurchaseHistory" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'purchase_history',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_expense_delete" AFTER DELETE ON "Expense" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'expense',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END;
CREATE TRIGGER "sync_product_selling_unit_delete" AFTER DELETE ON "ProductSellingUnit" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT p."shopId",'product',OLD."productId",'update','{}',CURRENT_TIMESTAMP FROM "Product" p JOIN "Shop" s ON s."id"=p."shopId" WHERE p."id"=OLD."productId"; END;
CREATE TRIGGER "sync_bill_item_delete" AFTER DELETE ON "BillItem" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT b."shopId",'bill',OLD."billId",'update','{}',CURRENT_TIMESTAMP FROM "Bill" b JOIN "Shop" s ON s."id"=b."shopId" WHERE b."id"=OLD."billId"; END;
CREATE TRIGGER "sync_payment_delete" AFTER DELETE ON "Payment" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT b."shopId",'bill',OLD."billId",'update','{}',CURRENT_TIMESTAMP FROM "Bill" b JOIN "Shop" s ON s."id"=b."shopId" WHERE b."id"=OLD."billId"; END;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
