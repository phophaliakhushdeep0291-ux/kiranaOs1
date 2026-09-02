import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { restoreLotsForSaleReturn } from "../src/modules/inventory-lots/inventoryLots.service.js";
import { round2 } from "../src/utils/money.js";

/**
 * Damaged goods came back onto the batch shelf.
 *
 * A sale return can mark each line damaged. bills.service.js honours that: it
 * writes a damage loss to the stock ledger and deliberately skips the restock,
 * so the shelf count does not go up. The batch ledger was never told. Every
 * returned unit was handed back to its InventoryLot, damaged or not.
 *
 * For a batch-tracked product — a chemist's strips, a dairy's crates — that
 * leaves the two views of one shelf disagreeing by the damaged quantity. The
 * billing batch picker offers stock that is in the bin, FEFO reserves it,
 * near-expiry valuation counts it, and a recall is told it is still saleable.
 * The next sale of that batch then either fails at checkout with
 * BATCH_STOCK_INSUFFICIENT or pushes the product negative.
 *
 * This is the same drift consumeInventoryLotsForMovement was added to prevent
 * for manual stock-outs; the damaged-return path was the remaining way in.
 */

const BILLS_SERVICE = fileURLToPath(new URL("../src/modules/bills/bills.service.js", import.meta.url));

function lot(id, availableBaseQty, status = "active") {
  return { id, batchNumber: id.toUpperCase(), availableBaseQty, status };
}

/**
 * Enough of Prisma to run the real function: the original sale's allocations,
 * the negative rows earlier returns wrote, and the lots they point at.
 */
function mockTx({ allocations, lots }) {
  const lotRows = lots.map((row) => ({ ...row }));
  const allocationRows = allocations.map((row) => ({ ...row }));
  const created = [];
  const tx = {
    billItemLotAllocation: {
      findMany: async ({ where }) => {
        // The original sale's positive allocations, oldest first.
        if (where.quantityBaseQty?.gt !== undefined) {
          return allocationRows
            .filter((row) => row.quantityBaseQty > 0 && row.billItem.billId === where.billItem.billId)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((row) => ({ ...row, inventoryLot: lotRows.find((entry) => entry.id === row.inventoryLotId) }));
        }
        // What earlier returns against this sale already gave back.
        return allocationRows.filter((row) => row.quantityBaseQty < 0
          && row.billItem.bill?.returnOfBillId === where.billItem.bill.returnOfBillId);
      },
      create: async ({ data }) => {
        created.push(data);
        allocationRows.push({
          ...data,
          createdAt: new Date(),
          billItem: { billId: data.billItemId, productId: "product-1", bill: { returnOfBillId: "bill-original" } },
        });
        return data;
      },
    },
    inventoryLot: {
      update: async ({ where, data }) => {
        const row = lotRows.find((entry) => entry.id === where.id);
        if (data.availableBaseQty?.increment) row.availableBaseQty = round2(row.availableBaseQty + data.availableBaseQty.increment);
        if (data.status) row.status = data.status;
        return row;
      },
    },
  };
  return { tx, lotRows, created };
}

/** Five units of one product sold out of one batch, which is now empty. */
function soldOutOfOneBatch() {
  return mockTx({
    lots: [lot("lot-a", 0, "depleted")],
    allocations: [{
      id: "alloc-1",
      inventoryLotId: "lot-a",
      quantityBaseQty: 5,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      billItem: { billId: "bill-original", productId: "product-1" },
    }],
  });
}

/** Return lines are stored negative, exactly as createSaleReturn writes them. */
function returnBill(quantityBaseQty) {
  return { id: "bill-return", items: [{ id: "return-item-1", productId: "product-1", quantityInBaseUnit: -quantityBaseQty }] };
}

test("a fully damaged return leaves the batch empty", async () => {
  const { tx, lotRows, created } = soldOutOfOneBatch();

  await restoreLotsForSaleReturn(tx, {
    originalBillId: "bill-original",
    returnBill: returnBill(5),
    damagedBaseQtyByProduct: new Map([["product-1", 5]]),
  });

  assert.equal(lotRows[0].availableBaseQty, 0, "damaged stock must not come back onto the batch shelf");
  assert.equal(lotRows[0].status, "depleted");
  assert.deepEqual(created, [], "and nothing may be recorded as given back");
});

test("a partly damaged return restores only the resellable part", async () => {
  const { tx, lotRows, created } = soldOutOfOneBatch();

  // Three of the five came back saleable; two were broken in the bag.
  await restoreLotsForSaleReturn(tx, {
    originalBillId: "bill-original",
    returnBill: returnBill(5),
    damagedBaseQtyByProduct: new Map([["product-1", 2]]),
  });

  assert.equal(lotRows[0].availableBaseQty, 3);
  assert.equal(lotRows[0].status, "active");
  assert.deepEqual(created.map((row) => [row.inventoryLotId, row.quantityBaseQty]), [["lot-a", -3]]);
});

test("an undamaged return still goes back in full", async () => {
  const { tx, lotRows, created } = soldOutOfOneBatch();

  await restoreLotsForSaleReturn(tx, { originalBillId: "bill-original", returnBill: returnBill(5) });

  assert.equal(lotRows[0].availableBaseQty, 5);
  assert.deepEqual(created.map((row) => row.quantityBaseQty), [-5]);
});

test("a write-off does not use up the original allocation a later good return needs", async () => {
  const { tx, lotRows, created } = soldOutOfOneBatch();

  // Monday: two of the five come back broken and are written off.
  await restoreLotsForSaleReturn(tx, {
    originalBillId: "bill-original",
    returnBill: returnBill(2),
    damagedBaseQtyByProduct: new Map([["product-1", 2]]),
  });
  assert.equal(lotRows[0].availableBaseQty, 0);

  // Tuesday: the customer brings back three more, all saleable. Those three are
  // still owed to the batch — the damaged pair never left it on Monday, so it
  // must not be counted against what is restorable now.
  await restoreLotsForSaleReturn(tx, {
    originalBillId: "bill-original",
    returnBill: { id: "bill-return-2", items: [{ id: "return-item-2", productId: "product-1", quantityInBaseUnit: -3 }] },
  });

  assert.equal(lotRows[0].availableBaseQty, 3);
  assert.deepEqual(created.map((row) => row.quantityBaseQty), [-3]);
});

test("the sale return hands the write-off to the batch ledger", () => {
  const source = readFileSync(BILLS_SERVICE, "utf8");
  // The damaged flag lives on the request, not on the stored return line, so it
  // can only reach the batch ledger by being passed across explicitly.
  assert.match(source, /const damagedBaseQtyByProduct = new Map\(\);/);
  assert.match(source, /restoreLotsForSaleReturn\(tx, \{ originalBillId: original\?\.id \?\? null, returnBill, damagedBaseQtyByProduct \}\)/);
  // It has to be built from the same plan the restock loop reads, or the two
  // halves of one return could disagree about which units were written off.
  const built = source.indexOf("for (const row of restockPlan) {");
  const restocked = source.indexOf("for (const { product, qtyInBase, lineCost, damaged, sellingUnitId, sellingUnitQty } of restockPlan) {");
  assert.ok(built !== -1 && restocked !== -1 && built < restocked, "the write-off tally is taken from restockPlan before the restock runs");
});
