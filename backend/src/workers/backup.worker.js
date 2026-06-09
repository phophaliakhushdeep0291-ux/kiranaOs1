import { JOB_NAMES } from "./queueNames.js";

export async function handleBackupJob(job) {
  switch (job.name) {
    case JOB_NAMES.RUN_SHOP_BACKUP:
    case JOB_NAMES.RUN_DATABASE_BACKUP:
      return runBackupPlaceholder(job.name, job.data);
    default: {
      const error = new Error(`Unknown backup job: ${job.name}`);
      error.code = "UNKNOWN_BACKUP_JOB";
      throw error;
    }
  }
}

function runBackupPlaceholder(jobName, payload = {}) {
  if (jobName === JOB_NAMES.RUN_SHOP_BACKUP && !payload.shopId) {
    const error = new Error("shopId is required for RUN_SHOP_BACKUP");
    error.code = "INVALID_BACKUP_JOB_PAYLOAD";
    throw error;
  }
  return {
    status: "NOT_IMPLEMENTED",
    queued: true,
    jobName,
    reason: "Backup execution will call an approved backup script/provider in a later phase. No DB credentials are stored in payloads.",
  };
}
