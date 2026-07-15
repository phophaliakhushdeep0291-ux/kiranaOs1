import { env } from "../../config/env.js";
import * as svc from "./sync.service.js";
import { incrementMetric } from "../../lib/metrics.js";
import { getEffectivePlan, isSubscriptionActive } from "../subscription/subscription.service.js";
import { markDeviceSynced } from "../devices/devices.service.js";

// ── Sync logger ───────────────────────────────────────────────────────────────
// Follows the same pattern as the global requestLogger in security.js:
//   console.log(JSON.stringify({ type, level, time, requestId, ... }))
// Only metadata is logged — never payloads, PINs, customer details, or JWTs.
//
// LOG_LEVEL=silent suppresses these logs (same gate as requestLogger).
// LOG_LEVEL=error   suppresses info-level sync logs.

function shouldSyncLog() {
  return env.LOG_LEVEL !== "silent" && env.LOG_LEVEL !== "error";
}

function writeSyncLog(level, payload) {
  const entry = JSON.stringify({ level, time: new Date().toISOString(), ...payload });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}


function buildStatusPayload(req, effectivePlan, serverSeq) {
  const features = Array.isArray(effectivePlan.features) ? effectivePlan.features : [];
  const subscriptionActive = isSubscriptionActive(effectivePlan.subscription);
  const featureAllowed = features.includes("cloud_backup") || features.includes("auto_two_way_sync");
  const allowed = Boolean(subscriptionActive && featureAllowed);
  const serverTime = new Date().toISOString();

  return {
    online: true,
    allowed,
    serverTime,
    server_version: serverSeq,
    cursor: serverSeq,
    shopId: req.shopId,
    deviceId: req.device?.deviceId ?? null,
    planCode: effectivePlan.planCode,
    subscriptionStatus: effectivePlan.subscription?.status ?? null,
    cloudBackupAllowed: features.includes("cloud_backup"),
    autoTwoWaySyncAllowed: features.includes("auto_two_way_sync"),
    reason: allowed
      ? null
      : !subscriptionActive
        ? "subscription_inactive"
        : "sync_feature_not_included",
  };
}

export async function status(req, res, next) {
  try {
    const effectivePlan = await getEffectivePlan(req.shopId);
    const serverSeq = await svc.getCurrentServerSeq(req.shopId);
    res.json({ success: true, data: buildStatusPayload(req, effectivePlan, serverSeq) });
  } catch (err) { next(err); }
}

export async function retry(req, res, next) {
  try {
    const effectivePlan = await getEffectivePlan(req.shopId);
    const payload = buildStatusPayload(req, effectivePlan, await svc.getCurrentServerSeq(req.shopId));
    res.json({
      success: true,
      data: {
        ...payload,
        retryAccepted: true,
        opIds: Array.isArray(req.body?.op_ids) ? req.body.op_ids : [],
        message: "Retry acknowledged. Frontend local outbox remains the source of truth for pending operations.",
      },
    });
  } catch (err) { next(err); }
}

export async function ack(req, res, next) {
  try {
    const acknowledgement = await svc.acknowledgeDeviceSequence(
      req.shopId,
      req.device?.deviceId,
      req.body.server_seq
    );
    res.json({ success: true, data: { acknowledgement } });
  } catch (err) { next(err); }
}

