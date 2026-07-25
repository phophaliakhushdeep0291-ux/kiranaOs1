import db from "../../db.js";

// Health snapshots are a bounded time-series; the current health of a device is
// its latest row. We prune older rows opportunistically so no worker is required
// for Phase 2 (a proper rollup job can replace this later).
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const PRINTER_STATUSES = new Set(["ready", "offline", "error", "not_configured"]);
const SCANNER_STATUSES = new Set(["connected", "disconnected", "not_configured"]);
const DB_STATUSES = new Set(["ok", "degraded", "error"]);

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeStatus(value, allowed) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function clampInt(value, min, max) {
  const n = num(value);
  if (n === null) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * computeHealth — derive an overall status + 0-100 score from the raw signals so
 * the device view, the admin dashboard, and the store health score all share one
 * authoritative computation. Returns the reasons behind any deductions too.
 */
export function computeHealth(h = {}) {
  let score = 100;
  const reasons = [];
  const drop = (points, reason) => { score -= points; reasons.push(reason); };

  if (h.online === false) drop(15, "offline");
  if (h.printerStatus === "error") drop(20, "printer_error");
  else if (h.printerStatus === "offline") drop(15, "printer_offline");
  if (h.dbStatus === "error") drop(30, "db_error");
  else if (h.dbStatus === "degraded") drop(10, "db_degraded");

  const used = num(h.storageUsedMb);
  const quota = num(h.storageQuotaMb);
  if (used !== null && quota !== null && quota > 0) {
    const freePct = 100 * (1 - used / quota);
    if (freePct < 5) drop(20, "storage_critical");
    else if (freePct < 15) drop(10, "storage_low");
  }

  const battery = num(h.batteryLevel);
  if (battery !== null && h.batteryCharging === false) {
    if (battery <= 10) drop(10, "battery_critical");
    else if (battery <= 20) drop(5, "battery_low");
  }

  const ramUsed = num(h.ramUsedMb);
  const ramLimit = num(h.ramLimitMb);
  if (ramUsed !== null && ramLimit !== null && ramLimit > 0 && (100 * ramUsed) / ramLimit >= 92) {
    drop(10, "ram_high");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const overallStatus = score >= 80 ? "healthy" : score >= 50 ? "degraded" : "critical";
  return { healthScore: score, overallStatus, reasons };
}

function serializeExtra(extra, reasons) {
  try {
    const payload = { reasons };
    if (extra && typeof extra === "object") payload.extra = extra;
    const json = JSON.stringify(payload);
    return json.length > 8192 ? JSON.stringify({ reasons }) : json;
  } catch {
    return JSON.stringify({ reasons });
  }
}

/**
 * recordHealth — persist one device-health snapshot with a server-computed score.
 * MUST NOT throw into the caller: a health heartbeat can never fail a request.
 */
export async function recordHealth(input = {}, { client = db } = {}) {
  try {
    const shopId = input.shopId;
    const deviceId = input.deviceId ? String(input.deviceId).slice(0, 128) : null;
    if (!shopId || !deviceId) return null;

    const normalized = {
      online: typeof input.online === "boolean" ? input.online : null,
      printerStatus: sanitizeStatus(input.printerStatus, PRINTER_STATUSES),
      scannerStatus: sanitizeStatus(input.scannerStatus, SCANNER_STATUSES),
      dbStatus: sanitizeStatus(input.dbStatus, DB_STATUSES),
      storageUsedMb: num(input.storageUsedMb),
      storageQuotaMb: num(input.storageQuotaMb),
      batteryLevel: clampInt(input.batteryLevel, 0, 100),
      batteryCharging: typeof input.batteryCharging === "boolean" ? input.batteryCharging : null,
      ramUsedMb: num(input.ramUsedMb),
      ramLimitMb: num(input.ramLimitMb),
    };
    const { healthScore, overallStatus, reasons } = computeHealth(normalized);

    const snapshot = await client.deviceHealthSnapshot.create({
      data: {
        shopId,
        deviceId,
        userId: input.userId ?? null,
        overallStatus,
        healthScore,
        printerStatus: normalized.printerStatus,
        printerName: input.printerName ? String(input.printerName).slice(0, 200) : null,
        scannerStatus: normalized.scannerStatus,
        online: normalized.online,
        networkType: input.networkType ? String(input.networkType).slice(0, 40) : null,
        dbStatus: normalized.dbStatus,
        storageUsedMb: normalized.storageUsedMb,
        storageQuotaMb: normalized.storageQuotaMb,
        appVersion: input.appVersion ? String(input.appVersion).slice(0, 60) : null,
        os: input.os ? String(input.os).slice(0, 120) : null,
        browser: input.browser ? String(input.browser).slice(0, 200) : null,
        batteryLevel: normalized.batteryLevel,
        batteryCharging: normalized.batteryCharging,
        ramUsedMb: normalized.ramUsedMb,
        ramLimitMb: normalized.ramLimitMb,
        cpuPercent: num(input.cpuPercent),
        extraJson: serializeExtra(input.extra, reasons),
      },
      select: { id: true, overallStatus: true, healthScore: true },
    });

    // Opportunistic retention prune keeps the table bounded without a worker.
    await client.deviceHealthSnapshot
      .deleteMany({ where: { shopId, deviceId, createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } })
      .catch(() => {});

    return { id: snapshot.id, overallStatus, healthScore, reasons };
  } catch (error) {
    console.error("recordHealth failed", error?.message || error);
    return null;
  }
}

export async function getLatestHealthForDevice({ shopId, deviceId }, { client = db } = {}) {
  if (!shopId || !deviceId) return null;
  return client.deviceHealthSnapshot.findFirst({
    where: { shopId, deviceId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * listLatestHealthPerDevice — the current health of every device in the shop (one
 * row per deviceId), for the owner/admin device view and the admin dashboard.
 * Bounded by device count, not by snapshot count.
 */
export async function listLatestHealthPerDevice({ shopId }, { client = db } = {}) {
  if (!shopId) return [];
  const groups = await client.deviceHealthSnapshot.groupBy({
    by: ["deviceId"],
    where: { shopId },
    _max: { createdAt: true },
  });
  const results = [];
  for (const group of groups) {
    const snap = await client.deviceHealthSnapshot.findFirst({
      where: { shopId, deviceId: group.deviceId, createdAt: group._max.createdAt ?? undefined },
      orderBy: { createdAt: "desc" },
    });
    if (snap) results.push(snap);
  }
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return results;
}
