import assert from "assert/strict";
import { readFileSync } from "fs";

const authService = readFileSync("src/modules/auth/auth.service.js", "utf8");
const authRoutes = readFileSync("src/modules/auth/auth.routes.js", "utf8");
const authSchema = readFileSync("src/modules/auth/auth.schema.js", "utf8");
const emailService = readFileSync("src/lib/authEmail.js", "utf8");
const sqliteSchema = readFileSync("prisma/schema.prisma", "utf8");
const pgSchema = readFileSync("prisma-postgres/schema.prisma", "utf8");
const sqliteMigration = readFileSync("prisma/migrations/20260710120000_auth_email_verification_recovery/migration.sql", "utf8");
const pgMigration = readFileSync("prisma-postgres/migrations/000031_auth_email_verification_recovery/migration.sql", "utf8");

for (const schema of [sqliteSchema, pgSchema]) {
  assert.ok(schema.includes("emailVerifiedAt DateTime?"), "User must store verified email timestamp");
  assert.ok(schema.includes("model AuthToken"), "AuthToken model required for email verification and reset");
  assert.ok(schema.includes("tokenHash   String    @unique"), "Auth tokens must be stored as unique hashes");
  assert.ok(schema.includes("consumedAt  DateTime?"), "Auth tokens must be one-time consumable");
}

assert.ok(sqliteMigration.includes('CREATE TABLE "AuthToken"'), "SQLite migration must create AuthToken");
assert.ok(pgMigration.includes('CREATE TABLE IF NOT EXISTS "AuthToken"'), "Postgres migration must create AuthToken safely");
assert.ok(pgMigration.includes('ADD COLUMN IF NOT EXISTS "emailVerifiedAt"'), "Postgres migration must preserve production data");

for (const snippet of [
  "verifyEmail",
  "requestPasswordReset",
  "resetPassword",
  "PASSWORD_RESET",
  "hashAuthToken",
  "crypto.createHash(\"sha256\")",
  "genericEmailSecurityResponse",
]) {
  assert.ok(authService.includes(snippet), `auth service missing email recovery hardening: ${snippet}`);
}

for (const route of [
  '"/verify-email"',
  '"/resend-verification"',
  '"/password/forgot"',
  '"/password/reset"',
]) {
  assert.ok(authRoutes.includes(route), `auth route missing ${route}`);
}

for (const snippet of ["optionalEmail", "forgotPasswordSchema", "resetPasswordSchema", "verifyEmailSchema"]) {
  assert.ok(authSchema.includes(snippet), `auth schema missing ${snippet}`);
}

for (const snippet of ["gmail_smtp", "GMAIL_APP_PASSWORD", "smtp.gmail.com", "sendPasswordResetEmail", "sendVerificationEmail"]) {
  assert.ok(emailService.includes(snippet), `auth email service missing ${snippet}`);
}

console.log("Auth email verification/recovery examples passed");
