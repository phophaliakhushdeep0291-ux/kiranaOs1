export const QUEUE_NAMES = Object.freeze({
  reminderQueue: "kiranaos-reminders",
  reportsQueue: "kiranaos-reports",
  exportsQueue: "kiranaos-exports",
  backupQueue: "kiranaos-backups",
  syncCleanupQueue: "kiranaos-sync-cleanup",
  webhooksQueue: "kiranaos-webhooks",
});

export const JOB_NAMES = Object.freeze({
  GENERATE_DAILY_CLOSING: "GENERATE_DAILY_CLOSING",
  GENERATE_REPORT_EXPORT: "GENERATE_REPORT_EXPORT",
  GENERATE_CSV_EXPORT: "GENERATE_CSV_EXPORT",
  GENERATE_REPORT_PDF: "GENERATE_REPORT_PDF",
  CLEANUP_EXPIRED_EXPORTS: "CLEANUP_EXPIRED_EXPORTS",
  WORKER_HEALTHCHECK: "WORKER_HEALTHCHECK",
  SEND_WHATSAPP_REMINDER: "SEND_WHATSAPP_REMINDER",
  CLEANUP_SYNC_EVENTS: "CLEANUP_SYNC_EVENTS",
  ARCHIVE_OLD_SYNC_EVENTS: "ARCHIVE_OLD_SYNC_EVENTS",
  RUN_SHOP_BACKUP: "RUN_SHOP_BACKUP",
  RUN_DATABASE_BACKUP: "RUN_DATABASE_BACKUP",
  DELIVER_WEBHOOK: "DELIVER_WEBHOOK",
});

export function listQueueNames() {
  return Object.values(QUEUE_NAMES);
}
