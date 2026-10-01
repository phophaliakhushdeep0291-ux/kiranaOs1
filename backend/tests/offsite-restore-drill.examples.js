import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertBackupFresh,
  assertDownloadMatches,
  assertOffsiteRestoreTarget,
  readDrillConfig,
  runOffsiteRestoreDrill,
  selectOffsiteBackup,
} from "../scripts/offsite-restore-drill.js";

// The drill restores the copies the nightly service keeps. These pin how it
// picks one, what it refuses, and that a refusal is reported with its reason.

const hours = (n) => n * 3_600_000;
const now = Date.parse("2026-09-29T00:00:00Z");
const object = (database, stamp, extension = "dump") => ({
  key: `backups/database/${database}/kiranaos-${database}-${stamp}.${extension}`,
  sizeBytes: 100,
  lastModified: new Date(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")),
});

// ── Selection ─────────────────────────────────────────────────────────────
const newest = object("railway", "20260928T203000Z");
const older = object("railway", "20260927T203000Z");
const listing = [newest, older, { key: "backups/database/railway/notes.txt", sizeBytes: 1, lastModified: new Date(now) }];
assert.equal(selectOffsiteBackup(listing).object, newest, "the newest dump wins; non-dump files are ignored");
assert.equal(selectOffsiteBackup(listing, { key: older.key }).object, older, "an explicit key restores that copy");
assert.throws(() => selectOffsiteBackup(listing, { key: "backups/database/railway/missing.dump" }), { code: "OFFSITE_BACKUP_NOT_FOUND" });
assert.throws(() => selectOffsiteBackup([]), { code: "OFFSITE_BACKUP_NOT_FOUND" });
const twoDatabases = [object("staging_db", "20260928T210000Z"), newest];
assert.throws(() => selectOffsiteBackup(twoDatabases), { code: "OFFSITE_BACKUP_AMBIGUOUS" }, "never guess which shop database to restore");
assert.equal(selectOffsiteBackup(twoDatabases, { databaseName: "railway" }).object, newest);
assert.throws(() => selectOffsiteBackup(twoDatabases, { databaseName: "other" }), { code: "OFFSITE_BACKUP_NOT_FOUND" });

// ── Freshness ─────────────────────────────────────────────────────────────
assert.equal(assertBackupFresh(new Date(now - hours(25)), { maxAgeHours: 26, now }), 25);
assert.throws(() => assertBackupFresh(new Date(now - hours(27)), { maxAgeHours: 26, now }), { code: "OFFSITE_BACKUP_STALE" });
assert.throws(() => assertBackupFresh(null, { maxAgeHours: 26, now }), { code: "OFFSITE_BACKUP_AGE_UNKNOWN" });

// ── Download integrity ────────────────────────────────────────────────────
const sha = "b".repeat(64);
assertDownloadMatches({ recordedSha256: sha, recordedBytes: 10, downloadedSha256: sha, downloadedBytes: 10 });
assert.throws(() => assertDownloadMatches({ recordedSha256: undefined, recordedBytes: 10, downloadedSha256: sha, downloadedBytes: 10 }), { code: "OFFSITE_BACKUP_CHECKSUM_MISSING" });
assert.throws(() => assertDownloadMatches({ recordedSha256: "c".repeat(64), recordedBytes: 10, downloadedSha256: sha, downloadedBytes: 10 }), { code: "OFFSITE_BACKUP_CHECKSUM_MISMATCH" });
assert.throws(() => assertDownloadMatches({ recordedSha256: sha, recordedBytes: 11, downloadedSha256: sha, downloadedBytes: 10 }), { code: "OFFSITE_BACKUP_SIZE_MISMATCH" });

// ── Target safety ─────────────────────────────────────────────────────────
const drillUrl = "postgresql://u:p@drill.example:5432/kiranaos_restore_drill";
assert.equal(assertOffsiteRestoreTarget({ restoreUrl: drillUrl, sourceDatabase: "railway" }).database, "kiranaos_restore_drill");
// Railway's default database name, i.e. the live one, is not a scratch target.
assert.throws(() => assertOffsiteRestoreTarget({ restoreUrl: "postgresql://u:p@db.example:5432/railway" }), { code: "RESTORE_TARGET_UNSAFE" });
assert.throws(() => assertOffsiteRestoreTarget({ restoreUrl: "postgresql://u:p@db.example:5432/production_drill" }), { code: "RESTORE_TARGET_UNSAFE" });
assert.throws(() => assertOffsiteRestoreTarget({ restoreUrl: drillUrl, sourceDatabase: "kiranaos_restore_drill" }), { code: "RESTORE_TARGET_IS_SOURCE" });
assert.throws(() => assertOffsiteRestoreTarget({ restoreUrl: drillUrl, sourceUrl: "postgresql://u:p@elsewhere:5432/kiranaos_restore_drill" }), { code: "RESTORE_TARGET_IS_SOURCE" });

// ── Configuration ─────────────────────────────────────────────────────────
const configured = {
  RESTORE_TEST_DATABASE_URL: drillUrl, ALLOW_RESTORE_TEST_DB: "true",
  STORAGE_PROVIDER: "r2", STORAGE_BUCKET: "b", STORAGE_ACCESS_KEY_ID: "a", STORAGE_SECRET_ACCESS_KEY: "s",
};
assert.deepEqual(readDrillConfig(configured).missing, []);
assert.equal(readDrillConfig(configured).maxAgeHours, 26);
assert.deepEqual(readDrillConfig({ ...configured, STORAGE_PROVIDER: "local", ALLOW_RESTORE_TEST_DB: "false" }).missing, ["ALLOW_RESTORE_TEST_DB=true", "STORAGE_PROVIDER (s3, r2 or minio)"]);
assert.deepEqual(readDrillConfig({ ...configured, OFFSITE_BACKUP_MAX_AGE_HOURS: "-1" }).missing, ["OFFSITE_BACKUP_MAX_AGE_HOURS (positive hours)"]);

// A refusal is emitted as a failed report with its reason, before any storage
// or database is touched.
for (const [source, code] of [
  [{}, "OFFSITE_DRILL_NOT_CONFIGURED"],
  [{ ...configured, RESTORE_TEST_DATABASE_URL: "postgresql://u:p@db.example:5432/railway" }, "RESTORE_TARGET_UNSAFE"],
]) {
  const emitted = [];
  await assert.rejects(runOffsiteRestoreDrill({ source, emit: (value) => emitted.push(value) }), { code });
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].status, "failed");
  assert.equal(emitted[0].code, code);
  assert.ok(emitted[0].message);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(pkg.scripts["drill:restore:offsite"], "node scripts/offsite-restore-drill.js");

console.log("off-site restore drill examples passed");
