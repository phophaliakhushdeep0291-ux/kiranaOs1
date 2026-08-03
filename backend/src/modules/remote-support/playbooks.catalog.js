// Known problem → known fix.
//
// Everything above this file is a channel: it can carry a repair to a device but
// has no opinion about which repair. This is the opinion. Each playbook is a pure
// match over signals the server already collects, plus the one catalog command
// that fixes it — so support stops re-diagnosing the same five problems by hand.
//
// TIERS decide who is allowed to pull the trigger:
//   auto    — idempotent, non-disruptive, and identical to a button the owner
//             could safely tap mid-sale. Dispatched with no human involved.
//   suggest — correct, but disruptive or heavy (reloads the page, re-downloads
//             everything). Surfaced to an operator, never fired automatically.
//
// The line between them is not "how confident are we" — it is "what does the
// shopkeeper lose if we are wrong". A needless retry costs nothing. A needless
// reload can drop a half-built bill in front of a waiting customer.

export const PLAYBOOK_TIERS = Object.freeze({
  AUTO: "auto",
  SUGGEST: "suggest",
});

// A device that just ran a fix needs time to show whether it worked. Re-firing
// inside that window is how an auto-fixer turns into a loop.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Symptoms of a stale deploy: this tab's cached index.html points at chunk files
// the new build renamed. The route is already broken when this appears.
const STALE_DEPLOY_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
  /unexpected token '<'/i,
];

function matchedStaleDeployError(errors = []) {
  return errors.find((error) => {
    const haystack = `${error.title ?? ""} ${error.errorCode ?? ""}`;
    return STALE_DEPLOY_PATTERNS.some((pattern) => pattern.test(haystack));
  });
}

function minutesSince(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? (Date.now() - time) / MINUTE : Number.POSITIVE_INFINITY;
}

/**
 * Each `match` receives the signal bundle from playbooks.service and returns
 * either null (no match) or { confidence, evidence, ownerSummary }.
 *
 * `evidence` is what the owner and the operator are shown as the reason. A fix
 * nobody can explain afterwards is not one we should be running unattended.
 */
export const PLAYBOOKS = Object.freeze([
  {
    id: "retry-stuck-sync",
    title: "Retry sync entries that failed but can succeed",
    command: "RETRY_FAILED_SYNC",
    tier: PLAYBOOK_TIERS.AUTO,
    cooldownMs: 15 * MINUTE,
    match({ sync }) {
      if (!sync) return null;
      const retryable = (sync.recentFailures ?? []).filter((failure) => failure.retryable !== false);
      if (retryable.length === 0) return null;

      return {
        confidence: retryable.length >= 3 ? 0.9 : 0.75,
        ownerSummary: `${retryable.length} ${retryable.length === 1 ? "entry" : "entries"} had failed to sync and were retried automatically.`,
        evidence: {
          retryableFailures: retryable.length,
          failedTotal: sync.counts?.failed ?? 0,
          example: retryable[0]?.explanation ?? null,
        },
      };
    },
  },

  {
    id: "device-not-syncing",
    title: "Nudge a device that is online but has stopped syncing",
    command: "RUN_SYNC_NOW",
    tier: PLAYBOOK_TIERS.AUTO,
    cooldownMs: 30 * MINUTE,
    match({ device, sync }) {
      if (!device) return null;
      // Online right now (it is polling us) but has not completed a sync in hours,
      // while the shop has work waiting. That gap is the whole symptom.
      const sinceSync = minutesSince(device.lastSyncAt);
      if (sinceSync < 120) return null;

      const waiting = (sync?.counts?.pending ?? 0) + (sync?.counts?.failed ?? 0);
      if (waiting === 0) return null;

      return {
        confidence: 0.7,
        ownerSummary: "This device had not synced for a while, so a sync was started automatically.",
        evidence: {
          hoursSinceLastSync: Math.round(sinceSync / 60),
          waitingEntries: waiting,
        },
      };
    },
  },

  {
    id: "refresh-stale-diagnostics",
    title: "Collect a fresh health snapshot when ours has gone stale",
    command: "COLLECT_DIAGNOSTICS",
    tier: PLAYBOOK_TIERS.AUTO,
    cooldownMs: 12 * HOUR,
    match({ health }) {
      // Read-only: this one exists so the OTHER playbooks have current signals to
      // match on. A support system that only learns during an incident is blind
      // exactly when it matters.
      const ageMinutes = minutesSince(health?.createdAt);
      if (ageMinutes < 12 * 60) return null;

      return {
        confidence: 0.6,
        ownerSummary: "This device sent updated health details so support can see its current state.",
        evidence: { snapshotAgeHours: Number.isFinite(ageMinutes) ? Math.round(ageMinutes / 60) : null },
      };
    },
  },

  {
    id: "stale-deploy-chunk-error",
    title: "Update a device stuck on an old build",
    command: "REFRESH_APP",
    // Suggest, not auto: the fix is a page reload, and a reload in the middle of
    // a sale is a worse outcome than the broken route it repairs. A human decides.
    tier: PLAYBOOK_TIERS.SUGGEST,
    cooldownMs: 2 * HOUR,
    match({ errors }) {
      const hit = matchedStaleDeployError(errors);
      if (!hit) return null;

      return {
        confidence: 0.85,
        ownerSummary: "This device was running an old copy of the app and was updated.",
        evidence: { errorTitle: hit.title, occurrences: hit.count, lastSeenAt: hit.lastSeenAt },
      };
    },
  },

  {
    id: "stale-app-version",
    title: "Update a device left behind by the rest of the shop",
    command: "REFRESH_APP",
    tier: PLAYBOOK_TIERS.SUGGEST,
    cooldownMs: 6 * HOUR,
    match({ device, fleet }) {
      if (!device?.appVersion || !fleet?.latestAppVersion) return null;
      if (device.appVersion === fleet.latestAppVersion) return null;

      return {
        confidence: 0.65,
        ownerSummary: "This device was updated to the same app version as the rest of the shop.",
        evidence: { deviceVersion: device.appVersion, latestVersion: fleet.latestAppVersion },
      };
    },
  },

  {
    id: "local-database-degraded",
    title: "Re-download data for a device whose local database is unhealthy",
    command: "PULL_FROM_CLOUD",
    // Heavy, and re-pulling onto a sick database deserves a decision, not a reflex.
    tier: PLAYBOOK_TIERS.SUGGEST,
    cooldownMs: 6 * HOUR,
    match({ health }) {
      const status = health?.dbStatus;
      if (status !== "error" && status !== "degraded") return null;

      return {
        confidence: status === "error" ? 0.8 : 0.6,
        ownerSummary: "This device's local data was refreshed from your cloud backup.",
        evidence: { dbStatus: status, healthScore: health?.healthScore ?? null },
      };
    },
  },
]);

export const PLAYBOOKS_BY_ID = Object.freeze(
  Object.fromEntries(PLAYBOOKS.map((playbook) => [playbook.id, playbook])),
);

export function getPlaybook(id) {
  return Object.prototype.hasOwnProperty.call(PLAYBOOKS_BY_ID, id) ? PLAYBOOKS_BY_ID[id] : null;
}
