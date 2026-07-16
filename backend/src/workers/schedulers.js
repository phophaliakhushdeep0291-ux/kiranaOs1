import { env } from "../config/env.js";
import { defaultJobOptions, getQueue } from "../lib/queue.js";
import { JOB_NAMES, QUEUE_NAMES } from "./queueNames.js";

const SHOP_BACKUP_CLEANUP_SCHEDULER = "shop-backup-expiry-cleanup-v1";

/**
 * Registers idempotent infrastructure-owned schedules. BullMQ's scheduler ID
 * makes this safe when several worker replicas start at the same time.
 */
export async function registerMaintenanceSchedulers() {
  const backupQueue = await getQueue(QUEUE_NAMES.backupQueue);
  if (!backupQueue) return { registered: false, reason: "JOB_QUEUE_UNAVAILABLE" };

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
  return {
    registered: true,
    schedules: [{ id: SHOP_BACKUP_CLEANUP_SCHEDULER, jobName: JOB_NAMES.CLEANUP_EXPIRED_BACKUPS, every }],
  };
}

export const __schedulerInternals = { SHOP_BACKUP_CLEANUP_SCHEDULER };
