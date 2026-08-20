import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { COMMAND_SCOPES } from "./commands.catalog.js";
import { SETTING_INPUTS, SETTING_KEYS, getSettingRepair } from "./settings.catalog.js";
import { queueAutomaticCommand } from "./remoteSupport.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { EVENT_TOPICS, publishEvent } from "../../lib/eventBus.js";

// Applying a setting on a shop's behalf, from a desk, without going there.
//
// This is the only remote-support path that changes the shop's own data, so it
// carries three gates the device commands do not need:
//
//   1. The session must be REPAIR scope. "Let them look only" means exactly that.
//   2. The key must be in the catalog. There is no path-based setter to abuse.
//   3. The before value is captured and audited. A settings change nobody can
//      point at afterwards is indistinguishable from data loss.
//
// A device that is online is nudged to pull afterwards, so the shop is unblocked
// now rather than at whatever point its next sync happens to land.

const DEVICE_NUDGE_WINDOW_MS = 15 * 60 * 1000;
const MAX_DEVICE_NUDGES = 5;

async function writeRequiredSettingRepairAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Setting repair was not saved because its audit record could not be stored",
      503,
      "SETTING_REPAIR_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

/** Every repairable setting with its current value, for the operator's screen. */
export async function readRepairableSettings({ shopId, locationId = null }) {
  const entries = await Promise.all(
    SETTING_KEYS.map(async (key) => {
      const repair = getSettingRepair(key);
      let current = { value: null, context: null };
      try {
        current = await repair.read({ shopId, locationId });
      } catch {
        // A reader that fails must not blank the whole screen; the operator still
        // needs to see the other settings and the labels.
        current = { value: null, context: null, unavailable: true };
      }
      return {
        key,
        label: repair.label,
        description: repair.description,
        input: repair.input,
        needsLocation: repair.needsLocation,
        currentValue: current.value,
        context: current.context ?? null,
        unavailable: current.unavailable ?? false,
      };
    }),
  );
  return entries;
}

/**
 * Nudge whatever is online to pull the change. Best-effort by design: settings
 * propagate on the next scheduled pull regardless, so a failure here delays the
 * fix by a sync interval rather than losing it.
 */
async function nudgeActiveDevices({ shopId, reason }) {
  const devices = await db.device
    .findMany({
      where: { shopId, removedAt: null, status: "active", lastSeenAt: { gt: new Date(Date.now() - DEVICE_NUDGE_WINDOW_MS) } },
      select: { deviceId: true },
      orderBy: { lastSeenAt: "desc" },
      take: MAX_DEVICE_NUDGES,
    })
    .catch(() => []);

  const nudged = [];
  for (const device of devices) {
    const command = await queueAutomaticCommand({
      shopId,
      deviceId: device.deviceId,
      type: "RUN_SYNC_NOW",
      playbookId: "settings-repair-nudge",
      reason,
      params: { ownerSummary: "This device synced to pick up a setting support corrected." },
    }).catch(() => null);
    if (command) nudged.push(device.deviceId);
  }
  return nudged;
}

/**
 * Apply one catalog repair inside a live, consented, repair-scope session.
 *
 * `session` is the row returned by requireOperatorSession — already re-validated
 * for this request. shopId is taken from it, never from the caller.
 */
export async function applySettingRepair({ session, key, value = null, locationId = null, reason = null, userId = null, req = null }) {
  const repair = getSettingRepair(key);
  if (!repair) {
    throw new AppError(`"${key}" is not a repairable setting.`, 400, "SETTING_NOT_ALLOWED");
  }

  if (session.scope !== COMMAND_SCOPES.REPAIR) {
    throw new AppError(
      "This session can only read diagnostics. Ask the owner for a repair session to change a setting.",
      403,
      "SETTING_SCOPE_DENIED",
    );
  }

  if (repair.input === SETTING_INPUTS.NONE && value != null && String(value).trim() !== "") {
    throw new AppError(`"${key}" is a reset and takes no value.`, 400, "SETTING_VALUE_UNEXPECTED");
  }
  if (repair.input !== SETTING_INPUTS.NONE && (value == null || String(value).trim() === "")) {
    throw new AppError(`"${key}" needs a value.`, 400, "SETTING_VALUE_REQUIRED");
  }

  const { shopId } = session;
  const result = await db.$transaction(async (tx) => {
    const applied = await repair.apply({ shopId, locationId, value, client: tx });

    // The setting write and its before/after record are one operation. If either
    // cannot be stored, neither is allowed to commit.
    await writeRequiredSettingRepairAudit({
      shopId,
      userId,
      module: "settings",
      action: "SUPPORT_SETTING_REPAIRED",
      entityType: "ShopSetting",
      entityId: key,
      before: applied.before,
      after: applied.after,
      metadata: {
        key,
        operatorEmail: session.operatorEmail,
        sessionId: session.id,
        reason: reason ? String(reason).slice(0, 500) : null,
        target: applied.target ?? null,
      },
      req,
    }, tx);
    return applied;
  });

  await publishEvent(EVENT_TOPICS.SUPPORT_REQUESTED, shopId, {
    kind: "setting_repaired",
    key,
    sessionId: session.id,
  }).catch(() => null);

  const nudgedDevices = await nudgeActiveDevices({
    shopId,
    reason: `Setting repaired: ${repair.label}`,
  });

  return {
    key,
    label: repair.label,
    before: result.before,
    after: result.after,
    target: result.target ?? null,
    nudgedDevices,
    appliedAt: new Date().toISOString(),
  };
}

/**
 * What support has changed about this shop's settings — read from the audit log,
 * which already stores before/after, rather than a second table that could
 * disagree with it.
 */
export async function listSettingRepairs({ shopId, limit = 20 }) {
  const rows = await db.auditLog
    .findMany({
      where: { shopId, action: "SUPPORT_SETTING_REPAIRED" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, entityId: true, beforeJson: true, afterJson: true, metadataJson: true, createdAt: true },
    })
    .catch(() => []);

  return rows.map((row) => {
    let metadata = {};
    try {
      metadata = JSON.parse(row.metadataJson ?? "{}") ?? {};
    } catch {
      metadata = {};
    }
    const repair = getSettingRepair(row.entityId);
    return {
      id: row.id,
      key: row.entityId,
      label: repair?.label ?? row.entityId,
      operatorEmail: metadata.operatorEmail ?? null,
      reason: metadata.reason ?? null,
      before: row.beforeJson,
      after: row.afterJson,
      createdAt: row.createdAt,
    };
  });
}
