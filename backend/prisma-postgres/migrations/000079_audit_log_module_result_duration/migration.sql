-- §2 Complete Audit Log — the spec requires every event to carry Device, Module,
-- Result and Duration alongside the existing user/shop/before/after fields.
-- @replay-safe: every column and index is additive and guarded, so an interrupted
-- deploy can replay this migration without error.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "module" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "result" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "durationMs" INTEGER;

-- Filtering the timeline by module ("show me everything billing did") and by
-- result ("show me only the failures") are the two reconstruction queries the
-- incident report and admin dashboard run most.
CREATE INDEX IF NOT EXISTS "AuditLog_shopId_module_createdAt_idx"
  ON "AuditLog" ("shopId", "module", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_shopId_result_createdAt_idx"
  ON "AuditLog" ("shopId", "result", "createdAt");
