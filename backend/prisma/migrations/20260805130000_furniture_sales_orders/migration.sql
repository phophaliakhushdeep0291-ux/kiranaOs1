-- Furniture: the sales order.
--
-- The only trade in the app where the sale usually happens before the goods
-- exist or leave the floor. A showroom quotes, takes an advance, has the piece
-- made or reserved, delivers it weeks later and installs it — and for that whole
-- stretch the money and the goods are in different places. A bill cannot hold
-- that, because a bill is the moment both change hands at once.
--
-- The order is NOT a bill: it carries no tax treatment and settles nothing. When
-- the piece goes out the shop rings an ordinary bill and links it here.
--
-- productId and billId are intentionally not foreign keys: the order records a
-- promise and must outlive a purged product or a cancelled bill.

CREATE TABLE "FurnitureOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL DEFAULT '',
    "deliveryAddress" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'quote',
    "itemsTotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "deliveryCharge" REAL NOT NULL DEFAULT 0,
    "installCharge" REAL NOT NULL DEFAULT 0,
    "grandTotal" REAL NOT NULL DEFAULT 0,
    "quotedOn" DATETIME NOT NULL,
    "promisedOn" DATETIME,
    "deliveredAt" DATETIME,
    "installedAt" DATETIME,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "billId" TEXT,
    "billNumber" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FurnitureOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FurnitureOrder_shopId_orderNumber_key" ON "FurnitureOrder"("shopId", "orderNumber");
CREATE INDEX "FurnitureOrder_shopId_deletedAt_idx" ON "FurnitureOrder"("shopId", "deletedAt");
-- "What is open, and what is due?" — the two questions a showroom asks daily.
CREATE INDEX "FurnitureOrder_shopId_status_promisedOn_idx" ON "FurnitureOrder"("shopId", "status", "promisedOn");
CREATE INDEX "FurnitureOrder_shopId_customerPhone_idx" ON "FurnitureOrder"("shopId", "customerPhone");
CREATE INDEX "FurnitureOrder_shopId_quotedOn_idx" ON "FurnitureOrder"("shopId", "quotedOn");

CREATE TABLE "FurnitureOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "variant" TEXT,
    "qty" REAL NOT NULL DEFAULT 1,
    "rate" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL DEFAULT 0,
    "reserveStock" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    CONSTRAINT "FurnitureOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FurnitureOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FurnitureOrderItem_orderId_idx" ON "FurnitureOrderItem"("orderId");
CREATE INDEX "FurnitureOrderItem_productId_idx" ON "FurnitureOrderItem"("productId");

-- Advances. Several per order are normal — a booking amount, an instalment when
-- production starts, the balance on delivery — so this is a child table rather
-- than one column that could only ever hold the last one.
CREATE TABLE "FurnitureOrderPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "amount" REAL NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'cash',
    "paidOn" DATETIME NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FurnitureOrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FurnitureOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FurnitureOrderPayment_orderId_idx" ON "FurnitureOrderPayment"("orderId");
