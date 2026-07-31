/**
 * migration-deploy-recovery.examples.js
 *
 * Guards the self-healing Postgres deploy (scripts/deploy-postgres-migrations.js).
 *
 * `prisma migrate deploy` refuses to apply anything once the database holds a
 * failed migration record (P3009), so one interrupted deploy freezes the whole
 * backend (the container runs migrations before starting the app). The deploy
 * script recovers by resolving the failed record rolled-back and replaying the
 * migration — but replay is only safe when the migration is idempotent. A
 * migration opts in with the `@replay-safe` marker in its migration.sql.
 *
 * This test enforces the contract that keeps that safe:
 *   A. The deploy script recovers via the marker (not a stale hardcoded list).
 *   B. EVERY migration carrying the marker is genuinely idempotent. This is the
 *      guard against a future migration being marked but not made re-runnable,
 *      which would reintroduce the exact P3009 freeze this system exists to fix.
 *   C. The migrations known to have caused (or been fixed for) P3009 carry it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const MARKER = "@replay-safe";
const migrationsDir = "prisma-postgres/migrations";
const deployScript = fs.readFileSync("scripts/deploy-postgres-migrations.js", "utf8");

// ── A. Deploy script recovers via the marker ───────────────────────────────

assert.ok(deployScript.includes(MARKER), "deploy script must key auto-recovery off the @replay-safe marker");
assert.match(deployScript, /"migrate",\s*"resolve"/, "deploy script must call `prisma migrate resolve`");
assert.match(deployScript, /--rolled-back/, "deploy script must resolve failed migrations as --rolled-back before replay");
assert.match(deployScript, /P3009/, "deploy script must only auto-recover the P3009 failed-migration case");
// The old hardcoded allowlist must be gone — the marker replaces it so the list
// can never drift out of sync with the migrations.
assert.doesNotMatch(deployScript, /RECOVERABLE_MIGRATIONS/, "deploy script must not reuse the old hardcoded RECOVERABLE_MIGRATIONS allowlist");

// ── idempotency validator ──────────────────────────────────────────────────

/** Returns a list of reasons the SQL is NOT safe to replay (empty = idempotent). */
function idempotencyViolations(sql) {
  const violations = [];
  // Strip line comments so prose (and the marker itself) can't match DDL patterns.
  const code = sql.replace(/--[^\n]*/g, "");

  // Identifiers may be quoted (Prisma-generated) or bare (hand-written), so the
  // guards match both — a bare-identifier statement must not slip past unchecked.
  if (/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)["\w]/i.test(code)) {
    violations.push("ADD COLUMN without IF NOT EXISTS");
  }
  if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)["\w]/i.test(code)) {
    violations.push("CREATE TABLE without IF NOT EXISTS");
  }
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)["\w]/i.test(code)) {
    violations.push("CREATE INDEX without IF NOT EXISTS");
  }
  // Every ADD CONSTRAINT must be preceded (anywhere) by a DROP CONSTRAINT IF
  // EXISTS for the same name, so replay drops-then-adds instead of colliding.
  const addConstraint = /\bADD\s+CONSTRAINT\s+"?(\w+)"?/gi;
  let m;
  while ((m = addConstraint.exec(code)) !== null) {
    const name = m[1];
    const dropRe = new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+"?${name}"?`, "i");
    if (!dropRe.test(code)) violations.push(`ADD CONSTRAINT "${name}" without a preceding DROP CONSTRAINT IF EXISTS`);
  }
  return violations;
}

// self-check the validator: it must flag a plain ADD COLUMN and pass a guarded one
assert.deepEqual(idempotencyViolations(`ALTER TABLE "X" ADD COLUMN "y" TEXT;`), ["ADD COLUMN without IF NOT EXISTS"], "validator must flag unguarded ADD COLUMN");
assert.deepEqual(idempotencyViolations(`ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "y" TEXT;`), [], "validator must accept guarded ADD COLUMN");

// ── B. Every marked migration is idempotent ────────────────────────────────

const markedMigrations = [];
for (const entry of fs.readdirSync(migrationsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const sqlFile = path.join(migrationsDir, entry.name, "migration.sql");
  if (!fs.existsSync(sqlFile)) continue;
  const sql = fs.readFileSync(sqlFile, "utf8");
  if (!sql.includes(MARKER)) continue;
  markedMigrations.push(entry.name);
  const violations = idempotencyViolations(sql);
  assert.deepEqual(
    violations,
    [],
    `Migration ${entry.name} is marked ${MARKER} but is NOT idempotent: ${violations.join("; ")}. ` +
    `Either make every statement re-runnable or remove the marker — an auto-replayed non-idempotent migration re-freezes the deploy.`,
  );
}

// ── C. The migrations we intend to recover carry the marker ────────────────

for (const name of [
  "000052_purchase_returns",
  "000070_audit_finding_discrepancy",
  "000071_location_tax_registration_snapshots",
  "000072_transfer_eway_review_evidence",
  "000073_unified_commerce_order_lifecycle",
  "000074_per_pack_stock_groundwork",
]) {
  assert.ok(markedMigrations.includes(name), `Migration ${name} must carry the ${MARKER} marker so a failed deploy can self-heal`);
}

console.log(`migration deploy recovery examples passed (${markedMigrations.length} replay-safe migrations verified idempotent)`);
