-- @replay-safe: table and index creation are guarded, so interrupted deploys can replay.
CREATE TABLE IF NOT EXISTS "ShopMaintenanceLock" (
    "shopId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "lockedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopMaintenanceLock_pkey" PRIMARY KEY ("shopId"),
    CONSTRAINT "ShopMaintenanceLock_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ShopMaintenanceLock_expiresAt_idx" ON "ShopMaintenanceLock"("expiresAt");
