import { QUEUE_NAMES } from "./queueNames.js";
import { handleReminderJob } from "./reminder.worker.js";
import { handleReportsJob } from "./reports.worker.js";
import { handleExportsJob } from "./exports.worker.js";
import { handleBackupJob } from "./backup.worker.js";
import { handleSyncCleanupJob } from "./syncCleanup.worker.js";
import { handleWebhookJob } from "./webhooks.worker.js";

export const WORKER_REGISTRY = Object.freeze([
  { queueName: QUEUE_NAMES.reminderQueue, handler: handleReminderJob },
  { queueName: QUEUE_NAMES.reportsQueue, handler: handleReportsJob },
  { queueName: QUEUE_NAMES.exportsQueue, handler: handleExportsJob },
  { queueName: QUEUE_NAMES.backupQueue, handler: handleBackupJob },
  { queueName: QUEUE_NAMES.syncCleanupQueue, handler: handleSyncCleanupJob },
  { queueName: QUEUE_NAMES.webhooksQueue, handler: handleWebhookJob },
]);
