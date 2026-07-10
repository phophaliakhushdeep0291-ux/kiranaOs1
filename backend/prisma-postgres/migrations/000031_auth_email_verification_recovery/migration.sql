ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sentToEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AuthToken_userId_type_consumedAt_idx" ON "AuthToken"("userId", "type", "consumedAt");
CREATE INDEX IF NOT EXISTS "AuthToken_shopId_type_createdAt_idx" ON "AuthToken"("shopId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuthToken_userId_fkey'
  ) THEN
    ALTER TABLE "AuthToken"
      ADD CONSTRAINT "AuthToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuthToken_shopId_fkey'
  ) THEN
    ALTER TABLE "AuthToken"
      ADD CONSTRAINT "AuthToken_shopId_fkey"
      FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
