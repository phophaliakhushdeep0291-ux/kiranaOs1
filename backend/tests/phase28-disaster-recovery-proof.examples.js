import assert from "assert";
import fs from "fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const backupScript = read("scripts/postgres-backup-create.js");
const restoreProof = read("scripts/disaster-recovery-proof.js");
const fidelity = read("scripts/restore-fidelity.js");
const safety = read("scripts/postgres-url-safety.js");
const shellBackup = read("scripts/backup-postgres.sh");
const proofSuite = read("scripts/production-proof-suite.js");
const productionCheck = read("scripts/production-check.js");
const pkg = JSON.parse(read("package.json"));
const envExample = read(".env.example");
const docs = read("docs/DISASTER_RECOVERY.md") + "\n" + read("docs/OPERATIONAL_PROOF.md") + "\n" + read("DEPLOY.md");

for (const file of [
  "scripts/postgres-backup-create.js",
  "scripts/disaster-recovery-proof.js",
  "scripts/postgres-url-safety.js",
  "docs/DISASTER_RECOVERY.md",
]) {
  assert.ok(fs.existsSync(file), `${file} must exist`);
  assert.ok(productionCheck.includes(file), `production-check must require ${file}`);
}

assert.equal(pkg.scripts["backup:postgres"], "node scripts/postgres-backup-create.js", "backup:postgres command must exist");
assert.equal(pkg.scripts["proof:dr"], "node scripts/disaster-recovery-proof.js", "proof:dr command must exist");
assert.equal(pkg.scripts["proof:restore"], "node scripts/disaster-recovery-proof.js", "proof:restore alias must exist");
assert.ok(pkg.scripts["test:billing"].includes("phase28-disaster-recovery-proof.examples.js"), "npm test must include phase 28 examples");

for (const snippet of [
  "pg_dump",
  "--format=custom",
  "--no-owner",
  "--no-privileges",
  "BACKUP_DIR",
  "BACKUP_DRY_RUN",
  "maskPostgresUrl",
  "Backup file was created but is empty",
  "sha256",
]) {
  assert.ok(backupScript.includes(snippet), `backup script must include ${snippet}`);
}

for (const snippet of [
  "pg_dump --format=custom",
  "--format=custom",
  "--no-owner",
  "--no-privileges",
]) {
  assert.ok(shellBackup.includes(snippet), `shell backup script must use safer pg_dump option ${snippet}`);
}
assert.ok(shellBackup.includes('exec node "$SCRIPT_DIR/postgres-backup-create.js"'), "shell entry point must delegate to the verified native backup implementation");
assert.ok(restoreProof.includes('ALLOW_MONEY_PAISE_BACKFILL: "false"'), "a restore proof must never repair the monetary evidence it verifies");

for (const snippet of [
  "ALLOW_RESTORE_TEST_DB=true",
  "RESTORE_TEST_DATABASE_URL",
  "DATABASE_URL",
  "assertSafeRestoreTarget",
  "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
  "pg_restore",
  "psql",
  "openPostgresSnapshot",
  "compareRestoreManifests",
  "sha256File",
  "disaster-recovery-proof-latest.json",
  "DR_KEEP_BACKUP",
  "backendSourceFingerprintSha256",
  '"diff", "--binary", "HEAD", "--", "backend"',
  "DISASTER_RECOVERY_SOURCE_CHANGED",
  "money:paise:reconcile",
  "PROOF_REQUIRE_DR",
]) {
  assert.ok(restoreProof.includes(snippet), `restore proof must include ${snippet}`);
}
for (const snippet of ["pg_tables", "RESTORE_FIDELITY_MISMATCH", "RESTORE_WORKLOAD_EMPTY", "_prisma_migrations", "pg_export_snapshot", "READ ONLY"]) {
  assert.ok(fidelity.includes(snippet), `restore fidelity helper must include ${snippet}`);
}
await import("./restore-fidelity.examples.js");

for (const snippet of [
  "RESTORE_TEST_DATABASE_URL must not point to the same database as DATABASE_URL",
  "isSafeRestoreDatabaseName",
  "prod|production|live|primary|main",
  "test|_ci|ci_|restore|drill|staging",
  "maskPostgresUrl",
  "postgresCliUrl",
]) {
  assert.ok(safety.includes(snippet), `URL safety helper must include ${snippet}`);
}
for (const parameter of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "socket_timeout"]) {
  assert.ok(safety.includes(`"${parameter}"`), `native PostgreSQL URL adapter must remove Prisma-only ${parameter}`);
}
assert.ok(safety.includes("preserve sslmode"), "native PostgreSQL URL adapter must preserve libpq connection parameters");
assert.ok(backupScript.includes("databaseCliUrl"), "backup script must pass the native PostgreSQL URL to pg_dump");
assert.ok(backupScript.includes("fs.rmSync(outputFile"), "backup failure must remove a partial dump file");

for (const snippet of [
  "PROOF_REQUIRE_DR",
  "RESTORE_TEST_DATABASE_URL",
  "ALLOW_RESTORE_TEST_DB=true",
  "PostgreSQL backup/restore disaster recovery proof",
  "restoreDrillConfigured",
]) {
  assert.ok(proofSuite.includes(snippet), `production proof suite must include ${snippet}`);
}

for (const key of [
  "BACKUP_DIR",
  "BACKUP_FORMAT",
  "BACKUP_DRY_RUN",
  "RESTORE_TEST_DATABASE_URL",
  "ALLOW_RESTORE_TEST_DB",
  "PROOF_REQUIRE_DR",
  "DR_CREATE_BACKUP",
  "BACKUP_FILE",
]) {
  assert.ok(envExample.includes(key), `.env.example must document ${key}`);
}

for (const phrase of [
  "disaster-recovery drill",
  "npm run backup:postgres",
  "npm run proof:dr",
  "A backup that cannot be restored is not a backup",
  "Never point `RESTORE_TEST_DATABASE_URL` at the production database",
]) {
  assert.ok(docs.includes(phrase), `DR docs must mention ${phrase}`);
}

console.log("Phase 28 disaster recovery proof examples passed");
