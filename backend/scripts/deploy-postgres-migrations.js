import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const schema = "prisma-postgres/schema.prisma";
const prismaCli = "node_modules/prisma/build/index.js";
const migrationsDir = "prisma-postgres/migrations";

/**
 * Self-healing `prisma migrate deploy`.
 *
 * `prisma migrate deploy` refuses to apply anything once the target database
 * holds a failed migration record (P3009), so a single interrupted deploy — a
 * dropped connection, a statement timeout on a big backfill — leaves the service
 * unable to boot: the container's start command runs migrations before the app,
 * so it exits before ever serving. Recovering means marking the failed record
 * rolled-back and replaying the migration.
 *
 * Replaying is only safe when the migration's SQL is idempotent (IF NOT EXISTS /
 * IF EXISTS guards, DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT, re-runnable
 * backfills). A migration certifies that by including the `@replay-safe` marker
 * token in its migration.sql. The marker lives with the SQL it certifies, so a
 * migration and its replay-safety guarantee can never drift apart — unlike the
 * separate allowlist this replaced, which someone had to remember to update.
 *
 * A migration WITHOUT the marker is never auto-resolved: we fail loudly and
 * leave it for a human, because replaying a partially applied, non-idempotent
 * change fails again or double-applies. To make a new migration recoverable,
 * make its SQL idempotent and add the `@replay-safe` marker.
 */
const REPLAY_SAFE_MARKER = "@replay-safe";

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args, "--schema", schema], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function deployOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function listMigrationNames() {
  try {
    return readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isReplaySafe(migrationName) {
  try {
    const sql = readFileSync(path.join(migrationsDir, migrationName, "migration.sql"), "utf8");
    return sql.includes(REPLAY_SAFE_MARKER);
  } catch {
    return false;
  }
}

// The failed migration Prisma names in a P3009 error is whichever migration
// directory name appears in the failure text. Matching against the real folder
// list is robust to changes in Prisma's exact wording. Prefer the longest match
// so a name that is a prefix of another (e.g. 000062_x vs 000062_x_extra) can't
// be misidentified.
function findFailedMigration(failureText, migrationNames) {
  const matches = migrationNames.filter((name) => failureText.includes(name));
  matches.sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

let deploy = runPrisma(["migrate", "deploy"]);
if (deploy.status === 0) process.exit(0);

const migrationNames = listMigrationNames();
const alreadyResolved = new Set();

// Recover in a loop: a database can carry more than one failed record, and
// resolving only the first would still leave the next deploy blocked.
//
// Bound: each migration can be resolved at most once (a second attempt hits the
// alreadyResolved guard), so resolving costs at most one iteration per
// migration — plus one final iteration to detect a migration that failed AGAIN
// after replay and tell the operator so. Hence +1: without it, a database whose
// every migration is failed exits on the loop bound and prints no diagnosis.
for (let attempt = 0; attempt < migrationNames.length + 1; attempt += 1) {
  const failure = deployOutput(deploy);
  if (!failure.includes("P3009")) break;

  const blocked = findFailedMigration(failure, migrationNames);
  if (!blocked) {
    console.error("P3009 reported but no known migration name matched the failure; refusing to auto-resolve.");
    break;
  }
  if (alreadyResolved.has(blocked)) {
    console.error(`Migration ${blocked} still fails after resolve + replay; this is not a transient failure. Manual intervention required.`);
    break;
  }
  if (!isReplaySafe(blocked)) {
    console.error(`Failed migration ${blocked} is not marked ${REPLAY_SAFE_MARKER}; refusing to auto-resolve a possibly non-idempotent migration. Make its SQL idempotent and add the marker, or resolve it manually.`);
    break;
  }

  console.warn(`Recovering transactionally failed migration ${blocked}; it is marked ${REPLAY_SAFE_MARKER} (idempotent), so replay is safe.`);
  const resolved = runPrisma(["migrate", "resolve", "--rolled-back", blocked]);
  if (resolved.status !== 0) process.exit(resolved.status ?? 1);
  alreadyResolved.add(blocked);

  deploy = runPrisma(["migrate", "deploy"]);
  if (deploy.status === 0) process.exit(0);
}

process.exit(deploy.status ?? 1);
