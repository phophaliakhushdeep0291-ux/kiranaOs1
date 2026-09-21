import assert from "node:assert/strict";
import db from "../src/db.js";
import { nearExpiryAlerts } from "../src/modules/inventory-lots/inventoryLots.service.js";
import { resolveOperationalLocation } from "../src/modules/stores/location-context.service.js";

// The near-expiry card could not be shown to a shop that batch-tracks a packaged
// product.
//
// Each batch is valued at cost: `lot.costPerRateUnit` is per RATE unit while the
// batch is held in base units, so the quantity is converted through the product's
// rate unit first. That went through the unit table, which knows only real units,
// and the starter catalogue quotes 7Up per "bottle" — so ONE packaged batch threw
//
//   Unsupported unit "bottle". Supported units: kg, g, gram, ... box
//
// and took the whole list down with it. Batches and expiry is promoted to kirana
// shops, and what a kirana tracks by batch is exactly its packaged stock.

const DAY = 86_400_000;
const inDays = (days) => new Date(Date.now() + days * DAY);

async function main() {
  const shop = await db.shop.create({ data: { name: `NEP ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const location = await resolveOperationalLocation(shop.id, null);

    // ── a loose product: the unit table converts kg ──────────────────
    // Checked before any packaged batch exists, so this assertion reads the same
    // against the code before and after the fix.
    const sugar = await db.product.create({
      data: {
        shopId: shop.id, name: "Loose Sugar", category: "grocery",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 5000, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    await db.inventoryLot.create({
      data: {
        shopId: shop.id, locationId: location.id, productId: sugar.id, batchNumber: "SUGAR-1",
        expiresOn: inDays(20), receivedBaseQty: 5000, availableBaseQty: 5000, costPerRateUnit: 40,
      },
    });
    const looseOnly = await nearExpiryAlerts(shop.id);
    assert.equal(
      looseOnly.batches.find((row) => row.batchNumber === "SUGAR-1").valueAtRisk,
      200,
      "5 kg of sugar at ₹40/kg is ₹200 at risk",
    );

    // ── a packaged product, exactly as the starter catalogue makes it ─
    const sevenUp = await db.product.create({
      data: {
        shopId: shop.id, name: "7Up 750ml", category: "soft drinks",
        baseUnit: "ml", rateUnit: "bottle", displayUnit: "bottle 750 ml",
        stockBaseQty: 7500, defaultPricePerRateUnit: 45, costPerRateUnit: 40,
        packagingMode: "pooled", batchTrackingEnabled: true,
      },
    });
    await db.productSellingUnit.create({
      data: {
        shopId: shop.id, productId: sevenUp.id, name: "bottle 750 ml",
        unitType: "bottle", unitCode: "bottle-750-ml", packSizeValue: 750, packSizeUnit: "ml",
        conversionToBase: 750, defaultPrice: 45, maximumPrice: 45, costPrice: 40,
        onHandQty: 0, isDefault: true,
      },
    });
    await db.inventoryLot.create({
      data: {
        shopId: shop.id, locationId: location.id, productId: sevenUp.id, batchNumber: "7UP-1",
        expiresOn: inDays(10), receivedBaseQty: 7500, availableBaseQty: 7500, costPerRateUnit: 40,
      },
    });

    const alerts = await nearExpiryAlerts(shop.id);
    // 7500 ml is 10 bottles at ₹40 a bottle. A factor of 1 would put ₹3,00,000
    // at risk on one crate-sized batch.
    assert.equal(
      alerts.batches.find((row) => row.batchNumber === "7UP-1").valueAtRisk,
      400,
      "10 bottles of 7Up at ₹40 cost is ₹400 at risk",
    );
    assert.equal(
      alerts.batches.find((row) => row.batchNumber === "SUGAR-1").valueAtRisk,
      200,
      "the loose batch is valued exactly as before alongside it",
    );
    assert.equal(alerts.totalValueAtRisk, 600, "₹400 of 7Up plus ₹200 of sugar");

    console.log("near-expiry-pack-rate-unit.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.productSellingUnit.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();
