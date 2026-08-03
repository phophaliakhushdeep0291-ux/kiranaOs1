import db from "../../db.js";
import { PLAYBOOKS, PLAYBOOK_TIERS, getPlaybook } from "./playbooks.catalog.js";
import { queueAutomaticCommand } from "./remoteSupport.service.js";
import { COMMAND_STATUS } from "./commands.catalog.js";
import { getSyncDiagnostics } from "../sync/sync-diagnostics.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { EVENT_TOPICS, publishEvent } from "../../lib/eventBus.js";

// Auto-dispatch: match a shop's live signals against the playbook catalog and run
// the safe fixes without waiting for a human.
//
// Most of this file is restraint rather than capability. Deciding to run a fix is
// three lines; the rest is making sure it cannot run twice, cannot run forever,
// cannot run on a shop that opted out, and cannot run so often that a fleet of
// tills melts the database. An auto-fixer without those is an outage generator.

const MINUTE = 60 * 1000;

// How often a single device's signals are re-evaluated. Devices poll on their sync
// timer — without this, every poll from every till in the fleet would run the full
// signal query set. The per-playbook cooldowns below are the correctness guard;
// this one is purely load.
const EVALUATION_THROTTLE_MS = 5 * MINUTE;
const evaluatedAt = new Map();

// If a playbook's last few attempts on a device all failed, the fix is not working
// and repeating it is noise at best. Stop and let a human look.
const FAILURE_STREAK_LIMIT = 3;

export const DEFAULT_AUTO_FIX_SETTINGS = Object.freeze({ enabled: true });

function parseSettings(settingsJson) {
  try {
    return JSON.parse(settingsJson ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export async function getAutoFixSettings(shopId) {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  const parsed = parseSettings(shop?.settingsJson);
  return { ...DEFAULT_AUTO_FIX_SETTINGS, ...(parsed.autoFix ?? {}) };
}

export async function updateAutoFixSettings(shopId, patch) {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  const parsed = parseSettings(shop?.settingsJson);
  const next = { ...DEFAULT_AUTO_FIX_SETTINGS, ...(parsed.autoFix ?? {}), ...patch };
  parsed.autoFix = next;
  await db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(parsed) } });
  return next;
}

/**
 * Everything the catalog matches on, read from the services that already own each
 * answer. Nothing here computes a number a shop screen would disagree with.
 */
