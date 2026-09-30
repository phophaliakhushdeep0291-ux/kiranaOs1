/**
 * Outbox operations that never reach /sync/push: they record something about
 * this device (its audit trail, settings, subscription and device state) and
 * are settled locally.
 *
 * A module of its own, with no imports, because the offline database reads it
 * to decide what a view-only login may still queue, and the normalizer that
 * also reads it imports the database.
 */
export const LOCAL_ONLY_SYNC_OPERATION_TYPES: ReadonlySet<string> = new Set([
  "AUDIT_LOG_APPEND",
  "SUBSCRIPTION_REFRESH",
  "UPDATE_SETTINGS",
  "STAFF_ACTION",
  "DEVICE_ADD_PENDING",
  "DEVICE_REMOVE_PENDING",
]);
