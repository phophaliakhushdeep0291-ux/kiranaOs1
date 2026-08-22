import { env } from "../config/env.js";
import { defaultJobOptions, getQueue } from "../lib/queue.js";
import { JOB_NAMES, QUEUE_NAMES } from "./queueNames.js";

const SHOP_BACKUP_CLEANUP_SCHEDULER = "shop-backup-expiry-cleanup-v1";
const DATABASE_BACKUP_SCHEDULER = "database-backup-offsite-v1";
const ASSURANCE_SCHEDULED_RUN_SCHEDULER = "assurance-scheduled-run-v1";
const ASSURANCE_BASELINE_SCHEDULER = "assurance-baseline-refresh-v1";

/**
 * Registers idempotent infrastructure-owned schedules. BullMQ's scheduler ID
 * makes this safe when several worker replicas start at the same time.
 */
export async function registerMaintenanceSchedulers() {
  const backupQueue = await getQueue(QUEUE_NAMES.backupQueue);
  if (!backupQueue) return { registered: false, reason: "JOB_QUEUE_UNAVAILABLE" };

  const schedules = [];
  const every = env.BACKUP_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
  await backupQueue.upsertJobScheduler(
    SHOP_BACKUP_CLEANUP_SCHEDULER,
    { every },
    {
      name: JOB_NAMES.CLEANUP_EXPIRED_BACKUPS,
      data: { limit: 100 },
      opts: defaultJobOptions(),
    },
  );
  schedules.push({ id: SHOP_BACKUP_CLEANUP_SCHEDULER, jobName: JOB_NAMES.CLEANUP_EXPIRED_BACKUPS, every });

  // The daily database dump. RUN_DATABASE_BACKUP existed, and was handled, but
  // nothing had ever enqueued it — so the recovery objective rested on a job
  // with no producer. `confirm` is what the handler demands of a real scheduler.
  //
  // Off by default: this schedule is only meaningful once object storage is
  // configured, and a shop with no bucket is better served by an explicit
  // decision than by a job that fails every night.
  if (env.DATABASE_BACKUP_ENABLED) {
    const databaseBackupEvery = env.DATABASE_BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
    await backupQueue.upsertJobScheduler(
      DATABASE_BACKUP_SCHEDULER,
      { every: databaseBackupEvery },
      {
        name: JOB_NAMES.RUN_DATABASE_BACKUP,
        data: { confirm: true },
        opts: defaultJobOptions(),
      },
    );
    schedules.push({ id: DATABASE_BACKUP_SCHEDULER, jobName: JOB_NAMES.RUN_DATABASE_BACKUP, every: databaseBackupEvery });
  }

  // Continuous financial control: sweep recent activity for every active shop,
  // and refresh the behavioural baselines that gate the outlier rules. Both are
  // read-only toward canonical financial data and idempotent, so a missed or
  // repeated tick costs nothing but read work.
  if (env.AUDIT_SCHEDULED_RUNS_ENABLED) {
    const assuranceQueue = await getQueue(QUEUE_NAMES.assuranceQueue);
    if (assuranceQueue) {
      const assuranceEvery = env.AUDIT_SCHEDULED_RUN_INTERVAL_HOURS * 60 * 60 * 1000;
      await assuranceQueue.upsertJobScheduler(
        ASSURANCE_SCHEDULED_RUN_SCHEDULER,
        { every: assuranceEvery },
        {
          name: JOB_NAMES.RUN_SCHEDULED_ASSURANCE,
          // Overlap the window so a late offline sync is never skipped.
          data: { lookbackHours: env.AUDIT_SCHEDULED_RUN_LOOKBACK_HOURS },
          opts: defaultJobOptions(),
        },
      );
      schedules.push({ id: ASSURANCE_SCHEDULED_RUN_SCHEDULER, jobName: JOB_NAMES.RUN_SCHEDULED_ASSURANCE, every: assuranceEvery });

      const baselineEvery = 24 * 60 * 60 * 1000;
      await assuranceQueue.upsertJobScheduler(
        ASSURANCE_BASELINE_SCHEDULER,
        { every: baselineEvery },
        {
          name: JOB_NAMES.RECOMPUTE_ASSURANCE_BASELINES,
          data: { windowDays: 90 },
          opts: defaultJobOptions(),
        },
      );
      schedules.push({ id: ASSURANCE_BASELINE_SCHEDULER, jobName: JOB_NAMES.RECOMPUTE_ASSURANCE_BASELINES, every: baselineEvery });
    }
  }

  return { registered: true, schedules };
}

export const __schedulerInternals = {
  SHOP_BACKUP_CLEANUP_SCHEDULER,
  DATABASE_BACKUP_SCHEDULER,
  ASSURANCE_SCHEDULED_RUN_SCHEDULER,
  ASSURANCE_BASELINE_SCHEDULER,
};
