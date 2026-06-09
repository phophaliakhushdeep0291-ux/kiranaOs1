-- Phase 21: user/session security hardening.
-- Keep audited users as soft-disabled records, block stale JWTs after staff removal,
-- and record why refresh sessions were revoked.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

CREATE INDEX IF NOT EXISTS "User_shopId_disabledAt_idx" ON "User"("shopId", "disabledAt");
CREATE INDEX IF NOT EXISTS "Session_userId_revokedAt_expiresAt_idx" ON "Session"("userId", "revokedAt", "expiresAt");
