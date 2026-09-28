import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSafeRestoreDatabaseName, maskPostgresUrl, parsePostgresUrl, postgresCliUrl } from "./postgres-url-safety.js";
import { assessRestoredWorkload, openPostgresSnapshot } from "./restore-fidelity.js";

// Restores a dump the nightly backup service actually stored off-site. The
// other drills take a fresh dump, which proves the database can be backed up
// now; only this one proves the copies being kept can be brought back.

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUP_ROOT = "backups/database";
// One nightly cycle plus slack for a slow run. Older than this, the schedule
// has missed a night and the newest copy is not the recovery point anyone expects.
const DEFAULT_MAX_AGE_HOURS = 26;

// The newest record the shops wrote, across every table that stamps rows. It
// says how much trade a restore of this copy would bring back.
const NEWEST_RECORD_SQL = `SELECT COALESCE(max((xpath('/row/m/text()', query_to_xml(format('SELECT max(%I)::text AS m FROM public.%I', column_name, table_name), false, true, '')))[1]::text::timestamptz)::text, '')
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name IN ('createdAt', 'updatedAt') AND data_type LIKE 'timestamp%';`;

function drillError(message, code, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

export function readDrillConfig(source = process.env) {
  const missing = [];
  if (!source.RESTORE_TEST_DATABASE_URL) missing.push("RESTORE_TEST_DATABASE_URL");
  if (String(source.ALLOW_RESTORE_TEST_DB || "").toLowerCase() !== "true") missing.push("ALLOW_RESTORE_TEST_DB=true");
  if (!["s3", "r2", "minio"].includes(source.STORAGE_PROVIDER)) missing.push("STORAGE_PROVIDER (s3, r2 or minio)");
  for (const key of ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) {
    if (!source[key]) missing.push(key);
  }
  const maxAgeHours = Number(source.OFFSITE_BACKUP_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) missing.push("OFFSITE_BACKUP_MAX_AGE_HOURS (positive hours)");
  return {
    missing,
    restoreUrl: source.RESTORE_TEST_DATABASE_URL,
    sourceUrl: source.DATABASE_URL,
    databaseName: source.BACKUP_SOURCE_DATABASE || null,
    key: source.BACKUP_KEY || null,
    maxAgeHours,
  };
}

/**
 * The target is dropped and recreated, so it has to look like a scratch
 * database, and must not share a name with the database the dump came from.
 */
export function assertOffsiteRestoreTarget({ restoreUrl, sourceUrl, sourceDatabase }) {
  const restore = parsePostgresUrl(restoreUrl, "RESTORE_TEST_DATABASE_URL");
  if (!isSafeRestoreDatabaseName(restore.database)) {
    throw drillError("Restore target database name must contain test, _ci, restore, drill, or staging and must not look production-like", "RESTORE_TARGET_UNSAFE");
  }
  const forbidden = new Set([sourceDatabase].filter(Boolean));
  if (sourceUrl) forbidden.add(parsePostgresUrl(sourceUrl, "DATABASE_URL").database);
  if (forbidden.has(restore.database)) {
    throw drillError("RESTORE_TEST_DATABASE_URL must not name the database the backup was taken from", "RESTORE_TARGET_IS_SOURCE");
  }
  return restore;
}

/** Picks the dump to restore from a newest-first listing of the backup root. */
export function selectOffsiteBackup(objects, { databaseName = null, key = null } = {}) {
  const dumps = objects.filter((object) => /\.(dump|sql)$/.test(object.key));
  if (key) {
    const match = dumps.find((object) => object.key === key);
    if (!match) throw drillError(`No stored backup has the key ${key}`, "OFFSITE_BACKUP_NOT_FOUND");
    return { object: match, databaseName: match.key.split("/")[2] };
  }
  const databases = [...new Set(dumps.map((object) => object.key.split("/")[2]))].sort();
  if (!databases.length) throw drillError(`No backups under ${BACKUP_ROOT}/ in the bucket`, "OFFSITE_BACKUP_NOT_FOUND");
  const chosen = databaseName || (databases.length === 1 ? databases[0] : null);
  if (!chosen) {
    throw drillError(`Backups exist for several databases (${databases.join(", ")}); set BACKUP_SOURCE_DATABASE`, "OFFSITE_BACKUP_AMBIGUOUS", { databases });
  }
  const newest = dumps.find((object) => object.key.split("/")[2] === chosen);
  if (!newest) throw drillError(`No backups for database ${chosen}`, "OFFSITE_BACKUP_NOT_FOUND", { databases });
  return { object: newest, databaseName: chosen };
}

export function assertBackupFresh(lastModified, { maxAgeHours, now = Date.now() }) {
  if (!(lastModified instanceof Date) || Number.isNaN(lastModified.getTime())) {
    throw drillError("The bucket did not report when this backup was stored", "OFFSITE_BACKUP_AGE_UNKNOWN");
  }
  const ageHours = (now - lastModified.getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) {
    throw drillError(
      `The selected backup is ${ageHours.toFixed(2)} hours old, over the ${maxAgeHours}-hour limit; if it is the newest copy, the nightly backup has missed at least one run`,
      "OFFSITE_BACKUP_STALE",
      { ageHours: Number(ageHours.toFixed(2)), maxAgeHours },
    );
  }
  return Number(ageHours.toFixed(2));
}

export function assertDownloadMatches({ recordedSha256, recordedBytes, downloadedSha256, downloadedBytes }) {
  if (!/^[a-f0-9]{64}$/.test(recordedSha256 || "")) {
    throw drillError("The stored backup carries no recorded SHA-256, so the download cannot be checked", "OFFSITE_BACKUP_CHECKSUM_MISSING");
  }
  if (recordedBytes != null && Number(recordedBytes) !== downloadedBytes) {
    throw drillError(`Downloaded ${downloadedBytes} bytes, the bucket reports ${recordedBytes}`, "OFFSITE_BACKUP_SIZE_MISMATCH");
  }
  if (recordedSha256 !== downloadedSha256) {
    throw drillError("The downloaded backup does not match the SHA-256 recorded when it was uploaded", "OFFSITE_BACKUP_CHECKSUM_MISMATCH");
  }
}

function runTool(command, args, { env = process.env, secret } = {}) {
  const executable = process.env.PG_BIN_DIR && ["psql", "pg_restore"].includes(command)
    ? path.join(process.env.PG_BIN_DIR, process.platform === "win32" ? `${command}.exe` : command)
    : command;
  const result = spawnSync(executable, args, { cwd: backendRoot, env, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = String(result.stderr || result.stdout || "").trim().slice(-2000);
    throw drillError(`${command} failed${stderr ? `: ${secret ? stderr.split(secret).join(maskPostgresUrl(secret)) : stderr}` : ""}`, "OFFSITE_RESTORE_TOOL_FAILED");
  }
  return String(result.stdout || "");
}

async function download(getObjectStream, key, filePath) {
  const { stream } = await getObjectStream({ key });
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  const out = fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 });
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.length;
      if (!out.write(buffer)) await new Promise((resolve) => out.once("drain", resolve));
    }
  } finally {
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function runOffsiteRestoreDrill({ source = process.env, now = () => Date.now(), emit = (value) => console.log(JSON.stringify(value)) } = {}) {
  const stages = [];
  const stage = (id, detail = {}) => stages.push({ id, status: "passed", ...detail });
  let workDir = null;
  let snapshot = null;
  try {
    // Refusals are failures like any other: they reach the report with a reason,
    // not an exit code on its own.
    const config = readDrillConfig(source);
    if (config.missing.length) {
      throw drillError(`Off-site restore drill is not configured: ${config.missing.join(", ")}`, "OFFSITE_DRILL_NOT_CONFIGURED", { missing: config.missing });
    }
    const restoreTarget = assertOffsiteRestoreTarget({ restoreUrl: config.restoreUrl, sourceUrl: config.sourceUrl, sourceDatabase: config.databaseName });

    // The storage layer validates the whole backend configuration on import. This
    // drill signs nothing and never connects to production, so it lends that check
    // the scratch database and a throwaway secret rather than asking the operator
    // to carry production secrets onto their machine.
    process.env.DATABASE_URL ||= config.restoreUrl;
    process.env.JWT_SECRET ||= crypto.randomBytes(32).toString("hex");
    const { listObjects, getObjectMetadata, getObjectStream } = await import("../src/lib/objectStorage.js");
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kiranaos-offsite-drill-"));

    const listing = await listObjects({ prefix: BACKUP_ROOT });
    const { object, databaseName } = selectOffsiteBackup(listing, { databaseName: config.databaseName, key: config.key });
    assertOffsiteRestoreTarget({ restoreUrl: config.restoreUrl, sourceUrl: config.sourceUrl, sourceDatabase: databaseName });
    const head = await getObjectMetadata({ key: object.key });
    const storedAt = head.lastModified || object.lastModified;
    const ageHours = assertBackupFresh(storedAt, { maxAgeHours: config.maxAgeHours, now: now() });
    stage("select-backup", { key: object.key, storedAt: storedAt.toISOString(), ageHours, retainedCopies: listing.filter((item) => item.key.split("/")[2] === databaseName).length });

    const localFile = path.join(workDir, path.basename(object.key));
    const downloaded = await download(getObjectStream, object.key, localFile);
    assertDownloadMatches({
      recordedSha256: head.metadata?.sha256,
      recordedBytes: head.sizeBytes ?? object.sizeBytes,
      downloadedSha256: downloaded.sha256,
      downloadedBytes: downloaded.bytes,
    });
    stage("verify-download", { bytes: downloaded.bytes, sha256: downloaded.sha256 });

    const restoreCli = postgresCliUrl(config.restoreUrl);
    runTool("psql", [restoreCli, "-X", "--no-password", "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"], { secret: restoreCli });
    stage("reset-restore-schema", { database: restoreTarget.database });
    if (localFile.endsWith(".sql")) {
      runTool("psql", [restoreCli, "-X", "--no-password", "-v", "ON_ERROR_STOP=1", "-f", localFile], { secret: restoreCli });
    } else {
      runTool("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", restoreCli, localFile], { secret: restoreCli });
    }
    stage("restore-backup");

    snapshot = await openPostgresSnapshot(restoreCli);
    const manifest = snapshot.manifest;
    await snapshot.close();
    snapshot = null;
    const workload = assessRestoredWorkload(manifest);
    const rowsByTable = Object.fromEntries(Object.entries(manifest.tables).map(([table, entry]) => [table, entry.rows]));
    stage("restored-workload", { ...workload, rowsByTable });

    const newestRecordAt = runTool("psql", [restoreCli, "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", NEWEST_RECORD_SQL], { secret: restoreCli }).trim() || null;
    const newestRecordLagHours = newestRecordAt ? Number(((storedAt.getTime() - new Date(newestRecordAt).getTime()) / 3_600_000).toFixed(2)) : null;
    stage("recovery-point", { newestRecordAt, newestRecordLagHours });

    runTool(process.execPath, ["scripts/money-paise-reconciliation.js", "--native"], {
      env: { ...process.env, DATABASE_URL: config.restoreUrl, TEST_DATABASE_URL: config.restoreUrl, DIRECT_DATABASE_URL: config.restoreUrl, ALLOW_MONEY_PAISE_BACKFILL: "false" },
      secret: config.restoreUrl,
    });
    stage("money-paise-reconciliation");

    const report = {
      type: "offsite_restore_drill",
      status: "passed",
      finishedAt: new Date(now()).toISOString(),
      backup: { database: databaseName, key: object.key, storedAt: storedAt.toISOString(), ageHours, bytes: downloaded.bytes, sha256: downloaded.sha256 },
      restoreTarget: maskPostgresUrl(config.restoreUrl),
      recoveryPoint: { newestRecordAt, newestRecordLagHours, maxBackupAgeHours: config.maxAgeHours },
      workload,
      stages,
    };
    emit(report);
    return report;
  } catch (error) {
    emit({ type: "offsite_restore_drill", status: "failed", code: error.code || null, message: error.message, details: error.details || null, stages });
    throw error;
  } finally {
    if (snapshot) await snapshot.close().catch(() => {});
    // The dump is production data on the operator's disk; it never outlives the drill.
    if (workDir) await fsp.rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportDir = path.join(backendRoot, "release-artifacts");
  try {
    const report = await runOffsiteRestoreDrill({
      emit: (value) => {
        console.log(JSON.stringify(value, null, 2));
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(path.join(reportDir, "offsite-restore-drill-latest.json"), `${JSON.stringify(value, null, 2)}\n`);
      },
    });
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch {
    process.exitCode = 1;
  }
}
