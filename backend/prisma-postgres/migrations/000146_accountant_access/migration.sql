-- @replay-safe
CREATE TABLE IF NOT EXISTS "AccountantAccess" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "shopId" TEXT NOT NULL REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "accountantUserId" TEXT REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "tokenHash" TEXT NOT NULL,
 "inviteExpiresAt" TIMESTAMP(3) NOT NULL,
 "acceptedAt" TIMESTAMP(3),
 "revokedAt" TIMESTAMP(3),
 "createdByUserId" TEXT NOT NULL,
 "note" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "AccountantAccess_tokenHash_key" ON "AccountantAccess"("tokenHash");
CREATE INDEX IF NOT EXISTS "AccountantAccess_shopId_revokedAt_idx" ON "AccountantAccess"("shopId", "revokedAt");
CREATE INDEX IF NOT EXISTS "AccountantAccess_accountantUserId_revokedAt_idx" ON "AccountantAccess"("accountantUserId", "revokedAt");
