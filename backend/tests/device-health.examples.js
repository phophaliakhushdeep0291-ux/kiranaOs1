import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  computeHealth,
  recordHealth,
  listLatestHealthPerDevice,
  getLatestHealthForDevice,
} from "../src/modules/devices/deviceHealth.service.js";

// Proves device health monitoring (Diagnostics §4): server-computed health score,
// latest-per-device "current health", and tenant isolation.

// 1) Health score is derived from the raw signals with explainable reasons.
const healthy = computeHealth({ online: true, printerStatus: "ready", dbStatus: "ok", storageUsedMb: 100, storageQuotaMb: 1000, batteryLevel: 90, batteryCharging: true });
assert.equal(healthy.healthScore, 100, "all-good = 100");
assert.equal(healthy.overallStatus, "healthy", "all-good = healthy");

const critical = computeHealth({ online: false, printerStatus: "error", dbStatus: "error", storageUsedMb: 990, storageQuotaMb: 1000, batteryLevel: 8, batteryCharging: false });
assert.equal(critical.overallStatus, "critical", "many issues = critical");
assert.ok(critical.healthScore < 50, "many issues score < 50");
assert.ok(critical.reasons.includes("db_error") && critical.reasons.includes("offline"), "reasons are explainable");

// Charging low battery is NOT penalised (only discharging low battery is).
assert.equal(computeHealth({ batteryLevel: 5, batteryCharging: true }).healthScore, 100, "charging low battery not penalised");

async function main() {
  const shop = await db.shop.create({ data: { name: `DH ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    // 2) recordHealth persists a snapshot with a computed score.
    const first = await recordHealth({ shopId: shop.id, deviceId: "dev-1", online: true, printerStatus: "offline", storageUsedMb: 900, storageQuotaMb: 1000 });
    assert.ok(first && typeof first.healthScore === "number", "recordHealth returns a score");
    assert.equal(first.overallStatus, "degraded", "printer offline + low storage = degraded");

    // 3) Latest-per-device reflects the newest snapshot.
    await recordHealth({ shopId: shop.id, deviceId: "dev-1", online: true, printerStatus: "ready", dbStatus: "ok" });
    await recordHealth({ shopId: shop.id, deviceId: "dev-2", online: false, dbStatus: "error" });
    const latest1 = await getLatestHealthForDevice({ shopId: shop.id, deviceId: "dev-1" });
    assert.equal(latest1.printerStatus, "ready", "latest dev-1 = newest snapshot");

    const list = await listLatestHealthPerDevice({ shopId: shop.id });
    assert.equal(list.length, 2, "one current row per device");

    // 4) Tenant isolation — another shop sees nothing.
    assert.equal((await listLatestHealthPerDevice({ shopId: "nonexistent" })).length, 0, "no cross-tenant leak");

    // 5) recordHealth never throws on bad input (missing ids returns null).
    assert.equal(await recordHealth({ deviceId: "x" }), null, "missing shopId -> null, no throw");
  } finally {
    await db.deviceHealthSnapshot.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
  console.log("device-health.examples.js OK");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
