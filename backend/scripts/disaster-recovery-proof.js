import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { assertSafeRestoreTarget, maskPostgresUrl, postgresCliUrl } from "./postgres-url-safety.js";

function boolEnv(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function resolvedCommand(command, args = []) {
  if (command === "node") return { executable: process.execPath, args };
  if (command === "npm" && process.env.npm_execpath) {
    return { executable: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  const pgCommands = new Set(["pg_dump", "pg_restore", "psql"]);
  if (pgCommands.has(command) && process.env.PG_BIN_DIR) {
    const suffix = process.platform === "win32" ? ".exe" : "";
    return { executable: path.join(process.env.PG_BIN_DIR, `${command}${suffix}`), args };
  }
  return { executable: command, args };
}

function commandExists(command) {
  const resolved = resolvedCommand(command, ["--version"]);
  const probe = spawnSync(resolved.executable, resolved.args, { stdio: "ignore", shell: false });
  return probe.status === 0;
}

const stages = [];
const repositoryRoot = path.resolve(process.cwd(), "..");

function run(command, args, options = {}) {
  const label = options.label || `${command} ${args.join(" ")}`;
  const resolved = resolvedCommand(command, args);
  const startedAt = Date.now();
  console.log(`▶ ${label}`);
  const result = spawnSync(resolved.executable, resolved.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    shell: false,
  });
  const stage = {
    id: options.id || String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    label,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
  };
  if (options.record !== false) stages.push(stage);
  if (result.status !== 0) {
    const stderr = options.capture ? String(result.stderr || "").trim() : "";
    throw new Error(`${label} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result;
}

function backupFiles(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => /\.(dump|sql|sql\.gz)$/.test(name))
    .map((name) => path.resolve(backupDir, name))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs, size: fs.statSync(file).size }))
    .filter((item) => item.size > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function latestNewBackupFile(backupDir, existingFiles) {
  return backupFiles(backupDir).find((item) => !existingFiles.has(item.file))?.file || null;
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

const TABLE_COUNTS_SQL = `
CREATE TEMP TABLE kiranaos_dr_counts (table_name text PRIMARY KEY, row_count bigint NOT NULL);
DO $kiranaos$
DECLARE item record; counted bigint;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', item.tablename) INTO counted;
    INSERT INTO kiranaos_dr_counts(table_name, row_count) VALUES (item.tablename, counted);
  END LOOP;
END
$kiranaos$;
SELECT COALESCE(jsonb_object_agg(table_name, row_count ORDER BY table_name), '{}'::jsonb)::text
FROM kiranaos_dr_counts;`;

function exactPublicTableCounts(databaseUrl, label) {
  const result = run("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", TABLE_COUNTS_SQL], {
    id: `${label}-table-counts`,
    label: `Capture exact ${label} public-table row counts`,
    capture: true,
  });
  const candidates = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const jsonLine = candidates.findLast((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) throw new Error(`Could not read ${label} table-count manifest`);
  const counts = JSON.parse(jsonLine);
  if (!Object.keys(counts).length) throw new Error(`${label} database has no public tables`);
  return counts;
}

function compareTableCounts(sourceCounts, restoredCounts) {
  const sourceTables = Object.keys(sourceCounts).sort();
  const restoredTables = Object.keys(restoredCounts).sort();
  const missing = sourceTables.filter((table) => !(table in restoredCounts));
  const unexpected = restoredTables.filter((table) => !(table in sourceCounts));
  const rowCountMismatches = sourceTables
    .filter((table) => table in restoredCounts && Number(sourceCounts[table]) !== Number(restoredCounts[table]))
    .map((table) => ({ table, source: Number(sourceCounts[table]), restored: Number(restoredCounts[table]) }));
  if (missing.length || unexpected.length || rowCountMismatches.length) {
    const error = new Error("Restore fidelity failed: table inventory or exact row counts differ from the source snapshot");
    error.code = "RESTORE_FIDELITY_MISMATCH";
    error.details = { missing, unexpected, rowCountMismatches };
    throw error;
  }
  return {
    tableCount: sourceTables.length,
    totalRows: sourceTables.reduce((sum, table) => sum + Number(sourceCounts[table] || 0), 0),
    migrationRows: Number(sourceCounts._prisma_migrations || 0),
    exactMatch: true,
  };
}

function readGitValue(args) {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? String(result.stdout || "").trim() || null : null;
}

function backendSourceFingerprint() {
  const hash = crypto.createHash("sha256");
  hash.update(readGitValue(["rev-parse", "HEAD"]) || "unknown-commit");
  const diff = spawnSync("git", ["diff", "--binary", "HEAD", "--", "backend"], {
    cwd: repositoryRoot,
    encoding: null,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (diff.status !== 0) throw new Error("Could not fingerprint backend source diff");
  hash.update(diff.stdout || Buffer.alloc(0));
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", "backend"], {
    cwd: repositoryRoot,
    encoding: null,
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (untracked.status !== 0) throw new Error("Could not fingerprint untracked backend source");
  for (const relativePath of String(untracked.stdout || "").split("\0").filter(Boolean).sort()) {
    hash.update(`\0${relativePath}\0`);
    hash.update(fs.readFileSync(path.join(repositoryRoot, relativePath)));
  }
  return hash.digest("hex");
}

const backendSourceFingerprintAtStart = backendSourceFingerprint();

function databaseIdentity(parsed, rawUrl) {
  return {
    host: parsed.host,
    port: parsed.port || "5432",
    database: parsed.database,
    maskedUrl: maskPostgresUrl(rawUrl),
  };
}

const proofStartedAt = new Date();
const proofStamp = proofStartedAt.toISOString().replace(/[:.]/g, "-");
const requireDr = boolEnv("PROOF_REQUIRE_DR");
const sourceUrl = process.env.DATABASE_URL;
const restoreUrl = process.env.RESTORE_TEST_DATABASE_URL;
// Set ALLOW_RESTORE_TEST_DB=true only for a deliberately disposable target.
const allowRestore = boolEnv("ALLOW_RESTORE_TEST_DB");
const backupDir = path.resolve(process.env.BACKUP_DIR || "./backups");
const providedBackupFile = process.env.BACKUP_FILE;
const createBackup = boolEnv("DR_CREATE_BACKUP") || !providedBackupFile;
const keepGeneratedBackup = boolEnv("DR_KEEP_BACKUP");
const reportPath = path.resolve(
  process.env.DR_PROOF_REPORT_PATH ||
    path.join(process.cwd(), "release-artifacts", `disaster-recovery-proof-${proofStamp}.json`)
);
const latestReportPath = path.join(path.dirname(reportPath), "disaster-recovery-proof-latest.json");

let parsedSource = null;
let parsedRestore = null;
let sourceCliUrl = null;
let restoreCliUrl = null;
let backupFile = providedBackupFile ? path.resolve(providedBackupFile) : null;
let generatedBackup = false;
let backupEvidence = null;
let sourceCounts = null;
let restoredCounts = null;
let fidelity = null;
let failure = null;
let cleanup = { generatedBackupRemoved: false };
let finalStatus = "failed";

function writeReport() {
  const completedAt = new Date();
  const report = {
    schemaVersion: 1,
    type: "kiranaos_disaster_recovery_proof",
    status: finalStatus,
    startedAt: proofStartedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - proofStartedAt.getTime(),
    repository: {
      commit: readGitValue(["rev-parse", "HEAD"]),
      branch: readGitValue(["branch", "--show-current"]),
      dirty: Boolean(readGitValue(["status", "--porcelain"])),
      backendDirty: Boolean(readGitValue(["status", "--porcelain", "--", "backend"])),
      backendSourceFingerprintSha256: backendSourceFingerprintAtStart,
      backendSourceStable: backendSourceFingerprintAtStart === backendSourceFingerprint(),
    },
    source: parsedSource ? databaseIdentity(parsedSource, sourceUrl) : null,
    restore: parsedRestore ? databaseIdentity(parsedRestore, restoreUrl) : null,
    backup: backupEvidence,
    fidelity,
    sourceTableCounts: sourceCounts,
    restoredTableCounts: restoredCounts,
    stages,
    cleanup,
    failure,
    limitations: [
      "This proves logical backup and exact-row-count restoration on an isolated PostgreSQL runtime.",
      "It does not prove cloud object-storage durability, cross-region recovery, recovery-time objectives under production load, or operator incident response.",
    ],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  fs.writeFileSync(reportPath, serialized, "utf8");
  if (latestReportPath !== reportPath) fs.writeFileSync(latestReportPath, serialized, "utf8");
}

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
  ({ source: parsedSource, restore: parsedRestore } = assertSafeRestoreTarget({ sourceUrl, restoreUrl, allowFlag: allowRestore }));
  sourceCliUrl = postgresCliUrl(sourceUrl);
  restoreCliUrl = postgresCliUrl(restoreUrl);
  for (const command of ["pg_dump", "pg_restore", "psql"]) {
    if (!commandExists(command)) throw new Error(`${command} was not found. Install PostgreSQL client tools or set PG_BIN_DIR.`);
  }

  console.log(JSON.stringify({
    type: "disaster_recovery_proof_plan",
    source: databaseIdentity(parsedSource, sourceUrl),
    restore: databaseIdentity(parsedRestore, restoreUrl),
    backupDir,
    createBackup,
    keepGeneratedBackup,
    time: new Date().toISOString(),
  }, null, 2));

  const existingBackupFiles = new Set(backupFiles(backupDir).map((item) => item.file));
  if (createBackup) {
    run("node", ["scripts/postgres-backup-create.js"], {
      id: "create-backup",
      label: "Create fresh PostgreSQL logical backup",
      env: { BACKUP_FORMAT: "custom", BACKUP_DIR: backupDir },
    });
    backupFile = latestNewBackupFile(backupDir, existingBackupFiles);
    generatedBackup = true;
  }

  if (!backupFile || !fs.existsSync(backupFile)) throw new Error("No new backup file available for restore drill");
  const backupStat = fs.statSync(backupFile);
  if (backupStat.size <= 0) throw new Error("Backup file is empty");
  backupEvidence = {
    format: backupFile.endsWith(".sql") ? "plain" : "custom",
    filename: path.basename(backupFile),
    bytes: backupStat.size,
    sha256: sha256File(backupFile),
    generatedByThisProof: generatedBackup,
    retainedAfterProof: generatedBackup ? keepGeneratedBackup : true,
  };

  sourceCounts = exactPublicTableCounts(sourceCliUrl, "source");

  run("psql", [restoreCliUrl, "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"], {
    id: "reset-restore-schema",
    label: "Reset restore-test schema",
  });

  if (backupFile.endsWith(".sql")) {
    run("psql", [restoreCliUrl, "-v", "ON_ERROR_STOP=1", "-f", backupFile], {
      id: "restore-backup",
      label: "Restore plain SQL backup into restore-test database",
    });
  } else {
    run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", restoreCliUrl, backupFile], {
      id: "restore-backup",
      label: "Restore custom-format backup into restore-test database",
    });
  }

  restoredCounts = exactPublicTableCounts(restoreCliUrl, "restored");
  fidelity = compareTableCounts(sourceCounts, restoredCounts);
  stages.push({
    id: "exact-restore-fidelity",
    label: "Compare exact source and restored table inventory and row counts",
    status: "passed",
    exitCode: 0,
    durationMs: 0,
  });
  if (fidelity.migrationRows <= 0) throw new Error("Restore verification failed: Prisma migration ledger is empty");

  run("npm", ["run", "money:paise:reconcile"], {
    id: "money-paise-reconciliation",
    label: "Run money paise reconciliation against restored DB",
    env: { DATABASE_URL: restoreUrl, TEST_DATABASE_URL: restoreUrl },
  });

  if (backendSourceFingerprint() !== backendSourceFingerprintAtStart) {
    const error = new Error("Backend source changed while the disaster-recovery proof was running");
    error.code = "DISASTER_RECOVERY_SOURCE_CHANGED";
    throw error;
  }

  finalStatus = "passed";
} catch (error) {
  failure = {
    code: error?.code || error?.name || "DISASTER_RECOVERY_PROOF_FAILED",
    message: error?.message || "Disaster recovery proof failed",
    details: error?.details || null,
  };
  process.exitCode = 1;
} finally {
  if (generatedBackup && !keepGeneratedBackup && backupFile && fs.existsSync(backupFile)) {
    fs.rmSync(backupFile, { force: true });
    cleanup = { generatedBackupRemoved: !fs.existsSync(backupFile) };
  }
  writeReport();
}

console.log(JSON.stringify({
  type: "disaster_recovery_proof",
  status: finalStatus,
  backup: backupEvidence,
  fidelity,
  reportPath,
  failure,
  time: new Date().toISOString(),
}, null, 2));
