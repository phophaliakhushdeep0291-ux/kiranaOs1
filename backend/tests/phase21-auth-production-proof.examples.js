import assert from "assert/strict";
import { readFileSync } from "fs";

const authMiddleware = readFileSync("src/middleware/auth.js", "utf8");
const authService = readFileSync("src/modules/auth/auth.service.js", "utf8");
const authController = readFileSync("src/modules/auth/auth.controller.js", "utf8");
const sqliteSchema = readFileSync("prisma/schema.prisma", "utf8");
const pgSchema = readFileSync("prisma-postgres/schema.prisma", "utf8");
const pgMigration = readFileSync("prisma-postgres/migrations/000007_user_session_security/migration.sql", "utf8");
const preflight = readFileSync("scripts/production-preflight.js", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

for (const schema of [sqliteSchema, pgSchema]) {
  assert.ok(schema.includes("disabledAt   DateTime?"), "User must support soft staff deactivation");
  assert.ok(schema.includes("revokedReason"), "Session must record revocation reason");
}

assert.ok(pgMigration.includes('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabledAt"'), "PostgreSQL migration must add User.disabledAt safely");
assert.ok(pgMigration.includes('ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "revokedReason"'), "PostgreSQL migration must add Session.revokedReason safely");
assert.ok(pgMigration.includes('"User_shopId_disabledAt_idx"'), "disabled users need a shop-scoped lookup index");

for (const snippet of [
  "db.user.findFirst",
  "disabledAt: null",
  "USER_SESSION_INACTIVE",
  "role: user.role",
]) {
  assert.ok(authMiddleware.includes(snippet), `requireAuth must verify active DB user and fresh role: ${snippet}`);
}
assert.match(
  authMiddleware,
  /req\.user = \{\s*\.\.\.payload/s,
  "requireAuth must preserve compatible JWT payload fields while replacing role/shop/user from DB"
);

for (const snippet of [
  "REFRESH_TOKEN_REUSE_DETECTED",
  "USER_DISABLED",
  "PASSWORD_CHANGED",
  "STAFF_DISABLED",
  "revokedReason",
  "mobile: null",
  "email: null",
  "createAuditLog",
]) {
  assert.ok(authService.includes(snippet), `auth service missing production session/staff hardening: ${snippet}`);
}

assert.ok(!authService.includes("await db.user.delete({ where: { id: staffId } })"), "staff removal must not hard-delete audited users");
assert.ok(authController.includes("{ req }"), "staff disable audit should receive request metadata");

for (const snippet of [
  "DATABASE_URL must use PostgreSQL",
  "JWT_SECRET must be unique",
  "ALLOWED_ORIGINS",
  "ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION",
  "METRICS_TOKEN",
  "RAZORPAY_ENABLED",
  "STORAGE_PROVIDER",
  "production_preflight",
]) {
  assert.ok(preflight.includes(snippet), `production preflight missing guard: ${snippet}`);
}

assert.ok(packageJson.scripts["prod:preflight"]?.includes("production-preflight.js"), "package.json must expose prod:preflight");
assert.ok(packageJson.scripts["test:billing"].includes("phase21-auth-production-proof.examples.js"), "Phase 21 tests must be wired into npm test");

console.log("Phase 21 auth production proof examples passed");
