import * as svc from "./remoteSupport.service.js";
import * as playbooks from "./playbooks.service.js";
import { COMMAND_CATALOG, COMMAND_SCOPES } from "./commands.catalog.js";
import { PLAYBOOKS } from "./playbooks.catalog.js";
import { createAuditLog } from "../audit/audit.service.js";
import { generateIncidentReport } from "../diagnostics/incident-report.service.js";
import { listErrorGroups, listSupportRequests } from "../diagnostics/diagnostics.service.js";
import { listLatestHealthPerDevice } from "../devices/deviceHealth.service.js";
import { getSyncDiagnostics } from "../sync/sync-diagnostics.service.js";
import { EVENT_TOPICS, publishEvent } from "../../lib/eventBus.js";
import db from "../../db.js";

function headerDeviceId(req) {
  const raw = req.headers["x-device-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveDeviceId(req) {
  return req.user?.deviceId ?? headerDeviceId(req);
}

// ─────────────────────────────────────────────
// Owner surface — /api/support
// ─────────────────────────────────────────────

export async function createSession(req, res, next) {
  try {
    const { session, code } = await svc.createSupportSession({
      shopId: req.shopId,
      userId: req.user?.userId ?? null,
      scope: req.body.scope,
      deviceId: req.body.deviceId ?? null,
      reason: req.body.reason ?? null,
      expiresInMinutes: req.body.expiresInMinutes,
    });

    // Granting remote access is exactly the kind of thing an owner must be able to
    // find later, so it lands in the same timeline as every other sensitive action.
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      module: "support",
      action: "SUPPORT_SESSION_GRANTED",
      entityType: "SupportSession",
      entityId: session.id,
      metadata: { scope: session.scope, expiresAt: session.expiresAt, deviceId: session.deviceId },
      req,
    });

    res.status(201).json({
      success: true,
      message: "Share this code with support. It expires automatically.",
      data: { ...session, code },
    });
  } catch (err) {
    next(err);
  }
}

export async function getState(req, res, next) {
  try {
    const [state, autoFix] = await Promise.all([
      svc.getShopSupportState({ shopId: req.shopId }),
      playbooks.getAutoFixSettings(req.shopId),
    ]);
    res.json({ success: true, data: { ...state, autoFix } });
  } catch (err) {
    next(err);
  }
}

export async function updateAutoFix(req, res, next) {
  try {
    const settings = await playbooks.updateAutoFixSettings(req.shopId, { enabled: req.body.enabled });

    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      module: "support",
      action: "SUPPORT_AUTOFIX_SETTING_CHANGED",
      entityType: "Shop",
      entityId: req.shopId,
      after: settings,
      req,
    });

    res.json({
      success: true,
      message: settings.enabled ? "Automatic fixes are on." : "Automatic fixes are off.",
      data: settings,
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(req, res, next) {
  try {
    const result = await svc.revokeSupportSession({
      shopId: req.shopId,
      sessionId: req.params.sessionId ?? null,
      userId: req.user?.userId ?? null,
    });

    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      module: "support",
      action: "SUPPORT_SESSION_REVOKED",
      entityType: "SupportSession",
      entityId: result.session.id,
      metadata: { cancelledCommands: result.cancelledCommands },
      req,
    });

    res.json({ success: true, message: "Remote access ended.", data: result });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// Device surface — /api/devices/commands
// ─────────────────────────────────────────────

export async function pollCommands(req, res, next) {
  try {
    const deviceId = resolveDeviceId(req);

    // Evaluate playbooks BEFORE claiming, and await it: a fix decided on this poll
    // then ships on this same poll. The device already told us it is online by
    // being here, which is the freshest signal we will ever get about it.
    // runAutoFix throttles itself per device, so the common poll costs one lookup.
    await playbooks.runAutoFix({ shopId: req.shopId, deviceId, trigger: "poll" });

    const commands = await svc.claimDeviceCommands({ shopId: req.shopId, deviceId });
    res.json({ success: true, data: { commands } });
  } catch (err) {
    next(err);
  }
}

export async function ackCommand(req, res, next) {
  try {
    const deviceId = resolveDeviceId(req);
    const command = await svc.completeDeviceCommand({
      shopId: req.shopId,
      deviceId,
      commandId: req.params.commandId,
      status: req.body.status,
      result: req.body.result ?? null,
      error: req.body.error ?? null,
    });

    // The owner's audit trail records what was done to their device, by whom, and
    // whether it worked — the operator does not get to write this entry themselves.
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      deviceId,
      module: "support",
      action: "SUPPORT_COMMAND_EXECUTED",
      entityType: "DeviceCommand",
      entityId: command.id,
      metadata: { type: command.type, issuedByEmail: command.issuedByEmail, summary: command.ownerSummary },
      result: command.status === "applied" ? "success" : "failure",
      req,
    });

    res.json({ success: true, data: command });
  } catch (err) {
    next(err);
  }
}

// ─────────────────────────────────────────────
// Operator surface — /api/platform-admin/support
// ─────────────────────────────────────────────

