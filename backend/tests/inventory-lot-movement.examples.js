import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeInventoryLotsForMovement,
  reconcileInventoryLotsForCorrection,
} from "../src/modules/inventory-lots/inventoryLots.service.js";

function lot(id, batchNumber, expiresOn, availableBaseQty, status = "active") {
  return {
    id,
    shopId: "shop-1",
    locationId: "location-1",
    productId: "product-1",
    batchNumber,
    expiresOn: new Date(`${expiresOn}T00:00:00.000Z`),
    availableBaseQty,
    status,
    createdAt: new Date(`${expiresOn}T01:00:00.000Z`),
  };
}

function mockTx(seed) {
  const rows = seed.map((row) => ({ ...row }));
  const api = {
    findMany: async ({ where }) => rows
      .filter((row) => row.shopId === where.shopId && row.locationId === where.locationId && row.productId === where.productId)
      .filter((row) => row.availableBaseQty > 0)
      .filter((row) => !where.status || row.status === where.status)
      .filter((row) => !where.expiresOn?.gte || row.expiresOn >= where.expiresOn.gte)
      .sort((a, b) => a.expiresOn - b.expiresOn || a.createdAt - b.createdAt),
    updateMany: async ({ where, data }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row || row.status !== where.status || row.availableBaseQty < where.availableBaseQty.gte) return { count: 0 };
      row.availableBaseQty -= data.availableBaseQty.decrement;
      return { count: 1 };
    },
    findUniqueOrThrow: async ({ where }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("lot missing");
      return row;
    },
    update: async ({ where, data }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      Object.assign(row, data);
      return row;
    },
  };
  return { tx: { inventoryLot: api }, rows };
}

const product = { id: "product-1", name: "Batch Medicine", baseUnit: "piece", batchTrackingEnabled: true };

test("manual stock-out consumes saleable lots in FEFO order", async () => {
  const { tx, rows } = mockTx([
    lot("later", "LATER", "2031-01-01", 5),
    lot("early", "EARLY", "2030-01-01", 3),
    lot("recalled", "RECALLED", "2029-01-01", 20, "recalled"),
  ]);

  const allocations = await consumeInventoryLotsForMovement(tx, {
    shopId: "shop-1",
    locationId: "location-1",
    product,
    quantityBaseQty: 4,
  });

  assert.deepEqual(allocations.map((row) => [row.batchNumber, row.quantityBaseQty]), [["EARLY", 3], ["LATER", 1]]);
  assert.deepEqual(rows.map((row) => [row.batchNumber, row.availableBaseQty, row.status]), [
    ["LATER", 4, "active"],
    ["EARLY", 0, "depleted"],
    ["RECALLED", 20, "recalled"],
  ]);
});

test("manual stock-out refuses to create product/lot drift when saleable lots are short", async () => {
  const { tx, rows } = mockTx([lot("only", "ONLY", "2030-01-01", 2)]);
  await assert.rejects(
    consumeInventoryLotsForMovement(tx, { shopId: "shop-1", locationId: "location-1", product, quantityBaseQty: 3 }),
    (error) => error?.code === "BATCH_STOCK_INSUFFICIENT",
  );
  assert.equal(rows[0].availableBaseQty, 2);
});

test("damage can write off recalled stock, while a positive correction must use Stock In", async () => {
  const { tx, rows } = mockTx([lot("recalled", "RECALLED", "2025-01-01", 4, "recalled")]);
  const allocations = await consumeInventoryLotsForMovement(tx, {
    shopId: "shop-1",
    locationId: "location-1",
    product,
    quantityBaseQty: 2,
    includeBlockedOrExpired: true,
  });
  assert.deepEqual(allocations.map((row) => [row.batchNumber, row.quantityBaseQty]), [["RECALLED", 2]]);
  assert.equal(rows[0].availableBaseQty, 2);
  await assert.rejects(
    reconcileInventoryLotsForCorrection(tx, { shopId: "shop-1", locationId: "location-1", product, differenceBaseQty: 1 }),
    (error) => error?.code === "BATCH_CORRECTION_RECEIPT_REQUIRED",
  );
});
