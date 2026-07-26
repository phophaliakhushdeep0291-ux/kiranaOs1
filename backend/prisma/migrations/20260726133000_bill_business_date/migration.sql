PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- SQLite cannot add a NOT NULL column with CURRENT_TIMESTAMP through ALTER TABLE.
-- Rebuild the financial tables so the database default still matches the Prisma schema,
-- while backfilling historical rows with the time the event was originally recorded.
CREATE TABLE "new_Bill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    "billNo" TEXT NOT NULL,
    "billType" TEXT NOT NULL DEFAULT 'normal_sale',
    "status" TEXT NOT NULL DEFAULT 'active',
    "customerId" TEXT,
    "customerName" TEXT NOT NULL DEFAULT 'Walk-in',
    "buyerGstin" TEXT,
    "buyerStateCode" TEXT,
    "buyerAddress" TEXT,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "subtotalPaise" BIGINT,
    "discount" REAL NOT NULL DEFAULT 0,
    "discountPaise" BIGINT,
    "discountReason" TEXT,
    "offerId" TEXT,
    "offerCode" TEXT,
    "offerDiscount" REAL NOT NULL DEFAULT 0,
    "offerDiscountPaise" BIGINT,
    "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "loyaltyDiscount" REAL NOT NULL DEFAULT 0,
    "loyaltyDiscountPaise" BIGINT,
    "giftCardAmount" REAL NOT NULL DEFAULT 0,
    "giftCardAmountPaise" BIGINT,
    "gst" REAL NOT NULL DEFAULT 0,
    "gstPaise" BIGINT,
    "gstMode" TEXT NOT NULL DEFAULT 'inclusive',
    "grandTotal" REAL NOT NULL DEFAULT 0,
    "grandTotalPaise" BIGINT,
    "actualAmount" REAL NOT NULL DEFAULT 0,
    "actualAmountPaise" BIGINT,
    "buyerPaidAmount" REAL NOT NULL DEFAULT 0,
    "buyerPaidAmountPaise" BIGINT,
    "waivedAmount" REAL NOT NULL DEFAULT 0,
    "waivedAmountPaise" BIGINT,
    "grossProfit" REAL NOT NULL DEFAULT 0,
    "grossProfitPaise" BIGINT,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "paidAmountPaise" BIGINT,
    "creditAmount" REAL NOT NULL DEFAULT 0,
    "creditAmountPaise" BIGINT,
    "createdByUserId" TEXT,
    "deviceId" TEXT,
    "clientBillId" TEXT,
    "idempotencyKey" TEXT,
    "sourceDeviceId" TEXT,
    "cancelledAt" DATETIME,
    "cancelledReason" TEXT,
    "returnOfBillId" TEXT,
    "refundMode" TEXT,
    "businessDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bill_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bill_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Bill" (
    "id", "shopId", "locationId", "billNo", "billType", "status", "customerId", "customerName",
    "buyerGstin", "buyerStateCode", "buyerAddress", "subtotal", "subtotalPaise", "discount",
    "discountPaise", "discountReason", "offerId", "offerCode", "offerDiscount", "offerDiscountPaise",
    "loyaltyPointsRedeemed", "loyaltyDiscount", "loyaltyDiscountPaise", "giftCardAmount",
    "giftCardAmountPaise", "gst", "gstPaise", "gstMode", "grandTotal", "grandTotalPaise",
    "actualAmount", "actualAmountPaise", "buyerPaidAmount", "buyerPaidAmountPaise", "waivedAmount",
    "waivedAmountPaise", "grossProfit", "grossProfitPaise", "paidAmount", "paidAmountPaise",
    "creditAmount", "creditAmountPaise", "createdByUserId", "deviceId", "clientBillId",
    "idempotencyKey", "sourceDeviceId", "cancelledAt", "cancelledReason", "returnOfBillId",
    "refundMode", "businessDate", "createdAt", "updatedAt"
)
SELECT
    "id", "shopId", "locationId", "billNo", "billType", "status", "customerId", "customerName",
    "buyerGstin", "buyerStateCode", "buyerAddress", "subtotal", "subtotalPaise", "discount",
    "discountPaise", "discountReason", "offerId", "offerCode", "offerDiscount", "offerDiscountPaise",
    "loyaltyPointsRedeemed", "loyaltyDiscount", "loyaltyDiscountPaise", "giftCardAmount",
    "giftCardAmountPaise", "gst", "gstPaise", "gstMode", "grandTotal", "grandTotalPaise",
    "actualAmount", "actualAmountPaise", "buyerPaidAmount", "buyerPaidAmountPaise", "waivedAmount",
    "waivedAmountPaise", "grossProfit", "grossProfitPaise", "paidAmount", "paidAmountPaise",
    "creditAmount", "creditAmountPaise", "createdByUserId", "deviceId", "clientBillId",
    "idempotencyKey", "sourceDeviceId", "cancelledAt", "cancelledReason", "returnOfBillId",
    "refundMode", "createdAt", "createdAt", "updatedAt"
FROM "Bill";

DROP TABLE "Bill";
ALTER TABLE "new_Bill" RENAME TO "Bill";