export async function collectSignals({ shopId, deviceId = null }) {
  const [sync, device, health, fleetDevices, errors] = await Promise.all([
    getSyncDiagnostics(shopId).catch(() => null),
    deviceId
      ? db.device
          .findFirst({
            where: { shopId, deviceId },
            select: { deviceId: true, appVersion: true, lastSeenAt: true, lastSyncAt: true, status: true },
          })
          .catch(() => null)
      : null,
    deviceId
      ? db.deviceHealthSnapshot
          .findFirst({
            where: { shopId, deviceId },
            orderBy: { createdAt: "desc" },
            select: { dbStatus: true, healthScore: true, overallStatus: true, appVersion: true, createdAt: true },
          })
          .catch(() => null)
      : null,
    db.device
      .findMany({
        where: { shopId, removedAt: null },
        select: { appVersion: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
        take: 25,
      })
      .catch(() => []),
    db.errorGroup
      .findMany({
        where: { shopId, status: "open", lastSeenAt: { gt: new Date(Date.now() - 24 * 60 * MINUTE) } },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
        select: { id: true, title: true, errorCode: true, count: true, lastSeenAt: true },
      })
      .catch(() => []),
  ]);

  // "Latest version this shop is running" — comparing a till against its own
  // siblings needs no release feed and no guess about what we deployed.
  const latestAppVersion = fleetDevices.find((row) => row.appVersion)?.appVersion ?? null;

  return { shopId, deviceId, sync, device, health, errors, fleet: { latestAppVersion } };
}

/** Pure: run every playbook's matcher over one signal bundle. */
export function evaluatePlaybooks(signals) {
  const matches = [];
  for (const playbook of PLAYBOOKS) {
    let result = null;
    try {
      result = playbook.match(signals);
    } catch {
      // A matcher that throws must not take the evaluation down with it.
      result = null;
    }
    if (!result) continue;

    matches.push({
      playbookId: playbook.id,
      title: playbook.title,
      command: playbook.command,
      tier: playbook.tier,
      confidence: result.confidence ?? 0.5,
      ownerSummary: result.ownerSummary ?? null,
      evidence: result.evidence ?? {},
    });
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Has this playbook already acted on this device recently, or has it been failing?
 * Both answers come from the command rows themselves — the history IS the state,
 * so there is no separate counter to drift out of sync with what actually ran.
 */
async function dispatchBlockedReason({ shopId, deviceId, playbook }) {
  const recent = await db.deviceCommand.findMany({
    where: { shopId, deviceId, playbookId: playbook.id },
    orderBy: { createdAt: "desc" },
    take: FAILURE_STREAK_LIMIT,
    select: { status: true, createdAt: true },
  });

  if (recent.length === 0) return null;

  if (Date.now() - new Date(recent[0].createdAt).getTime() < playbook.cooldownMs) {
    return "cooldown";
  }

  const terminal = recent.filter((row) => row.status !== COMMAND_STATUS.QUEUED && row.status !== COMMAND_STATUS.DELIVERED);
  if (
    terminal.length >= FAILURE_STREAK_LIMIT &&
    terminal.every((row) => row.status === COMMAND_STATUS.FAILED || row.status === COMMAND_STATUS.EXPIRED)
  ) {
    // The fix is not fixing it. Repeating it buys nothing and hides a real problem.
    return "failing";
  }

  return null;
}

/**
 * Evaluate one device and queue the auto-tier fixes it needs.
 *
 * Fire-and-forget from callers; it never throws. Returns what it did so tests and
 * the operator console can see the reasoning, including what it declined to do.
 */
export async function runAutoFix({ shopId, deviceId, trigger = "poll", force = false }) {
  const empty = { evaluated: false, dispatched: [], skipped: [], suggestions: [] };
  if (!shopId || !deviceId) return empty;

  try {
    const throttleKey = `${shopId}:${deviceId}`;
    const lastRun = evaluatedAt.get(throttleKey) ?? 0;
    if (!force && Date.now() - lastRun < EVALUATION_THROTTLE_MS) return empty;
    evaluatedAt.set(throttleKey, Date.now());

    const settings = await getAutoFixSettings(shopId);

    const signals = await collectSignals({ shopId, deviceId });
    const matches = evaluatePlaybooks(signals);
    if (matches.length === 0) return { ...empty, evaluated: true };

    const suggestions = matches.filter((match) => match.tier !== PLAYBOOK_TIERS.AUTO);
    const dispatched = [];
    const skipped = [];

    for (const match of matches) {
      if (match.tier !== PLAYBOOK_TIERS.AUTO) continue;

      // The opt-out is checked per dispatch, not once at the top, so turning it
      // off takes effect on the very next evaluation rather than at some boundary.
      if (settings.enabled === false) {
        skipped.push({ playbookId: match.playbookId, reason: "disabled" });
        continue;
      }

      const playbook = getPlaybook(match.playbookId);
      const blocked = await dispatchBlockedReason({ shopId, deviceId, playbook });
      if (blocked) {
        skipped.push({ playbookId: match.playbookId, reason: blocked });
        continue;
      }

      const command = await queueAutomaticCommand({
        shopId,
        deviceId,
        type: match.command,
        playbookId: match.playbookId,
        reason: match.title,
        // ownerSummary rides in params so presentCommand can show the owner the
        // specific sentence this match produced, not the command's generic one.
        params: { ownerSummary: match.ownerSummary, evidence: match.evidence, trigger },
      }).catch(() => null);

      if (!command) {
        skipped.push({ playbookId: match.playbookId, reason: "queue_failed" });
        continue;
      }

      dispatched.push({ ...match, commandId: command.id });

      // Auditing an unattended action matters more than auditing an attended one:
      // there is no human who remembers doing it.
      await createAuditLog({
        shopId,
        deviceId,
        module: "support",
        action: "SUPPORT_AUTOFIX_DISPATCHED",
        entityType: "DeviceCommand",
        entityId: command.id,
        metadata: {
          playbookId: match.playbookId,
          type: match.command,
          confidence: match.confidence,
          evidence: match.evidence,
          trigger,
        },
      }).catch(() => null);

      await publishEvent(EVENT_TOPICS.SUPPORT_REQUESTED, shopId, {
        kind: "autofix_dispatched",
        playbookId: match.playbookId,
        type: match.command,
      }).catch(() => null);
    }

    return { evaluated: true, dispatched, skipped, suggestions };
  } catch {
    // Auto-fix is an enhancement to a device's poll. If it cannot run, the poll
    // must still return the device's commands.
    return empty;
  }
}

/** Test seam: the throttle is per-process memory, and tests need a clean slate. */
export function resetAutoFixThrottle() {
  evaluatedAt.clear();
}
