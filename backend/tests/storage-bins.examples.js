import assert from "node:assert/strict";
import db from "../src/db.js";
import {
  createBin,
  getBinMap,
  movePlacement,
  reconcilePlacements,
  summarisePlacements,
  updateBin,
} from "../src/modules/inventory/bins.service.js";

// Bins say WHERE inside a branch stock sits, never HOW MUCH the branch owns. The
// whole feature rests on that, so most of what follows is the same assertion from
// different angles: after every bin operation, branch stock is untouched.

// ── pure summary ────────────────────────────────────────────────────
assert.deepEqual(summarisePlacements(100, [{ stockBaseQty: 30 }, { stockBaseQty: 20 }]), {
  locationStockBaseQty: 100, placedBaseQty: 50, unplacedBaseQty: 50, overPlacedBaseQty: 0, reconciled: true,
});
// Selling does not walk the bin map, so placements can outrun stock. That is
// reported, not hidden in a negative "unplaced" nobody can pick from.
const drifted = summarisePlacements(40, [{ stockBaseQty: 50 }]);
assert.equal(drifted.unplacedBaseQty, 0);
assert.equal(drifted.overPlacedBaseQty, 10);
assert.equal(drifted.reconciled, false);
assert.equal(summarisePlacements(0, []).unplacedBaseQty, 0);

async function expectFailure(promise, code, message) {
  const result = await promise.then(() => null, (error) => error);
  assert.ok(result, `${message} — expected a rejection`);
  assert.equal(result.code, code, `${message} — got ${result.code}: ${result.message}`);
}

