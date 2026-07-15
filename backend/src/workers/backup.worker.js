import { JOB_NAMES } from "./queueNames.js";
import { spawn } from "node:child_process";
import {
  cleanupExpiredShopBackups,
  processShopBackupArtifact,
} from "../modules/backups/backup.service.js";

export async function handleBackupJob(job) {
  switch (job.name) {
    case JOB_NAMES.RUN_SHOP_BACKUP:
      return runShopBackup(job.data);
    case JOB_NAMES.RUN_DATABASE_BACKUP:
      return runDatabaseBackup(job.data);
    case JOB_NAMES.CLEANUP_EXPIRED_BACKUPS:
      return cleanupExpiredShopBackups(job.data);
    default: {
      const error = new Error(`Unknown backup job: ${job.name}`);
      error.code = "UNKNOWN_BACKUP_JOB";
      throw error;
    }
  }
}

async function runShopBackup(payload = {}) {
  if (!payload.artifactId || !payload.shopId || !payload.userId) {
    const error = new Error("artifactId, shopId, and userId are required for RUN_SHOP_BACKUP");
    error.code = "INVALID_BACKUP_JOB_PAYLOAD";
    throw error;
  }
  // No DB credentials are stored in payloads. The worker reads approved
  // environment configuration and produces one encrypted tenant artifact.
  return processShopBackupArtifact(payload.artifactId, payload.shopId);
}

async function runDatabaseBackup(payload = {}) {
  if (payload.confirm !== true) {
    const error = new Error("RUN_DATABASE_BACKUP requires confirm=true from the platform scheduler");
    error.code = "DATABASE_BACKUP_CONFIRMATION_REQUIRED";
    throw error;
  }
  // No DB credentials are stored in payloads or command arguments assembled
  // from the job. The fixed script reads DATABASE_URL only from worker env and
  // masks it in its own structured output.
  const child = spawn(process.execPath, ["scripts/postgres-backup-create.js"], {
    cwd: process.cwd(),
    env: { ...process.env, BACKUP_DRY_RUN: "false" },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-64 * 1024); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16 * 1024); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0) {
    const error = new Error("PostgreSQL backup command failed; inspect protected worker logs");
    error.code = "DATABASE_BACKUP_COMMAND_FAILED";
    error.cause = stderr.slice(-1000);
    throw error;
  }
  const resultLine = stdout.split(/\r?\n/).reverse().find((line) => line.includes('"type"') || line.includes('"status"'));
  return {
    status: "completed",
    jobName: JOB_NAMES.RUN_DATABASE_BACKUP,
    proof: resultLine ? resultLine.slice(0, 2000) : "pg_dump completed",
    credentialsExposed: false,
  };
}
