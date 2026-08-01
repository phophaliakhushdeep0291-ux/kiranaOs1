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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REPLAY_SAFE_MARKER,
  REPLAY_UNSAFE_MARKER,
  REPLAY_SAFETY_BASELINE_PREFIX,
  idempotencyViolations,
  replaySafetyViolations,
} from "../scripts/replay-safety.js";

const MARKER = REPLAY_SAFE_MARKER;
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
// The validator and the full replay-safety policy live in scripts/replay-safety.js
// so this test and the `migration:safety` release gate can never disagree about
// what "replay-safe" means. The self-checks below pin its behaviour.

// Self-check the validator. A validator that silently matches nothing would let
// every migration "pass", so assert it both flags and clears known-shape SQL —
// with quoted and bare identifiers, and for each statement kind it guards.
assert.deepEqual(idempotencyViolations(`ALTER TABLE "X" ADD COLUMN "y" TEXT;`), ["ADD COLUMN without IF NOT EXISTS"], "validator must flag unguarded ADD COLUMN");
assert.deepEqual(idempotencyViolations(`ALTER TABLE X ADD COLUMN y TEXT;`), ["ADD COLUMN without IF NOT EXISTS"], "validator must flag unguarded ADD COLUMN with bare identifiers");
assert.deepEqual(idempotencyViolations(`ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "y" TEXT;`), [], "validator must accept guarded ADD COLUMN");
assert.deepEqual(idempotencyViolations(`CREATE TABLE "X" ("id" TEXT);`), ["CREATE TABLE without IF NOT EXISTS"], "validator must flag unguarded CREATE TABLE");
assert.deepEqual(idempotencyViolations(`CREATE TABLE IF NOT EXISTS "X" ("id" TEXT);`), [], "validator must accept guarded CREATE TABLE");
assert.deepEqual(idempotencyViolations(`CREATE UNIQUE INDEX "i" ON "X"("id");`), ["CREATE INDEX without IF NOT EXISTS"], "validator must flag unguarded CREATE UNIQUE INDEX");
assert.deepEqual(idempotencyViolations(`CREATE UNIQUE INDEX IF NOT EXISTS "i" ON "X"("id");`), [], "validator must accept guarded CREATE UNIQUE INDEX");
assert.deepEqual(
  idempotencyViolations(`ALTER TABLE "X" ADD CONSTRAINT "fk_a" FOREIGN KEY ("b") REFERENCES "Y"("id");`),
  [`ADD CONSTRAINT "fk_a" without a preceding DROP CONSTRAINT IF EXISTS`],
  "validator must flag ADD CONSTRAINT with no DROP CONSTRAINT IF EXISTS",
);
assert.deepEqual(
  idempotencyViolations(`ALTER TABLE "X" DROP CONSTRAINT IF EXISTS "fk_a";\nALTER TABLE "X" ADD CONSTRAINT "fk_a" FOREIGN KEY ("b") REFERENCES "Y"("id");`),
  [],
  "validator must accept drop-then-add constraint",
);
// The marker itself lives in a comment; comment text must never satisfy a guard.
assert.deepEqual(
  idempotencyViolations(`-- ${MARKER}: replay drops then adds CONSTRAINT "fk_a"\nALTER TABLE "X" ADD COLUMN "y" TEXT;`),
  ["ADD COLUMN without IF NOT EXISTS"],
  "validator must ignore comment prose when judging idempotency",
);

// The two shapes that froze the deploy in 000076: a CREATE TRIGGER with no DROP,
// and a bare INSERT ... SELECT. Postgres has no CREATE TRIGGER IF NOT EXISTS, so
// drop-then-create is the idempotent form; an unguarded INSERT re-inserts on
// replay. The validator was blind to both before this change.
assert.deepEqual(
  idempotencyViolations(`CREATE TRIGGER sync_x AFTER INSERT ON "X" FOR EACH ROW EXECUTE FUNCTION f('x');`),
  [`CREATE TRIGGER "sync_x" without a preceding DROP TRIGGER IF EXISTS`],
  "validator must flag CREATE TRIGGER with no DROP TRIGGER IF EXISTS",
);
assert.deepEqual(
  idempotencyViolations(`DROP TRIGGER IF EXISTS sync_x ON "X";\nCREATE TRIGGER sync_x AFTER INSERT ON "X" FOR EACH ROW EXECUTE FUNCTION f('x');`),
  [],
  "validator must accept drop-then-create trigger",
);
assert.deepEqual(
  idempotencyViolations(`INSERT INTO "ChangeLog" ("id") SELECT "id" FROM "Expense";`),
  ["INSERT without ON CONFLICT or WHERE NOT EXISTS guard (re-inserts rows on replay)"],
  "validator must flag an unguarded INSERT",
);
assert.deepEqual(idempotencyViolations(`INSERT INTO "C" ("id") VALUES ('a') ON CONFLICT DO NOTHING;`), [], "validator must accept INSERT ... ON CONFLICT");
assert.deepEqual(
  idempotencyViolations(`INSERT INTO "C" ("id") SELECT "id" FROM "E" WHERE NOT EXISTS (SELECT 1 FROM "C" c WHERE c."id" = "E"."id");`),
  [],
  "validator must accept INSERT guarded by WHERE NOT EXISTS",
);