async function main() {
  const shop = await db.shop.create({ data: { name: `Bins ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });
  try {
    const primary = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main", isPrimary: true } });
    const branch = await db.storeLocation.create({ data: { shopId: shop.id, code: "BR1", name: "Branch One" } });
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Atta 10kg", category: "staples",
        baseUnit: "g", rateUnit: "kg", displayUnit: "kg",
        stockBaseQty: 100_000, defaultPricePerRateUnit: 45, costPerRateUnit: 38,
      },
    });
    // The branch holds 40 kg of the company's 100 kg.
    await db.locationStock.create({ data: { shopId: shop.id, locationId: branch.id, productId: product.id, stockBaseQty: 40_000 } });

    const rack = await createBin(shop.id, { locationId: branch.id, code: "a-1", name: "Rack A shelf 1" }, {});
    const reserve = await createBin(shop.id, { locationId: branch.id, code: "B-1", kind: "bulk" }, {});
    const otherLocationBin = await createBin(shop.id, { locationId: primary.id, code: "M-1" }, {});
    assert.equal(rack.code, "A-1", "bin codes are normalised so A-1 and a-1 cannot both exist");

    const readStock = async () => {
      const [row, prod] = await Promise.all([
        db.locationStock.findFirst({ where: { shopId: shop.id, locationId: branch.id, productId: product.id, sellingUnitId: null } }),
        db.product.findUnique({ where: { id: product.id } }),
      ]);
      return { branch: Number(row.stockBaseQty), company: Number(prod.stockBaseQty) };
    };
    const before = await readStock();
    assert.deepEqual(before, { branch: 40_000, company: 100_000 });

    const scope = { locationId: branch.id, productId: product.id };
    const fresh = await getBinMap(shop.id, branch.id, scope);
    assert.equal(fresh.locationStockBaseQty, 40_000);
    assert.equal(fresh.unplacedBaseQty, 40_000, "nothing is put away yet");
    assert.equal(fresh.bins.length, 2, "only this branch's bins are listed");

    // ── put away, then move between bins ──────────────────────────────
    const putAway = await movePlacement(shop.id, { ...scope, toBinId: rack.id, quantityBaseQty: 25_000 }, {});
    assert.equal(putAway.placedBaseQty, 25_000);
    assert.equal(putAway.unplacedBaseQty, 15_000);
    assert.deepEqual(await readStock(), before, "putting stock away must not change what the branch owns");

    const shifted = await movePlacement(shop.id, { ...scope, fromBinId: rack.id, toBinId: reserve.id, quantityBaseQty: 10_000 }, {});
    assert.equal(shifted.placedBaseQty, 25_000, "a bin-to-bin move is net zero");
    assert.equal(shifted.unplacedBaseQty, 15_000);
    assert.deepEqual(await readStock(), before, "moving between bins must not change branch stock");

    const pulledBack = await movePlacement(shop.id, { ...scope, fromBinId: reserve.id, toBinId: null, quantityBaseQty: 4_000 }, {});
    assert.equal(pulledBack.placedBaseQty, 21_000);
    assert.equal(pulledBack.unplacedBaseQty, 19_000);
    assert.deepEqual(await readStock(), before, "pulling stock back to the floor must not change branch stock");

    const map = await getBinMap(shop.id, branch.id, scope);
    assert.equal(map.bins.find((bin) => bin.binId === rack.id).stockBaseQty, 15_000);
    assert.equal(map.bins.find((bin) => bin.binId === reserve.id).stockBaseQty, 6_000);

    // ── the refusals that keep the guarantee true ─────────────────────
    await expectFailure(
      movePlacement(shop.id, { ...scope, fromBinId: rack.id, toBinId: otherLocationBin.id, quantityBaseQty: 1 }, {}),
      "BIN_LOCATION_MISMATCH",
      "a move across locations is a transfer, not a put-away",
    );
    await expectFailure(
      movePlacement(shop.id, { ...scope, toBinId: rack.id, quantityBaseQty: 999_000 }, {}),
      "BIN_INSUFFICIENT_UNPLACED",
      "cannot put away more than the branch has left unplaced",
    );
    await expectFailure(
      movePlacement(shop.id, { ...scope, fromBinId: reserve.id, toBinId: rack.id, quantityBaseQty: 999_000 }, {}),
      "BIN_INSUFFICIENT_PLACEMENT",
      "cannot move more than the bin holds",
    );
    await expectFailure(
      movePlacement(shop.id, { ...scope, fromBinId: rack.id, toBinId: rack.id, quantityBaseQty: 1 }, {}),
      "BIN_MOVE_SAME_BIN",
      "a move to the same bin is not a move",
    );
    await expectFailure(
      movePlacement(shop.id, { ...scope, toBinId: rack.id, quantityBaseQty: 0 }, {}),
      "BIN_MOVE_QTY_INVALID",
      "a zero move is rejected",
    );
    await expectFailure(
      updateBin(shop.id, rack.id, { active: false }, {}),
      "BIN_NOT_EMPTY",
      "deactivating an occupied bin would strand its stock",
    );
    assert.deepEqual(await readStock(), before, "no rejected move may have changed branch stock");

    // ── drift after selling, then reconcile ───────────────────────────
    // Selling reduces branch stock without walking the bin map, so placements now
    // claim more than the branch holds. That is expected, and reported.
    await db.locationStock.updateMany({
      where: { shopId: shop.id, locationId: branch.id, productId: product.id, sellingUnitId: null },
      data: { stockBaseQty: 18_000 },
    });
    const afterSelling = await getBinMap(shop.id, branch.id, scope);
    assert.equal(afterSelling.placedBaseQty, 21_000);
    assert.equal(afterSelling.overPlacedBaseQty, 3_000, "the bin map must admit it is ahead of real stock");
    assert.equal(afterSelling.unplacedBaseQty, 0);
    assert.equal(afterSelling.reconciled, false);

    const reconciled = await reconcilePlacements(shop.id, scope, {});
    assert.equal(reconciled.trimmedBaseQty, 3_000);
    assert.equal(reconciled.placedBaseQty, 18_000, "placements are trimmed back to what the branch holds");
    assert.equal(reconciled.overPlacedBaseQty, 0);
    assert.equal(reconciled.reconciled, true);
    const stockAfterReconcile = await readStock();
    assert.equal(stockAfterReconcile.branch, 18_000, "reconcile trims placements, never stock");
    assert.equal(stockAfterReconcile.company, 100_000, "the company total is never touched by a bin operation");

    // Reconciling an already-clean map is a no-op rather than an error.
    assert.equal((await reconcilePlacements(shop.id, scope, {})).trimmedBaseQty, 0);

    // Bin state and placement quantities are inseparable from their audit trail.
    // Force the audit insert to fail and prove both kinds of mutation roll back.
    const beforeAuditFailure = await getBinMap(shop.id, branch.id, scope);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER fail_bin_audit
      BEFORE INSERT ON AuditLog
      WHEN NEW.action IN ('STORAGE_BIN_CREATED', 'STORAGE_BIN_UPDATED', 'BIN_PLACEMENT_MOVED', 'BIN_PLACEMENTS_RECONCILED')
      BEGIN
        SELECT RAISE(ABORT, 'forced bin audit failure');
      END
    `);
    await expectFailure(
      createBin(shop.id, { locationId: branch.id, code: "ROLLBACK" }, {}),
      "BIN_AUDIT_WRITE_FAILED",
      "an unaudited bin must not be created",
    );
    assert.equal(await db.storageBin.count({ where: { shopId: shop.id, code: "ROLLBACK" } }), 0);
    await expectFailure(
      movePlacement(shop.id, { ...scope, fromBinId: rack.id, toBinId: reserve.id, quantityBaseQty: 100 }, {}),
      "BIN_AUDIT_WRITE_FAILED",
      "an unaudited placement move must roll back",
    );
    await db.$executeRawUnsafe("DROP TRIGGER fail_bin_audit");
    assert.deepEqual(await getBinMap(shop.id, branch.id, scope), beforeAuditFailure, "audit failure must leave the bin map unchanged");

    // ── the audit trail ───────────────────────────────────────────────
    const actions = await db.auditLog.findMany({ where: { shopId: shop.id }, select: { action: true } });
    const seen = new Set(actions.map((row) => row.action));
    for (const action of ["STORAGE_BIN_CREATED", "BIN_PLACEMENT_MOVED", "BIN_PLACEMENTS_RECONCILED"]) {
      assert.ok(seen.has(action), `${action} must be audited`);
    }

    console.log("Storage bin examples passed");
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_bin_audit");
    await db.auditLog.deleteMany({ where: { shopId: shop.id } });
    await db.binPlacement.deleteMany({ where: { shopId: shop.id } });
    await db.storageBin.deleteMany({ where: { shopId: shop.id } });
    await db.locationStock.deleteMany({ where: { shopId: shop.id } });
    await db.product.deleteMany({ where: { shopId: shop.id } });
    await db.storeLocation.deleteMany({ where: { shopId: shop.id } });
    await db.shop.delete({ where: { id: shop.id } });
    await db.$disconnect();
  }
}

await main();
