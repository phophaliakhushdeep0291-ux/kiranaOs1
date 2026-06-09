import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafeRestoreTarget, maskPostgresUrl } from "./postgres-url-safety.js";

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function commandExists(command) {
  const probe = spawnSync(command, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return probe.status === 0;
}

function run(command, args, options = {}) {
  console.log(`▶ ${options.label || `${command} ${args.join(" ")}`}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr : "";
    throw new Error(`${options.label || command} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result;
}

function latestBackupFile(backupDir) {
  if (!fs.existsSync(backupDir)) return null;
  const candidates = fs.readdirSync(backupDir)
    .filter((name) => /\.(dump|sql|sql\.gz)$/.test(name))
    .map((name) => path.resolve(backupDir, name))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs, size: fs.statSync(file).size }))
    .filter((item) => item.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file || null;
}

// Set ALLOW_RESTORE_TEST_DB=true only for a throwaway restore-test database.
const requireDr = boolEnv("PROOF_REQUIRE_DR");
const sourceUrl = process.env.DATABASE_URL;
const restoreUrl = process.env.RESTORE_TEST_DATABASE_URL;
const allowRestore = boolEnv("ALLOW_RESTORE_TEST_DB");
const backupDir = process.env.BACKUP_DIR || "./backups";
const providedBackupFile = process.env.BACKUP_FILE;
const createBackup = boolEnv("DR_CREATE_BACKUP") || !providedBackupFile;

if (!sourceUrl || !restoreUrl) {
  const message = "Set DATABASE_URL and RESTORE_TEST_DATABASE_URL to run the restore drill";
  if (requireDr) {
    console.error(message);
    process.exit(1);
  }
  console.log(JSON.stringify({ type: "disaster_recovery_proof", status: "skipped", reason: message }));
  process.exit(0);
}

try {
  const { source, restore } = assertSafeRestoreTarget({ sourceUrl, restoreUrl, allowFlag: allowRestore });
  for (const command of ["pg_dump", "pg_restore", "psql"]) {
    if (!commandExists(command)) throw new Error(`${command} was not found. Install PostgreSQL client tools.`);
  }

  console.log(JSON.stringify({
    type: "disaster_recovery_proof_plan",
    source: { host: source.host, database: source.database, url: maskPostgresUrl(sourceUrl) },
    restore: { host: restore.host, database: restore.database, url: maskPostgresUrl(restoreUrl) },
    backupDir,
    createBackup,
    time: new Date().toISOString(),
  }, null, 2));

  let backupFile = providedBackupFile ? path.resolve(providedBackupFile) : null;
  if (createBackup) {
    run("node", ["scripts/postgres-backup-create.js"], {
      label: "Create fresh PostgreSQL logical backup",
      env: { BACKUP_FORMAT: "custom", BACKUP_DIR: backupDir },
    });
    backupFile = latestBackupFile(backupDir);
  }

  if (!backupFile || !fs.existsSync(backupFile)) throw new Error("No backup file available for restore drill");
  if (fs.statSync(backupFile).size <= 0) throw new Error("Backup file is empty");

  run("psql", [restoreUrl, "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"], {
    label: "Reset restore-test schema",
  });

  if (backupFile.endsWith(".sql")) {
    run("psql", [restoreUrl, "-v", "ON_ERROR_STOP=1", "-f", backupFile], { label: "Restore plain SQL backup into restore-test database" });
  } else {
    run("pg_restore", ["--no-owner", "--no-privileges", "--dbname", restoreUrl, backupFile], {
      label: "Restore custom-format backup into restore-test database",
    });
  }

  const probe = run("psql", [restoreUrl, "-v", "ON_ERROR_STOP=1", "-tAc", "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"], {
    label: "Verify restored database has public tables",
    capture: true,
  });
  const tableCount = Number(String(probe.stdout || "0").trim());
  if (!Number.isFinite(tableCount) || tableCount <= 0) {
    throw new Error("Restore verification failed: no public tables were found");
  }

  run("npm", ["run", "money:paise:reconcile"], {
    label: "Run money paise reconciliation against restored DB",
    env: { DATABASE_URL: restoreUrl, TEST_DATABASE_URL: restoreUrl },
  });

  console.log(JSON.stringify({
    type: "disaster_recovery_proof",
    status: "passed",
    backupFile,
    restoredTableCount: tableCount,
    time: new Date().toISOString(),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    type: "disaster_recovery_proof",
    status: "failed",
    message: error.message,
    time: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
}
