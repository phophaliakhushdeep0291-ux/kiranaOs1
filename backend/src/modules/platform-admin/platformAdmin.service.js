import db from "../../db.js";
import { env } from "../../config/env.js";
import { getRedisStatus } from "../../lib/redis.js";

// Cross-tenant fleet rollup for the internal admin dashboard (Diagnostics §10).
// This is the ONLY place that reads across shops, and it is reachable only behind
// requirePlatformAdmin. Aggregations are ordered/sliced in JS to stay portable
// across Prisma's groupBy ordering quirks.

const ONLINE_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function truncate(value, max) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function safeRedisStatus() {
  try {
    return getRedisStatus();
  } catch {
    return { connected: false };
  }
}

export async function getPlatformOverview() {
  const now = Date.now();
  const onlineCutoff = new Date(now - ONLINE_WINDOW_MS);
  const dayCutoff = new Date(now - DAY_MS);
  const weekCutoff = new Date(now - 7 * DAY_MS);

  const [
    totalShops,
    totalDevices,
    activeDevices,
    onlineShopRows,
    recentCrashes24h,
    failedSyncEvents,
    openConflicts,
    openSupportRequests,
    topErrorGroups,
    endpointGroups,
    appVersionGroups,
    recentSupport,
    healthGroups,
  ] = await Promise.all([
    db.shop.count(),
    db.device.count(),
    db.device.count({ where: { status: "active" } }),
    db.device.findMany({ where: { lastSeenAt: { gt: onlineCutoff } }, select: { shopId: true }, distinct: ["shopId"] }),
    db.errorEvent.count({ where: { createdAt: { gt: dayCutoff } } }),
    db.offlineSyncEvent.count({ where: { status: "failed" } }),
    db.syncConflict.count({ where: { status: "open" } }),
    db.supportRequest.count({ where: { status: "open" } }),
    db.errorGroup.findMany({
      orderBy: { count: "desc" },
      take: 10,
      select: { id: true, title: true, source: true, count: true, status: true, errorCode: true, shopId: true, lastSeenAt: true },
    }),
    db.errorEvent.groupBy({ by: ["endpoint"], where: { endpoint: { not: null }, createdAt: { gt: weekCutoff } }, _count: true }),
    db.device.groupBy({ by: ["appVersion"], _count: true }),
    db.supportRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, shopId: true, description: true, page: true, status: true, appVersion: true, createdAt: true },
    }),
    db.deviceHealthSnapshot.groupBy({ by: ["shopId"], where: { createdAt: { gt: dayCutoff } }, _min: { healthScore: true } }),
  ]);

  const onlineShops = onlineShopRows.length;

  const failedEndpoints = endpointGroups
    .map((g) => ({ endpoint: g.endpoint, count: g._count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const appVersions = appVersionGroups
    .map((g) => ({ appVersion: g.appVersion ?? "unknown", count: g._count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const worstHealthStores = healthGroups
    .map((g) => ({ shopId: g.shopId, minHealthScore: g._min?.healthScore ?? null }))
    .filter((s) => typeof s.minHealthScore === "number")
    .sort((a, b) => a.minHealthScore - b.minHealthScore)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    shops: {
      total: totalShops,
      online: onlineShops,
      offline: Math.max(0, totalShops - onlineShops),
    },
    devices: {
      total: totalDevices,
      active: activeDevices,
    },
    incidents: {
      recentCrashes24h,
      failedSyncEvents,
      openConflicts,
      openSupportRequests,
    },
    topErrors: topErrorGroups.map((g) => ({
      id: g.id,
      title: g.title,
      source: g.source,
      count: g.count,
      status: g.status,
      errorCode: g.errorCode,
      shopId: g.shopId,
      lastSeenAt: g.lastSeenAt,
    })),
    failedEndpoints,
    appVersions,
    recentSupportRequests: recentSupport.map((s) => ({
      id: s.id,
      shopId: s.shopId,
      description: truncate(s.description, 140),
      page: s.page,
      status: s.status,
      appVersion: s.appVersion,
      createdAt: s.createdAt,
    })),
    worstHealthStores,
    queue: {
      enabled: Boolean(env.QUEUES_ENABLED),
      redis: safeRedisStatus(),
    },
  };
}
