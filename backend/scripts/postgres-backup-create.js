import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parsePostgresUrl, maskPostgresUrl } from "./postgres-url-safety.js";

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr : "";
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result;
}

function commandExists(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return probe.status === 0;
}

const databaseUrl = process.env.DATABASE_URL;
const backupDir = process.env.BACKUP_DIR || "./backups";
const backupFormat = process.env.BACKUP_FORMAT || "custom";
const dryRun = boolEnv("BACKUP_DRY_RUN");

const db = parsePostgresUrl(databaseUrl, "DATABASE_URL");
if (!commandExists("pg_dump")) {
  throw new Error("pg_dump was not found. Install PostgreSQL client tools before running backup proof.");
}

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
fs.mkdirSync(backupDir, { recursive: true });
const extension = backupFormat === "plain" ? "sql" : "dump";
const outputFile = path.resolve(backupDir, `kiranaos-${db.database}-${timestamp}.${extension}`);

const args = backupFormat === "plain"
  ? ["--no-owner", "--no-privileges", "--file", outputFile, databaseUrl]
  : ["--format=custom", "--no-owner", "--no-privileges", "--file", outputFile, databaseUrl];

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

run("pg_dump", args);
const stat = fs.statSync(outputFile);
if (!stat.size) throw new Error("Backup file was created but is empty");

console.log(JSON.stringify({
  type: "postgres_backup",
  status: "passed",
  outputFile,
  bytes: stat.size,
  time: new Date().toISOString(),
}, null, 2));
