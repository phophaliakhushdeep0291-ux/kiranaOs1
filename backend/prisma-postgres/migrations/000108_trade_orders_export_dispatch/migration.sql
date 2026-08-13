CREATE TABLE IF NOT EXISTS "TradeOrder" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "orderNumber" TEXT NOT NULL,
  "buyerPoNumber" TEXT, "customerId" TEXT, "customerName" TEXT NOT NULL, "customerGstin" TEXT,
  "billingAddress" TEXT, "shippingAddress" TEXT, "orderType" TEXT NOT NULL DEFAULT 'domestic',
  "status" TEXT NOT NULL DEFAULT 'draft', "currencyCode" TEXT NOT NULL DEFAULT 'INR',
  "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1, "priceBasis" TEXT, "requestedDeliveryDate" TIMESTAMP(3),
  "iec" TEXT, "lutBondReference" TEXT, "countryOfDestination" TEXT, "countryOfOrigin" TEXT,
  "portOfLoading" TEXT, "portOfDischarge" TEXT, "incoterm" TEXT, "paymentTerms" TEXT, "notes" TEXT,
  "billId" TEXT, "confirmedAt" TIMESTAMP(3), "allocatedAt" TIMESTAMP(3), "packedAt" TIMESTAMP(3),
  "dispatchedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "TradeOrder_shopId_orderNumber_key" ON "TradeOrder"("shopId", "orderNumber");
CREATE INDEX IF NOT EXISTS "TradeOrder_shopId_status_createdAt_idx" ON "TradeOrder"("shopId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeOrder_shopId_buyerPoNumber_idx" ON "TradeOrder"("shopId", "buyerPoNumber");
CREATE INDEX IF NOT EXISTS "TradeOrder_shopId_customerId_createdAt_idx" ON "TradeOrder"("shopId", "customerId", "createdAt");
CREATE TABLE IF NOT EXISTS "TradeOrderItem" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "productId" TEXT NOT NULL,
  "sellingUnitId" TEXT, "sku" TEXT, "buyerProductCode" TEXT, "description" TEXT NOT NULL, "hsn" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL, "quantityBaseQty" DOUBLE PRECISION NOT NULL, "unitPrice" DOUBLE PRECISION NOT NULL,
  "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0, "lineDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lineTotal" DOUBLE PRECISION NOT NULL, "packedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TradeOrderItem_shopId_productId_idx" ON "TradeOrderItem"("shopId", "productId");
CREATE INDEX IF NOT EXISTS "TradeOrderItem_orderId_idx" ON "TradeOrderItem"("orderId");
CREATE TABLE IF NOT EXISTS "TradeOrderAllocation" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "orderItemId" TEXT NOT NULL, "inventoryLotId" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL, "quantityBaseQty" DOUBLE PRECISION NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeOrderAllocation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "TradeOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TradeOrderAllocation_orderItemId_inventoryLotId_key" ON "TradeOrderAllocation"("orderItemId", "inventoryLotId");
CREATE INDEX IF NOT EXISTS "TradeOrderAllocation_shopId_inventoryLotId_idx" ON "TradeOrderAllocation"("shopId", "inventoryLotId");
CREATE TABLE IF NOT EXISTS "TradeDispatch" (
  "id" TEXT PRIMARY KEY, "shopId" TEXT NOT NULL, "orderId" TEXT NOT NULL UNIQUE, "dispatchNumber" TEXT NOT NULL,
  "dispatchDate" TIMESTAMP(3) NOT NULL, "transporterName" TEXT, "transporterGstin" TEXT, "vehicleNumber" TEXT,
  "lrAwbNumber" TEXT, "ewayBillNumber" TEXT, "shippingBillNumber" TEXT, "shippingBillDate" TIMESTAMP(3),
  "containerNumber" TEXT, "packageCount" DOUBLE PRECISION, "netWeight" DOUBLE PRECISION, "grossWeight" DOUBLE PRECISION,
  "sealNumber" TEXT, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeDispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TradeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TradeDispatch_shopId_dispatchNumber_key" ON "TradeDispatch"("shopId", "dispatchNumber");
CREATE INDEX IF NOT EXISTS "TradeDispatch_shopId_dispatchDate_idx" ON "TradeDispatch"("shopId", "dispatchDate");
