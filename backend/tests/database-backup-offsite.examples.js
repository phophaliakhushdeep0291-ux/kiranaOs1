import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listObjects } from "../src/lib/objectStorage.js";
import {
  assertDatabaseBackupStorageSafe,
  databaseBackupKey,
  databaseBackupPrefix,
  pruneDatabaseBackups,
  uploadDatabaseBackup,
} from "../src/modules/backups/database-backup.service.js";
import { handleBackupJob } from "../src/workers/backup.worker.js";
import { JOB_NAMES } from "../src/workers/queueNames.js";
import { __schedulerInternals } from "../src/workers/schedulers.js";

// These exercise the real local storage adapter, so everything lands under
// ./storage and is removed again at the end.
const DATABASE_NAME = "kiranaos_offsite_examples";
const storageRoot = path.resolve(process.cwd(), "storage", databaseBackupPrefix(DATABASE_NAME));
const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "kiranaos-backup-"));

async function cleanup() {
  await fsp.rm(storageRoot, { recursive: true, force: true });
  await fsp.rm(workDir, { recursive: true, force: true });
}

async function writeDump(name, bytes) {
  const filePath = path.join(workDir, name);
  await fsp.writeFile(filePath, bytes);
  return filePath;
}

try {
  // ── Keys ──────────────────────────────────────────────────────────────────
  assert.equal(
    databaseBackupKey(DATABASE_NAME, "kiranaos-shop-20260822T031500Z.dump"),
    `backups/database/${DATABASE_NAME}/kiranaos-shop-20260822T031500Z.dump`,
  );
  // A key is built from a file name the script chose, but the guard is what
  // stops a crafted BACKUP_DIR entry from writing outside the prefix.
  assert.throws(() => databaseBackupKey(DATABASE_NAME, "has space.dump"), /Unsafe backup file name/);
  assert.throws(() => databaseBackupKey(DATABASE_NAME, ""), /Unsafe backup file name/);
  assert.throws(() => databaseBackupKey("", "x.dump"), /database name is required/);
  // A traversal attempt reduces to its basename rather than escaping the prefix.
  assert.equal(
    databaseBackupKey(DATABASE_NAME, "../../etc/passwd.dump"),
    `backups/database/${DATABASE_NAME}/passwd.dump`,
  );

  // ── Upload is verified by read-back, not by "the put did not throw" ───────
  const body = crypto.randomBytes(4096);
  const expectedSha = crypto.createHash("sha256").update(body).digest("hex");
  const dumpPath = await writeDump("kiranaos-first-20260822T030000Z.dump", body);
  const uploaded = await uploadDatabaseBackup({ filePath: dumpPath, databaseName: DATABASE_NAME });
  assert.equal(uploaded.verified, true);
  assert.equal(uploaded.sizeBytes, body.length);
  assert.equal(uploaded.sha256, expectedSha);
  assert.ok(fs.existsSync(path.join(storageRoot, "kiranaos-first-20260822T030000Z.dump")));
  const storedBytes = await fsp.readFile(path.join(storageRoot, "kiranaos-first-20260822T030000Z.dump"));
  assert.equal(crypto.createHash("sha256").update(storedBytes).digest("hex"), expectedSha, "stored bytes must match the dump");

  // An empty dump is the failure mode pg_dump produces when it half-worked, and
  // it is exactly the copy nobody notices until a restore.
  const emptyPath = await writeDump("kiranaos-empty-20260822T030001Z.dump", Buffer.alloc(0));
  await assert.rejects(
    uploadDatabaseBackup({ filePath: emptyPath, databaseName: DATABASE_NAME }),
    (error) => error.code === "DATABASE_BACKUP_EMPTY",
  );

  // ── Retention ─────────────────────────────────────────────────────────────
  const now = new Date("2026-08-22T04:00:00.000Z");
  const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // Six copies: three recent, three well past a 30-day window.
  const ages = [1, 2, 3, 40, 60, 90];
  for (const [index, age] of ages.entries()) {
    if (index === 0) continue; // the upload above stands in for the newest copy
    const file = await writeDump(`kiranaos-age${age}-2026082${index}T030000Z.dump`, crypto.randomBytes(512));
    const stored = await uploadDatabaseBackup({ filePath: file, databaseName: DATABASE_NAME });
    const storedPath = path.join(process.cwd(), "storage", stored.key);
    await fsp.utimes(storedPath, daysAgo(age), daysAgo(age));
  }
  // The newest copy is the one written first; age it to match its slot.
  await fsp.utimes(path.join(storageRoot, "kiranaos-first-20260822T030000Z.dump"), daysAgo(1), daysAgo(1));

  assert.equal((await listObjects({ prefix: databaseBackupPrefix(DATABASE_NAME) })).length, 6);

  const pruned = await pruneDatabaseBackups({
    databaseName: DATABASE_NAME,
    retentionDays: 30,
    minRetained: 3,
    now,
  });
  assert.equal(pruned.examined, 6);
  assert.equal(pruned.deleted.length, 3, "the three copies past the window go");
  assert.equal(pruned.retained, 3);
  const survivors = await listObjects({ prefix: databaseBackupPrefix(DATABASE_NAME) });
  assert.deepEqual(
    survivors.map((object) => object.key.split("/").pop()).sort(),
    ["kiranaos-age2-20260821T030000Z.dump", "kiranaos-age3-20260822T030000Z.dump", "kiranaos-first-20260822T030000Z.dump"].sort(),
  );

  // The floor is the point: with everything past the cutoff, retention must
  // still leave the newest copies alone rather than emptying the bucket.
  const everythingIsOld = await pruneDatabaseBackups({
    databaseName: DATABASE_NAME,
    retentionDays: 0,
    minRetained: 2,
    now: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
  });
  assert.equal(everythingIsOld.retained, 2, "retention must never prune below the floor");
  assert.equal((await listObjects({ prefix: databaseBackupPrefix(DATABASE_NAME) })).length, 2);

  // An unused prefix is an empty listing, not a storage error.
  assert.deepEqual(await listObjects({ prefix: databaseBackupPrefix("never_used_database") }), []);

  // ── Production storage guard ──────────────────────────────────────────────
  // Uploading to "local" in production means writing back onto the same
  // ephemeral container disk, which is the failure this path exists to end.
  assert.throws(
    () => assertDatabaseBackupStorageSafe("production", "local"),
    (error) => error.code === "DATABASE_BACKUP_STORAGE_NOT_PRODUCTION_SAFE",
  );
  for (const provider of ["s3", "r2", "minio"]) {
    assert.doesNotThrow(() => assertDatabaseBackupStorageSafe("production", provider));
  }
  // Local storage stays fine everywhere else, which is what these examples use.
  assert.doesNotThrow(() => assertDatabaseBackupStorageSafe("development", "local"));
  assert.doesNotThrow(() => assertDatabaseBackupStorageSafe("test", "local"));

  // ── Producer/consumer contract ────────────────────────────────────────────
  // The bug this closes was a job name with a handler and no producer. The
  // schedule now exists; assert the pair still agrees on the name and guard.
  assert.equal(__schedulerInternals.DATABASE_BACKUP_SCHEDULER, "database-backup-offsite-v1");
  await assert.rejects(
    handleBackupJob({ name: JOB_NAMES.RUN_DATABASE_BACKUP, data: {} }),
    (error) => error.code === "DATABASE_BACKUP_CONFIRMATION_REQUIRED",
    "an unconfirmed database backup must not spawn pg_dump",
  );
  await assert.rejects(
    handleBackupJob({ name: "NOT_A_BACKUP_JOB", data: {} }),
    (error) => error.code === "UNKNOWN_BACKUP_JOB",
  );

  console.log("Database off-site backup examples passed (upload verified by read-back, retention floor held, 3 of 6 copies aged out)");
} finally {
  await cleanup();
}
