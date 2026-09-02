import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parsePostgresUrl, maskPostgresUrl, postgresCliUrl } from "./postgres-url-safety.js";

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
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
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
const dryRun = boolEnv("BACKUP_DRY_RUN");

const db = parsePostgresUrl(databaseUrl, "DATABASE_URL");
const databaseCliUrl = postgresCliUrl(databaseUrl);
if (!commandExists("pg_dump")) {
  throw new Error("pg_dump was not found. Install PostgreSQL client tools before running backup proof.");
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
fs.mkdirSync(backupDir, { recursive: true });
const extension = backupFormat === "plain" ? "sql" : "dump";
const outputFile = path.resolve(backupDir, `kiranaos-${db.database}-${timestamp}.${extension}`);

const args = backupFormat === "plain"
  ? ["--no-owner", "--no-privileges", "--file", outputFile, databaseCliUrl]
  : ["--format=custom", "--no-owner", "--no-privileges", "--file", outputFile, databaseCliUrl];

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

try {
  run("pg_dump", args);
} catch (error) {
  // pg_dump may create an empty/partial destination before a connection or
  // streaming failure. Never leave that file where an operator may mistake it
  // for a usable backup.
  fs.rmSync(outputFile, { force: true });
  throw error;
}
const stat = fs.statSync(outputFile);
if (!stat.size) throw new Error("Backup file was created but is empty");
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(outputFile)).digest("hex");

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
