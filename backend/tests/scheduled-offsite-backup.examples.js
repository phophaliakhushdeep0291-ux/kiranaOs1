import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The scheduled Railway service must either put a verified dump in the bucket or
// fail its run. These pin the two ways it used to be able to succeed without one.

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const offsiteCommand = pkg.scripts["backup:postgres:offsite"];
assert.ok(offsiteCommand, "backup:postgres:offsite command must exist");
for (const assignment of ["DATABASE_BACKUP_ENABLED=true", "BACKUP_REQUIRE_OFFSITE=true", "DATABASE_BACKUP_DISCARD_LOCAL=true"]) {
  assert.ok(offsiteCommand.includes(assignment), `backup:postgres:offsite must set ${assignment}`);
}
assert.ok(offsiteCommand.endsWith("node scripts/postgres-backup-create.js"), "backup:postgres:offsite must run the tested backup implementation");

const backupService = JSON.parse(fs.readFileSync("railway.backup.json", "utf8"));
assert.equal(backupService.build.builder, "DOCKERFILE", "the backup service must use the image that carries PostgreSQL 18 clients");
assert.equal(backupService.deploy.startCommand, "npm run backup:postgres:offsite");
// Railway cron runs in UTC: 20:30 UTC is 02:00 Asia/Kolkata, after the shops close.
assert.equal(backupService.deploy.cronSchedule, "30 20 * * *");
// A cron job that exits must not be restarted into a second dump, and it serves
// no HTTP, so an inherited health check would fail every run.
assert.equal(backupService.deploy.restartPolicyType, "NEVER");
assert.equal(backupService.deploy.healthcheckPath, undefined);

// The API's config must stay free of a start command: it would skip migrations.
const apiService = JSON.parse(fs.readFileSync("railway.json", "utf8"));
assert.equal(apiService.deploy.startCommand, undefined, "railway.json must not override the migrating CMD");
assert.equal(apiService.deploy.cronSchedule, undefined, "railway.json is the API; the schedule belongs to railway.backup.json");

const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiranaos-offsite-guard-"));
function runBackup(extraEnv) {
  return spawnSync(process.execPath, ["scripts/postgres-backup-create.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: "postgresql://backup:secret@db.example.invalid:5432/kiranaos_offsite_guard",
      BACKUP_DIR: backupDir,
      BACKUP_DRY_RUN: "true",
      ...extraEnv,
    },
  });
}

try {
  const withoutUpload = runBackup({ BACKUP_REQUIRE_OFFSITE: "true" });
  assert.notEqual(withoutUpload.status, 0, "an off-site run with uploads disabled must fail");
  assert.match(withoutUpload.stderr, /requires DATABASE_BACKUP_ENABLED=true/);

  const localStorage = runBackup({ BACKUP_REQUIRE_OFFSITE: "true", DATABASE_BACKUP_ENABLED: "true" });
  assert.notEqual(localStorage.status, 0, "an off-site run without a bucket must fail");
  assert.match(localStorage.stderr, /requires STORAGE_PROVIDER s3, r2 or minio, not local/);

  const explicitLocal = runBackup({ BACKUP_REQUIRE_OFFSITE: "true", DATABASE_BACKUP_ENABLED: "true", STORAGE_PROVIDER: "local" });
  assert.notEqual(explicitLocal.status, 0);
  assert.match(explicitLocal.stderr, /not local/);

  // Configured correctly, the guard stays out of the way. The dry run stops
  // before connecting, but still needs pg_dump on PATH to get that far.
  const configured = runBackup({ BACKUP_REQUIRE_OFFSITE: "true", DATABASE_BACKUP_ENABLED: "true", STORAGE_PROVIDER: "r2" });
  assert.doesNotMatch(configured.stderr, /BACKUP_REQUIRE_OFFSITE/);
  if (spawnSync("pg_dump", ["--version"], { stdio: "ignore" }).status === 0) {
    assert.equal(configured.status, 0, configured.stderr);
    assert.match(configured.stdout, /"status":"dry_run"/);
  }

  // The manual command keeps working without a bucket, as the runbooks use it.
  const manual = runBackup({});
  assert.doesNotMatch(manual.stderr, /BACKUP_REQUIRE_OFFSITE/);

  assert.deepEqual(fs.readdirSync(backupDir), [], "a refused or dry run must not leave a file that looks like a backup");
} finally {
  fs.rmSync(backupDir, { recursive: true, force: true });
}

console.log("scheduled off-site backup examples passed");