// ── The forward policy: new migrations must certify themselves replay-safe ──
// replaySafetyViolations() is exactly what the `migration:safety` release gate
// runs per migration; it is the rule that would have caught unmarked 000075/076.
// Pin its behaviour on both sides of the grandfather baseline so the gate cannot
// silently soften.
const NEW_PREFIX = String(REPLAY_SAFETY_BASELINE_PREFIX + 1).padStart(6, "0");
const BASELINE = String(REPLAY_SAFETY_BASELINE_PREFIX).padStart(6, "0");
assert.deepEqual(
  replaySafetyViolations(`${BASELINE}_grandfathered`, `ALTER TABLE "X" ADD COLUMN "y" TEXT;`),
  [],
  "a migration at or below the baseline is grandfathered even when not idempotent",
);
assert.equal(
  replaySafetyViolations(`${NEW_PREFIX}_unmarked`, `ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "y" TEXT;`).length,
  1,
  "a new migration with no marker must be rejected even when its SQL is idempotent",
);
assert.deepEqual(
  replaySafetyViolations(`${NEW_PREFIX}_good`, `-- ${MARKER}\nALTER TABLE "X" ADD COLUMN IF NOT EXISTS "y" TEXT;`),
  [],
  "a new marked, idempotent migration passes",
);
assert.equal(
  replaySafetyViolations(`${NEW_PREFIX}_lying`, `-- ${MARKER}\nALTER TABLE "X" ADD COLUMN "y" TEXT;`).length,
  1,
  "a migration that claims the marker but is not idempotent must be rejected",
);

// The escape hatch: a genuinely non-idempotent migration may opt out with a
// documented reason — but not silently, and not while also claiming replay-safe.
assert.deepEqual(
  replaySafetyViolations(
    `${NEW_PREFIX}_oneway`,
    `-- ${REPLAY_UNSAFE_MARKER}: one-way backfill, manual recovery in runbook\nINSERT INTO "C" ("id") SELECT "id" FROM "E";`,
  ),
  [],
  "a new migration may opt out with @replay-unsafe + a reason, even with non-idempotent SQL",
);
assert.equal(
  replaySafetyViolations(`${NEW_PREFIX}_noreason`, `-- ${REPLAY_UNSAFE_MARKER}\nINSERT INTO "C" ("id") SELECT "id" FROM "E";`).length,
  1,
  "@replay-unsafe without a reason must be rejected",
);
assert.equal(
  replaySafetyViolations(
    `${NEW_PREFIX}_both`,
    `-- ${MARKER}\n-- ${REPLAY_UNSAFE_MARKER}: contradictory\nALTER TABLE "X" ADD COLUMN IF NOT EXISTS "y" TEXT;`,
  ).length,
  1,
  "declaring both @replay-safe and @replay-unsafe must be rejected",
);

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

// ── D. The recovery loop actually recovers (end-to-end) ────────────────────
//
// Sections A-C check the contract's shape; this section runs the real deploy
// script. Self-healing that has never executed is exactly the thing that fails
// when production finally needs it. The script resolves every path against cwd
// (prisma-postgres/…, node_modules/prisma/build/index.js), so we can run it
// unmodified in a sandbox whose "prisma" is a stub we control.

const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-recovery-"));

/** Fake `prisma` CLI: fails deploy while `failed` is non-empty, records calls. */
const FAKE_PRISMA = `
import fs from "node:fs";
import path from "node:path";
const statePath = path.join(process.cwd(), "state.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
state.calls = [...(state.calls ?? []), args.join(" ")];
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));

if (args[0] === "migrate" && args[1] === "deploy") {
  const failed = state.failed ?? [];
  if (failed.length > 0) {
    save();
    process.stderr.write("Error: P3009\\nmigrate found failed migrations in the target database\\n" +
      "The \`" + failed[0] + "\` migration started at 2026-07-31 failed\\n");
    process.exit(1);
  }
  save();
  process.stdout.write("All migrations have been successfully applied.\\n");
  process.exit(0);
}
if (args[0] === "migrate" && args[1] === "resolve") {
  const name = args[args.indexOf("--rolled-back") + 1];
  state.resolved = [...(state.resolved ?? []), name];
  // "sticky" simulates a migration that fails again on replay (a genuinely
  // broken migration, not a transient interruption).
  if (!state.sticky) state.failed = (state.failed ?? []).filter((n) => n !== name);
  save();
  process.exit(0);
}
save();
process.exit(0);
`;