export function catalog(_req, res) {
  res.json({
    success: true,
    data: {
      commands: Object.values(COMMAND_CATALOG),
      scopes: Object.values(COMMAND_SCOPES),
      playbooks: PLAYBOOKS.map(({ id, title, command, tier }) => ({ id, title, command, tier })),
    },
  });
}

export async function redeem(req, res, next) {
  try {
    const { session, shop } = await svc.redeemSupportCode({
      code: req.body.code,
      operatorEmail: req.platformAdminEmail,
    });

    await createAuditLog({
      shopId: session.shopId,
      userId: req.user?.userId,
      module: "support",
      action: "SUPPORT_SESSION_OPENED",
      entityType: "SupportSession",
      entityId: session.id,
      metadata: { operatorEmail: req.platformAdminEmail, scope: session.scope },
      req,
    });
    await publishEvent(EVENT_TOPICS.SUPPORT_REQUESTED, session.shopId, {
      kind: "remote_session_opened",
      sessionId: session.id,
      scope: session.scope,
    });

    res.json({ success: true, data: { session, shop } });
  } catch (err) {
    next(err);
  }
}

/**
 * Everything an operator needs to understand one shop, assembled from the services
 * the shop's own screens already use — so support and the owner are always looking
 * at the same numbers, and there is no second, drifting source of truth.
 */
export async function shopDiagnostics(req, res, next) {
  try {
    const session = await svc.requireOperatorSession({
      sessionId: req.params.sessionId,
      operatorEmail: req.platformAdminEmail,
    });
    const { shopId } = session;
    const problem = typeof req.query.problem === "string" ? req.query.problem : "";

    // Which device the playbooks reason about: the session's pin, else whichever
    // device the operator is looking at, else the shop's most recently seen one.
    const focusDeviceId =
      session.deviceId ?? (typeof req.query.deviceId === "string" && req.query.deviceId.trim() ? req.query.deviceId.trim() : null);

    const [shop, incident, errors, sync, deviceHealth, supportRequests, devices, commands] = await Promise.all([
      db.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, createdAt: true } }),
      generateIncidentReport({ shopId, deviceId: session.deviceId, problemSummary: problem }).catch(() => null),
      listErrorGroups({ shopId, limit: 20 }).catch(() => []),
      getSyncDiagnostics(shopId).catch(() => null),
      listLatestHealthPerDevice({ shopId }).catch(() => []),
      listSupportRequests({ shopId, limit: 10 }).catch(() => []),
      db.device.findMany({
        where: { shopId, removedAt: null },
        select: {
          deviceId: true,
          deviceName: true,
          platform: true,
          appVersion: true,
          status: true,
          lastSeenAt: true,
          lastSyncAt: true,
        },
        orderBy: { lastSeenAt: "desc" },
        take: 25,
      }),
      svc.listSessionCommands({ sessionId: session.id }),
    ]);

    // Playbook matches for the device in focus. The operator sees the same
    // reasoning the auto-dispatcher uses — including the suggest-tier fixes it is
    // deliberately not allowed to run on its own.
    const targetDeviceId = focusDeviceId ?? devices[0]?.deviceId ?? null;
    const signals = targetDeviceId ? await playbooks.collectSignals({ shopId, deviceId: targetDeviceId }) : null;
    const suggestions = signals ? playbooks.evaluatePlaybooks(signals) : [];
    const autoFix = await playbooks.getAutoFixSettings(shopId);

    res.json({
      success: true,
      data: {
        session: svc.presentSession(session),
        shop,
        incident,
        errors,
        sync,
        deviceHealth,
        supportRequests,
        devices,
        commands,
        suggestions,
        autoFix,
        focusDeviceId: targetDeviceId,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function dispatch(req, res, next) {
  try {
    const session = await svc.requireOperatorSession({
      sessionId: req.body.sessionId,
      operatorEmail: req.platformAdminEmail,
    });

    const command = await svc.queueDeviceCommand({
      session,
      type: req.body.type,
      params: { ...(req.body.params ?? {}), ...(req.body.deviceId ? { deviceId: req.body.deviceId } : {}) },
      reason: req.body.reason ?? null,
      issuedByUserId: req.user?.userId ?? null,
    });

    await createAuditLog({
      shopId: session.shopId,
      userId: req.user?.userId,
      deviceId: command.deviceId,
      module: "support",
      action: "SUPPORT_COMMAND_ISSUED",
      entityType: "DeviceCommand",
      entityId: command.id,
      metadata: { type: command.type, operatorEmail: req.platformAdminEmail, reason: command.reason },
      req,
    });

    res.status(201).json({ success: true, data: command });
  } catch (err) {
    next(err);
  }
}

export async function endSession(req, res, next) {
  try {
    const session = await svc.endSupportSession({
      sessionId: req.params.sessionId,
      operatorEmail: req.platformAdminEmail,
    });

    await createAuditLog({
      shopId: session.shopId,
      userId: req.user?.userId,
      module: "support",
      action: "SUPPORT_SESSION_CLOSED",
      entityType: "SupportSession",
      entityId: session.id,
      metadata: { operatorEmail: req.platformAdminEmail, commandCount: session.commandCount },
      req,
    });

    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
}
