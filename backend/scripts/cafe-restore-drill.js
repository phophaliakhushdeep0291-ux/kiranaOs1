/**
 * cafe-restore-drill.js — prove the cafe gets its takings back.
 *
 *   npm run drill:restore -- --check     what is missing, touches nothing
 *   npm run drill:restore                the real thing, needs PostgreSQL
 *
 * `scripts/disaster-recovery-proof.js` already proves a dump can be restored and
 * that the result is internally consistent. This asks the question after that
 * one: does the restored copy hold the SAME money as the source, and was the
 * backup recent enough to be worth restoring at all.
 *
 * Both halves matter and neither is covered by "the restore ran without error".
 * A restore that silently drops a day of bills succeeds. A restore from a
 * three-week-old dump succeeds. The cafe finds out at the till.
 *
 * Safety: the restore target is checked by the same guard the existing proof
 * uses — the database name must look like a scratch database and must not look
 * like production, and ALLOW_RESTORE_TEST_DB must be exactly "true". The source
 * is only ever read.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { assertSafeRestoreTarget, maskPostgresUrl } from "./postgres-url-safety.js";
import {
  RECONCILE_QUERIES,
  formatVerdict,
  missingRequirements,
  recoveryPoint,
  reconcile,
} from "./restore-drill-report.js";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const objectiveHours = Number(process.env.RECOVERY_POINT_OBJECTIVE_HOURS || 24);
const backupDir = process.env.BACKUP_DIR || "./backups";

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function run(command, argv, { label, capture = false, env = {} } = {}) {
  if (label) console.log(`▶ ${label}`);
  const result = spawnSync(command, argv, {
    env: { ...process.env, ...env },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: capture ? "utf8" : undefined,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${label || command} failed: ${capture ? String(result.stderr).trim() : `exit ${result.status}`}`);
  }
  return result;
}

/** Read one scalar from a database. Read-only by construction — see RECONCILE_QUERIES. */
function scalar(url, sql) {
  const result = run("psql", [url, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { capture: true });
  return String(result.stdout).trim();
}

/**
 * Every figure the drill compares, from one side.
 *
 * A table this shop has never had is not a variance — a fresh cafe has no
 * purchase orders — so a missing relation is skipped on BOTH sides rather than
 * counted as zero on one.
 */
function measure(url) {
  const metrics = {};
  for (const [name, sql] of Object.entries(RECONCILE_QUERIES)) {
    try {
      metrics[name] = scalar(url, sql);
    } catch {
      metrics[name] = undefined;
    }
  }
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== undefined));
}

function latestBackup(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => /\.(dump|sql)$/i.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      return { file: full, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] ?? null;
}

/* ------------------------------------------------------------------ check */

const missing = missingRequirements(process.env);

if (checkOnly || missing.length > 0) {
  const ready = missing.length === 0;
  emit({
    type: "cafe_restore_drill_check",
    status: ready ? "ready" : "not-configured",
    objectiveHours,
    backupDir,
    missing: missing.map(({ key, why, reason }) => ({ key, reason, why })),
    nextStep: ready
      ? "Run `npm run drill:restore` against the live database."
      : "Set the variables above, then re-run with --check before running the drill for real.",
  });
  // A missing configuration is not a failing drill; it is a drill that has not
  // been run. Only --require makes it an error, for a scheduler that must not
  // silently do nothing every night.
  process.exit(!ready && args.has("--require") ? 1 : 0);
}

/* ------------------------------------------------------------------- run */

try {
  const sourceUrl = process.env.DATABASE_URL;
  const restoreUrl = process.env.RESTORE_TEST_DATABASE_URL;
  const { source, restore } = assertSafeRestoreTarget({
    sourceUrl,
    restoreUrl,
    allowFlag: String(process.env.ALLOW_RESTORE_TEST_DB).toLowerCase() === "true",
  });

  for (const command of ["pg_dump", "pg_restore", "psql"]) {
    if (spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status !== 0) {
      throw new Error(`${command} was not found. Install the PostgreSQL client tools.`);
    }
  }

  emit({
    type: "cafe_restore_drill_plan",
    source: { host: source.host, database: source.database, url: maskPostgresUrl(sourceUrl) },
    restore: { host: restore.host, database: restore.database, url: maskPostgresUrl(restoreUrl) },
    objectiveHours,
    startedAt: new Date().toISOString(),
  });

  // Measured BEFORE the backup, so a drill can never quietly compare a backup
  // against itself.
  const sourceMetrics = measure(sourceUrl);

  run("node", ["scripts/postgres-backup-create.js"], {
    label: "Take a fresh logical backup",
    env: { BACKUP_FORMAT: "custom", BACKUP_DIR: backupDir },
  });

  const backup = latestBackup(backupDir);
  if (!backup) throw new Error(`No backup file appeared in ${backupDir}`);
  if (fs.statSync(backup.file).size <= 0) throw new Error("Backup file is empty");

  run("psql", [restoreUrl, "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"], {
    label: `Reset the scratch database ${restore.database}`,
  });
  run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", restoreUrl, backup.file], {
    label: "Restore the backup into the scratch database",
  });

  const restoredMetrics = measure(restoreUrl);
  const reconciliation = reconcile(sourceMetrics, restoredMetrics);
  const rpo = recoveryPoint({ backupTakenAt: backup.mtimeMs, objectiveHours });

  console.log(`\n${formatVerdict({ reconciliation, rpo, backupFile: backup.file })}\n`);

  const passed = reconciliation.matched && rpo.withinObjective;
  emit({
    type: "cafe_restore_drill",
    status: passed ? "passed" : "failed",
    backupFile: backup.file,
    recoveryPoint: rpo,
    reconciliation,
    sourceMetrics,
    restoredMetrics,
    finishedAt: new Date().toISOString(),
  });
  process.exit(passed ? 0 : 1);
} catch (error) {
  emit({ type: "cafe_restore_drill", status: "failed", message: error.message, finishedAt: new Date().toISOString() });
  process.exit(1);
}
