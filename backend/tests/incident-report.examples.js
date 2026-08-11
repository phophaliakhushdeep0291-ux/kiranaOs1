import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  analyzeIncident,
  detectFocus,
  generateIncidentReport,
} from "../src/modules/diagnostics/incident-report.service.js";

// Diagnostics §6: deterministic incident analysis + full report composition
// (always works without an AI key; the LLM only adds a narrative).

// Focus is read from the user's own words.
assert.equal(detectFocus("my printer isn't working"), "printer");
assert.equal(detectFocus("bills are not syncing"), "sync");
assert.equal(detectFocus("why is my stock negative"), "inventory");
assert.equal(detectFocus("something weird happened"), "general");

// A critical local-DB signal dominates and reads high-confidence.
let a = analyzeIncident({ deviceHealth: { overallStatus: "critical", dbStatus: "error", extraJson: JSON.stringify({ reasons: ["db_error"] }) } }, "app is slow and stuck", "performance");
assert.match(a.probableRootCause, /local database/i);
assert.equal(a.confidenceLabel, "high");

// A sync failure carries its own explanation through to the root cause.
a = analyzeIncident({ sync: { counts: { failed: 2 }, recentFailures: [{ explanation: "Updating inventory failed because the product no longer exists (Product 982).", retryable: false }] } }, "bills not syncing", "sync");
assert.match(a.probableRootCause, /could not sync/i);
assert.match(a.probableRootCause, /no longer exists/);

// No signals => low confidence, honest fallback.
a = analyzeIncident({}, "", "general");
assert.equal(a.confidenceLabel, "low");
assert.ok(a.confidence <= 0.3);

// The user's words break ties: a printer complaint surfaces the printer signal.
a = analyzeIncident({ deviceHealth: { printerStatus: "offline" }, sync: { counts: { failed: 1 }, recentFailures: [{ explanation: "x", retryable: true }] } }, "printer not working", "printer");
assert.match(a.probableRootCause, /printer/i);

async function main() {
  const shop = await db.shop.create({ data: { name: `IR ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    await db.errorGroup.create({ data: { shopId: shop.id, fingerprint: `fp-${Date.now()}`, source: "frontend", title: "TypeError x", sampleMessage: "x", count: 5, status: "open" } });
    await db.device.create({ data: { shopId: shop.id, deviceId: "d1", lastSyncAt: new Date() } });
    await db.offlineSyncEvent.create({ data: { shopId: shop.id, eventId: "ev1", type: "UPDATE_STOCK", status: "failed", attempts: 2, error: "Invalid product", requestJson: JSON.stringify({ productId: "982" }) } });
    await db.deviceHealthSnapshot.create({ data: { shopId: shop.id, deviceId: "d1", overallStatus: "degraded", healthScore: 70, printerStatus: "not_configured", online: true, dbStatus: "ok", appVersion: "web", browser: "Chrome", os: "Windows", extraJson: JSON.stringify({ reasons: [] }) } });
    await db.auditLog.create({ data: { shopId: shop.id, action: "BILL_CREATED", entityType: "Bill" } });

    const report = await generateIncidentReport({ shopId: shop.id, deviceId: "d1", problemSummary: "bills not syncing", useAi: false });

    for (const key of ["problemSummary", "recentUserActions", "recentErrors", "recentSyncEvents", "deviceInformation", "networkInformation", "databaseStatus", "possibleRootCause", "suggestedSolution", "confidenceScore"]) {
      assert.ok(key in report, `report has §6 section: ${key}`);
    }
    assert.equal(report.focus, "sync", "focus derived from the description");
    assert.match(report.possibleRootCause, /could not sync|no longer exists/i, "root cause reflects the dominant sync failure");
    assert.equal(report.databaseStatus.server, "ok", "server DB reachable");
    assert.ok(report.recentUserActions.some((x) => x.action === "BILL_CREATED"), "audit trail included (recent user actions)");
    assert.ok(report.recentErrors.some((x) => x.title === "TypeError x"), "recent errors included");
    assert.ok(report.recentSyncEvents.counts.failed >= 1, "recent sync events included");
    assert.equal(report.aiNarrative, null, "no AI narrative without a configured key");
    assert.deepEqual(
      report.aiGrounding,
      { status: "not_requested", evidenceIds: [], rejectedReason: null },
      "disabled AI is explicit instead of being indistinguishable from a provider failure",
    );
  } finally {
    await db.errorEvent.deleteMany({ where: { shopId: shop.id } });
    await db.errorGroup.deleteMany({ where: { shopId: shop.id } });
    await db.offlineSyncEvent.deleteMany({ where: { shopId: shop.id } });
    await db.syncConflict.deleteMany({ where: { shopId: shop.id } });
    await db.deviceHealthSnapshot.deleteMany({ where: { shopId: shop.id } });
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.device.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
  console.log("incident-report.examples.js OK");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
