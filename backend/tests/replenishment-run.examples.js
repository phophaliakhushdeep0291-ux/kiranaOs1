import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  REPLENISHMENT_DEFAULTS,
  planReplenishmentRun,
  readReplenishmentPolicy,
  runUnattendedReplenishment,
} from "../src/modules/stores/replenishment.service.js";

// The only unattended writer that moves stock. Most of what follows checks that it
// stays switched off, stays capped, and cannot ship the same thing twice.

// ── policy defaults ─────────────────────────────────────────────────
assert.equal(REPLENISHMENT_DEFAULTS.enabled, false, "replenishment must never be on by default");
assert.equal(REPLENISHMENT_DEFAULTS.fulfillmentMode, "shipment", "unattended stock must land in transit, not on a shelf");

assert.equal(readReplenishmentPolicy({ settingsJson: "{}" }).enabled, false);
assert.equal(readReplenishmentPolicy({ settingsJson: "not json at all" }).enabled, false, "a malformed settings blob must not read as enabled");
assert.equal(readReplenishmentPolicy({}).enabled, false);
// Only an explicit true switches it on — a truthy string must not.
assert.equal(readReplenishmentPolicy({ settingsJson: JSON.stringify({ replenishment: { enabled: "yes" } }) }).enabled, false);

const configured = readReplenishmentPolicy({
  settingsJson: JSON.stringify({ replenishment: { enabled: true, maxTransfersPerRun: 2, maxLinesPerTransfer: 1, minTransferBaseQty: 500, fulfillmentMode: "instant" } }),
});
assert.deepEqual(configured, { enabled: true, minTransferBaseQty: 500, maxLinesPerTransfer: 1, maxTransfersPerRun: 2, fulfillmentMode: "instant" });
// Nonsense caps fall back to the defaults rather than becoming zero or negative.
const nonsense = readReplenishmentPolicy({ settingsJson: JSON.stringify({ replenishment: { enabled: true, maxTransfersPerRun: -4, maxLinesPerTransfer: 0 } }) });
assert.equal(nonsense.maxTransfersPerRun, REPLENISHMENT_DEFAULTS.maxTransfersPerRun);
assert.equal(nonsense.maxLinesPerTransfer, REPLENISHMENT_DEFAULTS.maxLinesPerTransfer);

// ── pure planning ───────────────────────────────────────────────────
const suggestion = (productId, locationId, qty) => ({
  productId, productName: `P-${productId}`, recommendedTransferBaseQty: qty,
  destinationLocation: { id: locationId, name: `Branch ${locationId}` },
});
const policy = { enabled: true, minTransferBaseQty: 10, maxLinesPerTransfer: 2, maxTransfersPerRun: 1, fulfillmentMode: "shipment" };
const planned = planReplenishmentRun(
  [suggestion("a", "L1", 100), suggestion("b", "L1", 100), suggestion("c", "L1", 100), suggestion("d", "L2", 100), suggestion("e", "L1", 5), suggestion("f", "L1", 100)],
  policy,
  new Set(["f"]),
);
assert.equal(planned.transfers.length, 1, "the per-run transfer cap is honoured");
assert.equal(planned.transfers[0].items.length, 2, "the per-transfer line cap is honoured");
const reasons = Object.fromEntries(planned.skipped.map((row) => [row.productId, row.reason]));
assert.equal(reasons.c, "transfer_line_cap");
assert.equal(reasons.e, "below_minimum");
assert.equal(reasons.f, "per_pack_needs_size", "a per-pack product cannot ship without a size and is left for a human");
assert.equal(reasons.d, "run_transfer_cap");
assert.equal(planned.skipped.length, 4, "everything left behind is reported, never silently dropped");

async function main() {
  const shop = await db.shop.create({ data: { name: `Replen ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const primary = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });
    const branch = await db.storeLocation.create({ data: { shopId: shop.id, code: "BR1", name: "Branch One" } });
    await db.user.create({ data: { shopId: shop.id, name: "Owner", mobile: `9${Date.now()}`.slice(0, 10), passwordHash: "x", role: "owner" } });
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Toor Dal", category: "staples", baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 100_000, defaultPricePerRateUnit: 140, costPerRateUnit: 120,
        lowStockThreshold: 5_000, reorderLevel: 10_000,
      },
    });
    await db.locationStock.create({ data: { shopId: shop.id, locationId: branch.id, productId: product.id, stockBaseQty: 1_000 } });

    const transferCount = () => db.stockTransfer.count({ where: { shopId: shop.id } });

    // ── off by default ────────────────────────────────────────────────
    const disabled = await runUnattendedReplenishment(shop.id);
    assert.equal(disabled.executed, false);
    assert.equal(disabled.reason, "replenishment_disabled");
    assert.equal(await transferCount(), 0, "a shop that never opted in must never have stock shipped");

    // ── dry run plans without shipping ────────────────────────────────
    await db.shop.update({ where: { id: shop.id }, data: { settingsJson: JSON.stringify({ replenishment: { enabled: true } }) } });
    const preview = await runUnattendedReplenishment(shop.id, { dryRun: true });
    assert.equal(preview.executed, false);
    assert.equal(preview.reason, "dry_run");
    assert.equal(preview.transfers.length, 1, "the branch below its threshold is planned");
    assert.equal(preview.transfers[0].items[0].productId, product.id);
    assert.equal(preview.transfers[0].items[0].quantityBaseQty, 14_000);
    assert.equal(await transferCount(), 0, "a dry run must not ship anything");

    // ── the real run ──────────────────────────────────────────────────
    const executed = await runUnattendedReplenishment(shop.id);
    assert.equal(executed.executed, true);
    assert.equal(executed.failed.length, 0, `unexpected failures: ${JSON.stringify(executed.failed)}`);
    assert.equal(executed.created.length, 1);
    assert.equal(await transferCount(), 1);
    const transfer = await db.stockTransfer.findFirst({ where: { shopId: shop.id } });
    assert.equal(transfer.fromLocationId, primary.id);
    assert.equal(transfer.toLocationId, branch.id);
    assert.equal(transfer.fulfillmentMode, "shipment", "unattended stock must wait to be received at the branch");

    // ── re-running must not ship it twice ─────────────────────────────
    // No lock of its own: the suggestion query subtracts what is already in
    // transit, so the second run sees the first run's van and stands down.
    const second = await runUnattendedReplenishment(shop.id);
    assert.equal(second.executed, true);
    assert.equal(second.created.length, 0, "a second run inside the delivery window must not duplicate the transfer");
    assert.equal(await transferCount(), 1, "still exactly one transfer");

    const audits = await db.auditLog.findMany({ where: { shopId: shop.id, action: "REPLENISHMENT_RUN_EXECUTED" } });
    assert.equal(audits.length, 2, "every executed run is audited, including the one that shipped nothing");

    console.log("Replenishment run examples passed");
  } finally {
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.stockTransferItem.deleteMany({ where: { transfer: { shopId: shop.id } } });
    await db.stockTransfer.deleteMany({ where: { shopId: shop.id } });
    await db.stockLedger.deleteMany({ where: { shopId: shop.id } });
    await db.locationStock.deleteMany({ where: { shopId: shop.id } });
    await db.product.deleteMany({ where: { shopId: shop.id } });
    await db.user.deleteMany({ where: { shopId: shop.id } });
    await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
}

await main();
