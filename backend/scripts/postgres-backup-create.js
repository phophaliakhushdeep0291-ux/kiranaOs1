import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parsePostgresUrl, maskPostgresUrl, postgresCliUrl } from "./postgres-url-safety.js";
import { sha256File } from "./restore-fidelity.js";

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function run(command, args, options = {}) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executable = command === "pg_dump" && process.env.PG_BIN_DIR
    ? path.join(process.env.PG_BIN_DIR, `pg_dump${suffix}`)
    : command;
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    shell: false,
  });
  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr : "";
    const safeStderr = String(stderr || "").split(databaseCliUrl).join(maskPostgresUrl(databaseCliUrl));
    throw new Error(`${command} failed${safeStderr ? `: ${safeStderr}` : ""}`);
  }
  return result;
}

function commandExists(command) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executable = command === "pg_dump" && process.env.PG_BIN_DIR
    ? path.join(process.env.PG_BIN_DIR, `pg_dump${suffix}`)
    : command;
  const probe = spawnSync(executable, ["--version"], { stdio: "ignore", shell: false });
  return probe.status === 0;
}

const databaseUrl = process.env.DATABASE_URL;
const backupDir = process.env.BACKUP_DIR || "./backups";
const backupFormat = process.env.BACKUP_FORMAT || "custom";
if (!["plain", "custom"].includes(backupFormat)) throw new Error("BACKUP_FORMAT must be plain or custom");
const dryRun = boolEnv("BACKUP_DRY_RUN");

const db = parsePostgresUrl(databaseUrl, "DATABASE_URL");
const databaseCliUrl = postgresCliUrl(databaseUrl);
if (!commandExists("pg_dump")) {
  throw new Error("pg_dump was not found. Install PostgreSQL client tools before running backup proof.");
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
fs.mkdirSync(backupDir, { recursive: true });
const extension = backupFormat === "plain" ? "sql" : "dump";
const filename = process.env.BACKUP_FILENAME || `kiranaos-${db.database.replace(/[^a-zA-Z0-9_-]/g, "_")}-${timestamp}-${crypto.randomUUID()}.${extension}`;
if (!/^[a-zA-Z0-9_.-]+$/.test(filename) || filename === "." || filename === "..") throw new Error("Invalid BACKUP_FILENAME");
const outputFile = path.resolve(backupDir, filename);
const snapshotId = process.env.BACKUP_SNAPSHOT_ID;
if (snapshotId && !/^[0-9A-Fa-f-]+$/.test(snapshotId)) throw new Error("Invalid BACKUP_SNAPSHOT_ID");
const snapshotArgs = snapshotId ? ["--snapshot", snapshotId] : [];

const args = backupFormat === "plain"
  ? ["--no-owner", "--no-privileges", ...snapshotArgs, "--file", outputFile, databaseCliUrl]
  : ["--format=custom", "--no-owner", "--no-privileges", ...snapshotArgs, "--file", outputFile, databaseCliUrl];

console.log(JSON.stringify({
  type: "postgres_backup_plan",
  database: db.database,
  host: db.host,
  backupFormat,
  outputFile,
  databaseUrl: maskPostgresUrl(databaseUrl),
  dryRun,
}, null, 2));

if (dryRun) {
  console.log(JSON.stringify({ type: "postgres_backup", status: "dry_run", outputFile }));
  process.exit(0);
}

// Reserve a unique file before pg_dump: concurrent backups can never overwrite
// each other, and failure cleanup only owns this invocation's destination.
fs.closeSync(fs.openSync(outputFile, "wx", 0o600));
try {
  run("pg_dump", args);
  if (!fs.statSync(outputFile).size) throw new Error("Backup file was created but is empty");
} catch (error) {
  // pg_dump may create an empty/partial destination before a connection or
  // streaming failure. Never leave that file where an operator may mistake it
  // for a usable backup.
  fs.rmSync(outputFile, { force: true });
  throw error;
}
const stat = fs.statSync(outputFile);
const sha256 = sha256File(outputFile);

console.log(JSON.stringify({
  type: "postgres_backup",
  status: "passed",
  outputFile,
  bytes: stat.size,
  sha256,
  time: new Date().toISOString(),
}, null, 2));

// A dump sitting on the container filesystem is not a backup: Railway's disk is
// ephemeral, so the copy died with the container that made it. Push it to the
// same object storage the tenant artifacts already use, prove it arrived by
// reading it back, then age out old copies.
//
// The import is lazy because it pulls the validated env schema in with it, and a
// dry-run plan should not need a fully configured backend to print.
if (boolEnv("DATABASE_BACKUP_ENABLED")) {
  const { uploadDatabaseBackup, pruneDatabaseBackups } = await import("../src/modules/backups/database-backup.service.js");
  const uploaded = await uploadDatabaseBackup({ filePath: outputFile, databaseName: db.database });
  const pruned = await pruneDatabaseBackups({ databaseName: db.database });

  // Only the worker asks for this. `npm run backup:postgres` and the restore
  // drill both read the local file afterwards, so it stays where it was written
  // unless the caller says it has no further use for it.
  const localDiscarded = boolEnv("DATABASE_BACKUP_DISCARD_LOCAL");
  if (localDiscarded) fs.rmSync(outputFile, { force: true });

  // One line, not pretty-printed: the worker keeps the last stdout line carrying
  // a "type" as its proof, and a pretty block would hand it a stray fragment.
  console.log(JSON.stringify({
    type: "postgres_backup_offsite",
    status: "passed",
    provider: uploaded.provider,
    key: uploaded.key,
    bytes: uploaded.sizeBytes,
    sha256: uploaded.sha256,
    verified: uploaded.verified,
    retainedCopies: pruned.retained,
    deletedCopies: pruned.deleted.length,
    retentionDays: pruned.retentionDays,
    localDiscarded,
    time: new Date().toISOString(),
  }));
}
