-- Customer self-order inbox: orders a customer submits from the public QR page,
-- landing in the owner's "Orders Received" list to convert into a bill.
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerMobile" TEXT NOT NULL,
    "customerAddress" TEXT,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "billId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerOrder_shopId_status_createdAt_idx" ON "CustomerOrder"("shopId", "status", "createdAt");

ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
