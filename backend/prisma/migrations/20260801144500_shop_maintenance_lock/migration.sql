CREATE TABLE "ShopMaintenanceLock" (
    "shopId" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lockedByUserId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ShopMaintenanceLock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ShopMaintenanceLock_expiresAt_idx" ON "ShopMaintenanceLock"("expiresAt");
