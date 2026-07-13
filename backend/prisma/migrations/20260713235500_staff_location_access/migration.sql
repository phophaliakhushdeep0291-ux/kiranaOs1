CREATE TABLE "UserLocationAccess" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "canSell" BOOLEAN NOT NULL DEFAULT true,
  "canPurchase" BOOLEAN NOT NULL DEFAULT false,
  "canManageInventory" BOOLEAN NOT NULL DEFAULT false,
  "canTransfer" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "UserLocationAccess_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserLocationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserLocationAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserLocationAccess_userId_locationId_key" ON "UserLocationAccess"("userId", "locationId");
CREATE INDEX "UserLocationAccess_shopId_locationId_active_idx" ON "UserLocationAccess"("shopId", "locationId", "active");
CREATE INDEX "UserLocationAccess_shopId_userId_active_idx" ON "UserLocationAccess"("shopId", "userId", "active");