export async function devices(req, res, next) {
  try {
    const data = await svc.getDeviceSyncFleet(req.shopId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function resolveConflict(req, res, next) {
  try {
    const conflict = await svc.resolveSyncConflict(req.shopId, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.device?.deviceId ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.get?.("user-agent") ?? null,
    });
    res.json({
      success: true,
      data: {
        resolutionRecorded: true,
        conflict,
        message: "Conflict decision stored in the server audit ledger for every device.",
      },
    });
  } catch (err) { next(err); }
}

export async function listConflicts(req, res, next) {
  try {
    const data = await svc.listSyncConflicts(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function reportConflict(req, res, next) {
  try {
    const conflict = await svc.reportSyncConflict(req.shopId, req.body, {
      userId: req.user?.userId ?? null,
      deviceId: req.device?.deviceId ?? null,
    });
    // Reporting is an idempotent upsert: a repeated clientConflictId updates the
    // same ledger row, so 200 is accurate for both first and subsequent reports.
    res.json({ success: true, data: { conflict } });
  } catch (err) { next(err); }
}

export async function pull(req, res, next) {
  const startedAt = Date.now();
  try {
    const { since, cursor, limit, afterSeq } = req.query;
    const { cursors } = req.query;
    // Legacy contract kept for old tests/clients: pullSince(req.shopId, since, { cursor, limit })
    // Role drives field-level redaction so a cashier device never receives cost/profit data.
    const data = await svc.pullSince(req.shopId, since, { cursor, limit, cursors, role: req.user?.role, afterSeq });
    await markDeviceSynced(req.shopId, req.device?.deviceId);
    incrementMetric("sync_pull_total", { status: "success" });

    if (shouldSyncLog()) {
      writeSyncLog("info", {
        type: "sync_pull",
        requestId:     req.requestId,
        shopId:        req.shopId,
        userId:        req.user?.userId ?? null,
        since,
        cursorPresent: Boolean(cursor),
        entityCursorPresent: Boolean(cursors),
        afterSeqPresent: Boolean(afterSeq),
        limit:         data.sync?.limit ?? limit,
        returnedCount: data.sync?.returnedCount ?? null,
        hasMore:       data.sync?.hasMore ?? false,
        durationMs:    Date.now() - startedAt,
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    incrementMetric("sync_pull_total", { status: "error" });
    writeSyncLog("error", {
      type:       "sync_pull_error",
      requestId:  req.requestId,
      shopId:     req.shopId,
      userId:     req.user?.userId ?? null,
      durationMs: Date.now() - startedAt,
      errorName:  err?.name ?? "Error",
      errorCode:  err?.code ?? null,
      errorMessage: err?.message ?? "Unknown error",
    });
    next(err);
  }
}

export async function push(req, res, next) {
  const startedAt = Date.now();
  const batchSize = (req.body?.events ?? []).length;
  try {
    const data = await svc.pushOfflineActions(req.shopId, req.body.events ?? [], { ...req.user, deviceId: req.device?.deviceId ?? null });
    await markDeviceSynced(req.shopId, req.device?.deviceId);
    incrementMetric("sync_push_total", { status: "success" });

    if (shouldSyncLog()) {
      writeSyncLog("info", {
        type:       "sync_push",
        requestId:  req.requestId,
        shopId:     req.shopId,
        userId:     req.user?.userId ?? null,
        batchSize,
        durationMs: Date.now() - startedAt,
        received:   data.summary?.received  ?? data.received,
        synced:     data.summary?.synced    ?? null,
        duplicates: data.summary?.duplicates ?? null,
        failed:     data.summary?.failed    ?? data.failed,
        conflicts:  data.summary?.conflicts  ?? null,
        retryable:  data.summary?.retryable  ?? null,
      });
    }

    // `results` is also exposed at the top level so the Step 7 frontend helper can
    // consume it without waiting for frontend changes.
    // `summary` and `serverTime` are new additive top-level aliases for convenience.
    res.json({
      success: true,
      data,
      results: data.results,
      summary: data.summary,
      idMappings: data.idMappings,
      serverTime: data.serverTime,
    });
  } catch (err) {
    incrementMetric("sync_push_total", { status: "error" });
    writeSyncLog("error", {
      type:       "sync_push_error",
      requestId:  req.requestId,
      shopId:     req.shopId,
      userId:     req.user?.userId ?? null,
      batchSize,
      durationMs: Date.now() - startedAt,
      errorName:  err?.name ?? "Error",
      errorCode:  err?.code ?? null,
      errorMessage: err?.message ?? "Unknown error",
    });
    next(err);
  }
}