CREATE UNIQUE INDEX "Bill_shopId_billNo_key" ON "Bill"("shopId", "billNo");
CREATE UNIQUE INDEX "Bill_shopId_idempotencyKey_key" ON "Bill"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX "Bill_shopId_sourceDeviceId_clientBillId_key" ON "Bill"("shopId", "sourceDeviceId", "clientBillId");
CREATE INDEX "Bill_shopId_status_createdAt_idx" ON "Bill"("shopId", "status", "createdAt");
CREATE INDEX "Bill_shopId_createdByUserId_createdAt_idx" ON "Bill"("shopId", "createdByUserId", "createdAt");
CREATE INDEX "Bill_shopId_locationId_status_createdAt_idx" ON "Bill"("shopId", "locationId", "status", "createdAt");
CREATE INDEX "Bill_shopId_businessDate_idx" ON "Bill"("shopId", "businessDate");
CREATE INDEX "Bill_shopId_status_businessDate_idx" ON "Bill"("shopId", "status", "businessDate");
CREATE INDEX "Bill_shopId_locationId_status_businessDate_idx" ON "Bill"("shopId", "locationId", "status", "businessDate");
CREATE INDEX "Bill_shopId_returnOfBillId_idx" ON "Bill"("shopId", "returnOfBillId");
CREATE INDEX "Bill_shopId_offerId_status_idx" ON "Bill"("shopId", "offerId", "status");
CREATE INDEX "Bill_shopId_updatedAt_id_idx" ON "Bill"("shopId", "updatedAt", "id");

CREATE TRIGGER "sync_bill_insert" AFTER INSERT ON "Bill" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (NEW."shopId",'bill',NEW."id",'insert','{}',CURRENT_TIMESTAMP); END;
CREATE TRIGGER "sync_bill_update" AFTER UPDATE ON "Bill" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (NEW."shopId",'bill',NEW."id",'update','{}',CURRENT_TIMESTAMP); END;
CREATE TRIGGER "sync_bill_delete" AFTER DELETE ON "Bill" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (OLD."shopId",'bill',OLD."id",'delete','{}',CURRENT_TIMESTAMP); END;

CREATE TABLE "new_UdharLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "amountPaise" BIGINT,
    "mode" TEXT NOT NULL,
    "billId" TEXT,
    "billNo" TEXT,
    "clientLedgerId" TEXT,
    "idempotencyKey" TEXT,
    "sourceDeviceId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "reversedAt" DATETIME,
    "reversedReason" TEXT,
    "reversalOfLedgerId" TEXT,
    "reversedByUserId" TEXT,
    "businessDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UdharLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UdharLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UdharLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UdharLedger_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_UdharLedger" (
    "id", "shopId", "locationId", "customerId", "customerName", "type", "amount", "amountPaise",
    "mode", "billId", "billNo", "clientLedgerId", "idempotencyKey", "sourceDeviceId", "sourceType",
    "sourceId", "note", "reversedAt", "reversedReason", "reversalOfLedgerId", "reversedByUserId",
    "businessDate", "createdAt", "updatedAt"
)
SELECT
    "id", "shopId", "locationId", "customerId", "customerName", "type", "amount", "amountPaise",
    "mode", "billId", "billNo", "clientLedgerId", "idempotencyKey", "sourceDeviceId", "sourceType",
    "sourceId", "note", "reversedAt", "reversedReason", "reversalOfLedgerId", "reversedByUserId",
    "createdAt", "createdAt", "updatedAt"
FROM "UdharLedger";

DROP TABLE "UdharLedger";
ALTER TABLE "new_UdharLedger" RENAME TO "UdharLedger";

CREATE UNIQUE INDEX "UdharLedger_shopId_idempotencyKey_key" ON "UdharLedger"("shopId", "idempotencyKey");
CREATE INDEX "UdharLedger_shopId_customerId_createdAt_idx" ON "UdharLedger"("shopId", "customerId", "createdAt");
CREATE INDEX "UdharLedger_shopId_locationId_createdAt_idx" ON "UdharLedger"("shopId", "locationId", "createdAt");
CREATE INDEX "UdharLedger_shopId_customerId_businessDate_idx" ON "UdharLedger"("shopId", "customerId", "businessDate");
CREATE INDEX "UdharLedger_shopId_locationId_businessDate_idx" ON "UdharLedger"("shopId", "locationId", "businessDate");
CREATE INDEX "UdharLedger_shopId_reversalOfLedgerId_idx" ON "UdharLedger"("shopId", "reversalOfLedgerId");
CREATE INDEX "UdharLedger_shopId_sourceType_sourceId_idx" ON "UdharLedger"("shopId", "sourceType", "sourceId");
CREATE INDEX "UdharLedger_shopId_updatedAt_id_idx" ON "UdharLedger"("shopId", "updatedAt", "id");

CREATE TRIGGER "sync_udharledger_insert" AFTER INSERT ON "UdharLedger" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (NEW."shopId",'udhar_ledger',NEW."id",'insert','{}',CURRENT_TIMESTAMP); END;
CREATE TRIGGER "sync_udharledger_update" AFTER UPDATE ON "UdharLedger" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (NEW."shopId",'udhar_ledger',NEW."id",'update','{}',CURRENT_TIMESTAMP); END;
CREATE TRIGGER "sync_udharledger_delete" AFTER DELETE ON "UdharLedger" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (OLD."shopId",'udhar_ledger',OLD."id",'delete','{}',CURRENT_TIMESTAMP); END;

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