/** Builds a sandbox with the given migrations and returns {run, readState}. */
function makeSandbox(label, migrations, initialState) {
  const dir = path.join(sandboxRoot, label);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules", "prisma", "build"), { recursive: true });
  fs.mkdirSync(path.join(dir, "prisma-postgres"), { recursive: true });
  // ESM, so the copied deploy script (which uses `import`) runs as-is.
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(dir, "node_modules", "prisma", "build", "index.js"), FAKE_PRISMA);
  fs.writeFileSync(path.join(dir, "prisma-postgres", "schema.prisma"), "");
  fs.writeFileSync(path.join(dir, "scripts", "deploy-postgres-migrations.js"), deployScript);
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(initialState));
  for (const [name, sql] of Object.entries(migrations)) {
    fs.mkdirSync(path.join(dir, "prisma-postgres", "migrations", name), { recursive: true });
    fs.writeFileSync(path.join(dir, "prisma-postgres", "migrations", name, "migration.sql"), sql);
  }
  return {
    run: () => spawnSync(process.execPath, ["scripts/deploy-postgres-migrations.js"], { cwd: dir, encoding: "utf8" }),
    readState: () => JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")),
  };
}

const SAFE_SQL = `-- ${MARKER}\nALTER TABLE "X" ADD COLUMN IF NOT EXISTS "y" TEXT;\n`;
const UNSAFE_SQL = `ALTER TABLE "X" ADD COLUMN "y" TEXT;\n`;

// D1. A clean deploy must not touch the recovery path at all.
{
  const box = makeSandbox("clean", { "000001_a": SAFE_SQL }, { failed: [] });
  const result = box.run();
  assert.equal(result.status, 0, "clean deploy must succeed");
  assert.deepEqual(box.readState().resolved ?? [], [], "clean deploy must never call migrate resolve");
}

// D2. The freeze this system exists to fix: a marked migration left failed by an
// interrupted deploy must be resolved and replayed, and the deploy must succeed.
{
  const box = makeSandbox("recovers", { "000001_a": SAFE_SQL }, { failed: ["000001_a"] });
  const result = box.run();
  assert.equal(result.status, 0, `P3009 on a ${MARKER} migration must self-heal; got exit ${result.status}\n${result.stderr}`);
  assert.deepEqual(box.readState().resolved, ["000001_a"], "must resolve exactly the failed migration");
}

// D3. An unmarked migration must NOT be auto-resolved — replaying a partially
// applied non-idempotent migration is how you corrupt a database.
{
  const box = makeSandbox("refuses", { "000001_a": UNSAFE_SQL }, { failed: ["000001_a"] });
  const result = box.run();
  assert.notEqual(result.status, 0, "unmarked failed migration must fail the deploy, not auto-resolve");
  assert.deepEqual(box.readState().resolved ?? [], [], "unmarked migration must never be resolved");
  assert.match(result.stderr, /not marked/, "must explain why it refused");
}

// D4. Multiple failed records: resolving only the first would leave the next
// deploy still frozen, so the loop must drain them all.
{
  const box = makeSandbox("multiple", { "000001_a": SAFE_SQL, "000002_b": SAFE_SQL }, { failed: ["000001_a", "000002_b"] });
  const result = box.run();
  assert.equal(result.status, 0, "must recover from more than one failed migration");
  assert.deepEqual(box.readState().resolved, ["000001_a", "000002_b"], "must resolve every failed migration");
}

// D5. A genuinely broken migration (fails again on replay) must stop after one
// attempt rather than resolve/replay forever.
{
  const box = makeSandbox("sticky", { "000001_a": SAFE_SQL }, { failed: ["000001_a"], sticky: true });
  const result = box.run();
  assert.notEqual(result.status, 0, "a migration that fails on replay must not report success");
  assert.deepEqual(box.readState().resolved, ["000001_a"], "must attempt recovery exactly once, not loop");
  assert.match(result.stderr, /not a transient failure/, "must tell the operator manual intervention is needed");
}

// D6. Longest-match: a migration whose name is a prefix of another must not be
// misidentified as the failing one.
{
  const box = makeSandbox("prefix", { "000001_a": SAFE_SQL, "000001_a_extra": SAFE_SQL }, { failed: ["000001_a_extra"] });
  const result = box.run();
  assert.equal(result.status, 0, "must recover when one migration name is a prefix of another");
  assert.deepEqual(box.readState().resolved, ["000001_a_extra"], "must resolve the longer, actually-failing migration");
}

fs.rmSync(sandboxRoot, { recursive: true, force: true });

console.log(`migration deploy recovery examples passed (${markedMigrations.length} replay-safe migrations verified idempotent; recovery loop verified end-to-end)`);
