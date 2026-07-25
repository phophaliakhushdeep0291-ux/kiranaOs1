import assert from "node:assert/strict";
import db from "../src/db.js";
import { explainSyncFailure } from "../src/modules/sync/sync-explain.js";
import { getSyncDiagnostics } from "../src/modules/sync/sync-diagnostics.service.js";

// Diagnostics §3: human-readable sync failure explanations + consolidated diagnostics.

// The spec's flagship example: "Inventory update failed because ... Product 982 ..."
const e1 = explainSyncFailure({ type: "UPDATE_STOCK", error: "Invalid product", requestJson: JSON.stringify({ productId: "982" }) });
assert.match(e1.explanation, /Updating inventory failed because the product no longer exists/, "inventory + missing product");
assert.match(e1.explanation, /Product 982/, "includes the product reference");
assert.equal(e1.retryable, false, "business conflict is not auto-retryable");

const e2 = explainSyncFailure({ type: "UPDATE_PRODUCT", error: "Insufficient stock", requestJson: JSON.stringify({ product: { name: "Doodh" } }) });
assert.match(e2.explanation, /enough stock/, "stock cause mapped");
assert.match(e2.explanation, /Doodh/, "names the product from the payload");

const e3 = explainSyncFailure({ entityType: "customer", reasonCode: "CUSTOMER_MOBILE_DUPLICATE", message: "dup" });
assert.equal(e3.retryable, false, "conflict record is not retryable");
assert.match(e3.explanation, /mobile number already exists/, "conflict reasonCode mapped");

const e4 = explainSyncFailure({ type: "CREATE_BILL", error: "Weird transient thing", statusCode: 500 });
assert.equal(e4.retryable, true, "a 500 is retryable");
assert.match(e4.explanation, /temporary server problem/, "generic 500 explained safely");

const e5 = explainSyncFailure({ entityType: "bill", reasonCode: "SOME_UNMAPPED_CODE", message: "brand new situation" });
assert.match(e5.explanation, /brand new situation/, "unmapped code falls back to the raw message");
assert.equal(e5.retryable, false, "conflict record (reasonCode) is not retryable");

async function main() {
  const shop = await db.shop.create({ data: { name: `SD ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    await db.device.create({ data: { shopId: shop.id, deviceId: "d1", lastSyncAt: new Date() } });
    await db.offlineSyncEvent.create({ data: { shopId: shop.id, eventId: "ev1", type: "UPDATE_STOCK", status: "failed", attempts: 2, error: "Invalid product", requestJson: JSON.stringify({ productId: "982" }) } });
    await db.syncConflict.create({ data: { shopId: shop.id, entityType: "product", entityId: "982", reasonCode: "INVALID_PRODUCT_ID", message: "gone", status: "open" } });

    const diag = await getSyncDiagnostics(shop.id);
    assert.equal(diag.counts.failed, 1, "one failed event");
    assert.equal(diag.counts.openConflicts, 1, "one open conflict");
    assert.equal(diag.counts.totalRetryAttempts, 2, "retry attempts summed");
    assert.ok(diag.lastSuccessfulSyncAt, "last successful sync taken from device");
    assert.match(diag.recentFailures[0].explanation, /no longer exists/, "failure carries an explanation");
    assert.ok(diag.recentConflicts[0].explanation.length > 0, "conflict carries an explanation");
    assert.equal(diag.healthy, false, "not healthy when there are failures");

    const empty = await getSyncDiagnostics("nonexistent");
    assert.equal(empty.counts.failed, 0, "tenant isolation — no cross-shop failures");
    assert.equal(empty.lastSuccessfulSyncAt, null, "tenant isolation — no cross-shop sync time");
  } finally {
    await db.offlineSyncEvent.deleteMany({ where: { shopId: shop.id } });
    await db.syncConflict.deleteMany({ where: { shopId: shop.id } });
    await db.device.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
  console.log("sync-diagnostics.examples.js OK");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
