CREATE TABLE "TradeOrder" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL, "buyerPoNumber" TEXT, "customerId" TEXT, "customerName" TEXT NOT NULL,
  "customerGstin" TEXT, "billingAddress" TEXT, "shippingAddress" TEXT,
  "orderType" TEXT NOT NULL DEFAULT 'domestic', "status" TEXT NOT NULL DEFAULT 'draft',
  "currencyCode" TEXT NOT NULL DEFAULT 'INR', "exchangeRate" REAL NOT NULL DEFAULT 1,
  "priceBasis" TEXT, "requestedDeliveryDate" DATETIME, "iec" TEXT, "lutBondReference" TEXT,
  "countryOfDestination" TEXT, "countryOfOrigin" TEXT, "portOfLoading" TEXT, "portOfDischarge" TEXT,
  "incoterm" TEXT, "paymentTerms" TEXT, "notes" TEXT, "billId" TEXT,
  "confirmedAt" DATETIME, "allocatedAt" DATETIME, "packedAt" DATETIME,
  "dispatchedAt" DATETIME, "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "TradeOrder_shopId_orderNumber_key" ON "TradeOrder"("shopId", "orderNumber");
CREATE INDEX "TradeOrder_shopId_status_createdAt_idx" ON "TradeOrder"("shopId", "status", "createdAt");
CREATE INDEX "TradeOrder_shopId_buyerPoNumber_idx" ON "TradeOrder"("shopId", "buyerPoNumber");
CREATE INDEX "TradeOrder_shopId_customerId_createdAt_idx" ON "TradeOrder"("shopId", "customerId", "createdAt");

CREATE TABLE "TradeOrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL, "sellingUnitId" TEXT, "sku" TEXT, "buyerProductCode" TEXT,
  "description" TEXT NOT NULL, "hsn" TEXT, "quantity" REAL NOT NULL, "quantityBaseQty" REAL NOT NULL,
  "unitPrice" REAL NOT NULL, "gstRate" REAL NOT NULL DEFAULT 0, "lineDiscount" REAL NOT NULL DEFAULT 0,
  "lineTotal" REAL NOT NULL, "packedQuantity" REAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TradeOrderItem_shopId_productId_idx" ON "TradeOrderItem"("shopId", "productId");
CREATE INDEX "TradeOrderItem_orderId_idx" ON "TradeOrderItem"("orderId");

CREATE TABLE "TradeOrderAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "orderItemId" TEXT NOT NULL,
  "inventoryLotId" TEXT NOT NULL, "batchNumber" TEXT NOT NULL, "quantityBaseQty" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeOrderAllocation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeOrderAllocation_orderItemId_inventoryLotId_key" ON "TradeOrderAllocation"("orderItemId", "inventoryLotId");
CREATE INDEX "TradeOrderAllocation_shopId_inventoryLotId_idx" ON "TradeOrderAllocation"("shopId", "inventoryLotId");

CREATE TABLE "TradeDispatch" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
  "dispatchNumber" TEXT NOT NULL, "dispatchDate" DATETIME NOT NULL, "transporterName" TEXT,
  "transporterGstin" TEXT, "vehicleNumber" TEXT, "lrAwbNumber" TEXT, "ewayBillNumber" TEXT,
  "shippingBillNumber" TEXT, "shippingBillDate" DATETIME, "containerNumber" TEXT,
  "packageCount" REAL, "netWeight" REAL, "grossWeight" REAL, "sealNumber" TEXT, "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TradeDispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeDispatch_orderId_key" ON "TradeDispatch"("orderId");
CREATE UNIQUE INDEX "TradeDispatch_shopId_dispatchNumber_key" ON "TradeDispatch"("shopId", "dispatchNumber");
CREATE INDEX "TradeDispatch_shopId_dispatchDate_idx" ON "TradeDispatch"("shopId", "dispatchDate");
