// The complete set of things a remote operator can make a shop's device do.
//
// Anything absent from this table is impossible, not merely discouraged: the
// catalog is consulted when a command is queued AND again when it is handed to a
// device, so a row inserted by any other means still cannot execute. Every entry
// maps to a function the app already runs locally when the owner taps a button —
// remote support drives the same code paths, it does not open new ones.
//
// Deliberately absent, and to stay absent: anything that reads or writes
// financial records. An operator can make sync work again; they cannot edit a
// bill, a payment or a customer's udhar. That line is what keeps the audit
// engine's "read-only toward financial data" guarantee true.

export const COMMAND_SCOPES = Object.freeze({
  DIAGNOSE: "diagnose",
  REPAIR: "repair",
});

export const COMMAND_STATUS = Object.freeze({
  QUEUED: "queued",
  DELIVERED: "delivered",
  APPLIED: "applied",
  FAILED: "failed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

export const SESSION_STATUS = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  ENDED: "ended",
  REVOKED: "revoked",
  EXPIRED: "expired",
});

// A queued command that no device has picked up within this window is stale —
// the shop was probably closed. Expiring it stops a week-old "reload the app"
// from firing in the middle of a busy morning.
export const COMMAND_TTL_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_SESSION_TTL_MINUTES = 30;
export const MAX_SESSION_TTL_MINUTES = 120;

// `label` and `ownerSummary` are user-visible: the owner sees exactly what was
// run on their device, in the same plain language the assistant uses.
export const COMMAND_CATALOG = Object.freeze({
  COLLECT_DIAGNOSTICS: {
    type: "COLLECT_DIAGNOSTICS",
    scope: COMMAND_SCOPES.DIAGNOSE,
    label: "Collect a fresh diagnostic snapshot",
    ownerSummary: "Support asked this device to send its current health details.",
    reloadsApp: false,
  },
  RUN_SYNC_NOW: {
    type: "RUN_SYNC_NOW",
    scope: COMMAND_SCOPES.REPAIR,
    label: "Sync now",
    ownerSummary: "Support started a sync on this device.",
    reloadsApp: false,
  },
  RETRY_FAILED_SYNC: {
    type: "RETRY_FAILED_SYNC",
    scope: COMMAND_SCOPES.REPAIR,
    label: "Retry everything that failed to sync",
    ownerSummary: "Support retried the entries that had failed to sync.",
    reloadsApp: false,
  },
  PULL_FROM_CLOUD: {
    type: "PULL_FROM_CLOUD",
    scope: COMMAND_SCOPES.REPAIR,
    label: "Re-download data from the cloud",
    ownerSummary: "Support refreshed this device's data from your cloud backup.",
    reloadsApp: false,
  },
  CLEAR_LOCAL_CACHE: {
    type: "CLEAR_LOCAL_CACHE",
    scope: COMMAND_SCOPES.REPAIR,
    label: "Clear the in-memory cache",
    ownerSummary: "Support cleared this device's temporary cache. No saved data was removed.",
    reloadsApp: false,
  },
  REFRESH_APP: {
    type: "REFRESH_APP",
    scope: COMMAND_SCOPES.REPAIR,
    label: "Update to the latest app version",
    ownerSummary: "Support updated this device to the newest version of the app.",
    reloadsApp: true,
  },
});

export const COMMAND_TYPES = Object.freeze(Object.keys(COMMAND_CATALOG));

export function getCommandDefinition(type) {
  if (typeof type !== "string") return null;
  return Object.prototype.hasOwnProperty.call(COMMAND_CATALOG, type) ? COMMAND_CATALOG[type] : null;
}

export function isKnownCommand(type) {
  return getCommandDefinition(type) !== null;
}

/**
 * A "diagnose" session may only run diagnose-scoped commands; a "repair" session
 * may run both. Scope is checked against the session the operator actually holds,
 * not against anything they send us.
 */
export function sessionAllowsCommand(sessionScope, type) {
  const definition = getCommandDefinition(type);
  if (!definition) return false;
  if (definition.scope === COMMAND_SCOPES.DIAGNOSE) return true;
  return sessionScope === COMMAND_SCOPES.REPAIR;
}
