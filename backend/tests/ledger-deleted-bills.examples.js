import assert from "node:assert/strict";
import db from "../src/db.js";
import { cancelBill, confirmBill, restoreDeletedBill, softDeleteBill } from "../src/modules/bills/bills.service.js";
import { getFinancialLedgerReconciliation } from "../src/modules/reports/reports.service.js";
import { buildAccountingControl } from "../src/modules/finance/accounting-control.service.js";

// Soft-deleting a bill used to write nothing to FinancialLedger, so the owner-facing parity
// gate (getFinancialLedgerReconciliation) had to keep counting recycle-bin bills to stay at
// zero variance — the one bill read in reports.service.js that ignored `deletedAt` while every
// other report had stopped counting them. softDeleteBill now posts a reversing entry, so the
// gate filters deleted bills like everything else.
//
// The subtlety this file exists to pin down: a delete is NOT a cancellation. It takes the sale
// off the books but unwinds nothing operational — the customer still owes the udhar. So the
// reversal covers the reporting half only (sale, cash/upi/bank, GST, waiver) and leaves
// udhar_debit standing, which is what keeps journal `outstanding` equal to the sum of
// Customer.udharAmount that a delete never touches.

async function reconcile(shopId) {
  return getFinancialLedgerReconciliation(shopId);
}

function assertGateGreen(result, label) {
  assert.deepEqual(
    result.variancePaise,
    { sales: 0, cashCollected: 0, upiCollected: 0, bankCollected: 0, outstanding: 0 },
    `${label}: every KPI must reconcile to the paise`,
  );
  assert.equal(result.readyForCutover, true, `${label}: the cutover gate must stay green`);
}

async function assertJournalBalanced(shopId, label) {
  const rows = await db.financialLedger.findMany({ where: { shopId } });
  const control = buildAccountingControl(rows);
  assert.equal(
    control.status,
    "balanced",
    `${label}: the journal must stay balanced — exceptions: ${JSON.stringify(control.exceptions)}`,
  );
}

async function ledgerRowCount(shopId, billId) {
  return db.financialLedger.count({ where: { shopId, billId } });
}

async function netByEntryType(shopId, billId) {
  const rows = await db.financialLedger.findMany({ where: { shopId, billId }, select: { entryType: true, amountPaise: true } });
  const net = new Map();
  for (const row of rows) net.set(row.entryType, (net.get(row.entryType) ?? 0n) + BigInt(row.amountPaise ?? 0));
  return [...net.entries()].filter(([, paise]) => paise !== 0n).map(([entryType, paise]) => ({ entryType, paise: Number(paise) }));
}

async function sellCash(shopId, product, tag) {
  return confirmBill(shopId, {
    billType: "normal_sale",
    customerName: "Walk-in",
    gstMode: "exclusive",
    items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 18 }],
    discount: 0,
    payments: [{ mode: "cash", amount: 118 }],
    actualAmount: 118,
    buyerPaidAmount: 118,
    waivedAmount: 0,
    clientBillId: tag,
    idempotencyKey: tag,
  });
}

// Part cash, part udhar — the case that makes the two halves of the reversal visible.
async function sellOnCredit(shopId, product, customer, tag) {
  return confirmBill(shopId, {
    billType: "normal_sale",
    customerId: customer.id,
    customerName: customer.name,
    gstMode: "exclusive",
    items: [{ productId: product.id, name: product.name, quantity: 1, enteredUnit: "piece", ratePerRateUnit: 100, gstRate: 18 }],
    discount: 0,
    payments: [{ mode: "cash", amount: 40 }],
    creditAmount: 78,
    actualAmount: 118,
    buyerPaidAmount: 40,
    waivedAmount: 0,
    clientBillId: tag,
    idempotencyKey: tag,
  });
}

async function main() {
  const shop = await db.shop.create({ data: { name: `LDB ${Date.now()}`, ownerName: "o", city: "c", address: "a" } });

  try {
    const product = await db.product.create({
      data: {
        shopId: shop.id, name: "Toor Dal 1kg", category: "staples",
        baseUnit: "g", rateUnit: "piece", displayUnit: "piece",
        stockBaseQty: 1000, defaultPricePerRateUnit: 100, costPerRateUnit: 60,
        gstRate: 18,
      },
    });
    const customer = await db.customer.create({ data: { shopId: shop.id, name: "Udhar Ramesh", mobile: "9000000001" } });

    // ── baseline: the gate is green before anything is deleted ──────
    const cashBill = await sellCash(shop.id, product, "ldb-cash");
    const creditBill = await sellOnCredit(shop.id, product, customer, "ldb-credit");

    const before = await reconcile(shop.id);
    assertGateGreen(before, "two live bills");
    assert.equal(before.operational.sales, 236, "both bills are on the books");
    assert.equal(before.operational.outstanding, 78, "and the udhar half is owed");
    await assertJournalBalanced(shop.id, "two live bills");

    // ── deleting a cash bill takes it fully off both sides ──────────
    await softDeleteBill(shop.id, cashBill.id, { reason: "billed twice by mistake" });
    const afterCashDelete = await reconcile(shop.id);
    assertGateGreen(afterCashDelete, "cash bill deleted");
    assert.equal(afterCashDelete.operational.sales, 118, "the deleted sale leaves the operational side");
    assert.equal(afterCashDelete.journal.sales, 118, "and the journal reverses it to match");
    assert.equal(afterCashDelete.journal.cashCollected, 40, "its cash leaves the journal too");
    assert.deepEqual(await netByEntryType(shop.id, cashBill.id), [], "a deleted cash bill nets to zero, entry type by entry type");
    await assertJournalBalanced(shop.id, "cash bill deleted");

    // ── deleting a CREDIT bill: sale goes, the debt stays ───────────
    // This is the case a straight mirror of postBillCancelledLedger would get wrong: it would
    // reverse udhar_debit, dropping journal `outstanding` to 0 while Customer.udharAmount still
    // reads 78, and the gate would go red on a bill neither side got wrong.
    await softDeleteBill(shop.id, creditBill.id, { reason: "wrong customer" });
    const afterCreditDelete = await reconcile(shop.id);
    assertGateGreen(afterCreditDelete, "credit bill deleted");
    assert.equal(afterCreditDelete.operational.sales, 0, "no bill is left on the books");
    assert.equal(afterCreditDelete.journal.sales, 0, "the journal agrees");
    assert.equal(afterCreditDelete.journal.cashCollected, 0, "so does the cash");
    assert.equal(
      (await db.customer.findUnique({ where: { id: customer.id } })).udharAmount,
      78,
      "a recycle-bin delete does not forgive the debt",
    );
    assert.equal(afterCreditDelete.operational.outstanding, 78, "so the operational side still shows it owed");
    assert.equal(afterCreditDelete.journal.outstanding, 78, "and the journal keeps udhar_debit standing to match");
    await assertJournalBalanced(shop.id, "credit bill deleted");

    // ── replaying the same delete posts nothing extra ───────────────
    // The offline sync path (applyDeleteBill) reaches softDeleteBill, and a re-delivered event
    // must not reverse the bill twice.
    const rowsAfterFirstDelete = await ledgerRowCount(shop.id, creditBill.id);
    await softDeleteBill(shop.id, creditBill.id, { reason: "replayed offline event" });
    assert.equal(await ledgerRowCount(shop.id, creditBill.id), rowsAfterFirstDelete, "replaying DELETE_BILL is a no-op");
    assertGateGreen(await reconcile(shop.id), "delete replayed");

    // ── restore puts the reporting half back ────────────────────────
    await restoreDeletedBill(shop.id, creditBill.id, {});
    const afterRestore = await reconcile(shop.id);
    assertGateGreen(afterRestore, "credit bill restored");
    assert.equal(afterRestore.operational.sales, 118, "the restored bill is back on the books");
    assert.equal(afterRestore.journal.sales, 118, "and back in the journal");
    assert.equal(afterRestore.journal.outstanding, 78, "with the debt unchanged throughout");
    await assertJournalBalanced(shop.id, "credit bill restored");

    // ── delete → restore → delete is not deduped ────────────────────
    // Cancel/restore keys embed the operation timestamp for exactly this reason; delete/undelete
    // follow the same convention, so a second genuine delete posts its own rows.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await softDeleteBill(shop.id, creditBill.id, { reason: "deleted again" });
    const cycled = await reconcile(shop.id);
    assertGateGreen(cycled, "delete → restore → delete");
    assert.equal(cycled.journal.sales, 0, "the second delete really did reverse the sale again");
    assert.equal(cycled.journal.outstanding, 78, "and still left the debt alone");
    await assertJournalBalanced(shop.id, "delete → restore → delete");

    // ── cancelled-then-deleted reverses once, not twice ─────────────
    const scrapped = await sellCash(shop.id, product, "ldb-scrapped");
    await cancelBill(shop.id, scrapped.id, { reason: "customer walked out" });
    const afterCancel = await reconcile(shop.id);
    assertGateGreen(afterCancel, "bill cancelled");
    await softDeleteBill(shop.id, scrapped.id, { reason: "tidying the bin" });
    const afterCancelThenDelete = await reconcile(shop.id);
    assertGateGreen(afterCancelThenDelete, "cancelled then deleted");
    assert.deepEqual(
      await netByEntryType(shop.id, scrapped.id),
      [],
      "deleting an already-cancelled bill posts nothing — its effect was reversed at cancel",
    );
    await assertJournalBalanced(shop.id, "cancelled then deleted");

    // ── deleted-then-cancelled reverses the other half ──────────────
    // Offline replay can deliver DELETE_BILL and CANCEL_BILL in either order. Once cancelled,
    // the assurance rule CANCELLED_BILL_STILL_IN_LEDGER requires every entry type to net to zero.
    const doomed = await sellOnCredit(shop.id, product, customer, "ldb-doomed");
    await softDeleteBill(shop.id, doomed.id, { reason: "deleted before it was cancelled" });
    assertGateGreen(await reconcile(shop.id), "credit bill deleted, pending cancel");
    await cancelBill(shop.id, doomed.id, { reason: "cancelled after deletion" });
    const afterDeleteThenCancel = await reconcile(shop.id);
    assertGateGreen(afterDeleteThenCancel, "deleted then cancelled");
    assert.deepEqual(
      await netByEntryType(shop.id, doomed.id),
      [],
      "a cancelled bill's ledger rows net to zero per entry type, however it got there",
    );
    assert.equal(
      (await db.customer.findUnique({ where: { id: customer.id } })).udharAmount,
      78,
      "cancelling reverses that bill's udhar, leaving only the earlier bill's debt",
    );
    await assertJournalBalanced(shop.id, "deleted then cancelled");

    console.log("ledger-deleted-bills.examples.js OK");
  } finally {
    // Best-effort teardown. A throw in here would mask a real assertion failure
    // from the body, which is the only error worth reading.
    for (const remove of [
      () => db.billItem.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.payment.deleteMany({ where: { bill: { shopId: shop.id } } }),
      () => db.stockLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.udharLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.bill.deleteMany({ where: { shopId: shop.id } }),
      () => db.locationStock.deleteMany({ where: { shopId: shop.id } }),
      () => db.product.deleteMany({ where: { shopId: shop.id } }),
      () => db.customer.deleteMany({ where: { shopId: shop.id } }),
      () => db.billCounter.deleteMany({ where: { shopId: shop.id } }),
      () => db.financialLedger.deleteMany({ where: { shopId: shop.id } }),
      () => db.changeLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.auditLog.deleteMany({ where: { shopId: shop.id } }),
      () => db.inventoryLot.deleteMany({ where: { shopId: shop.id } }),
      () => db.subscription.deleteMany({ where: { shopId: shop.id } }),
      () => db.storeLocation.deleteMany({ where: { shopId: shop.id } }),
      () => db.shop.delete({ where: { id: shop.id } }),
    ]) {
      await remove().catch(() => {});
    }
  }
}

await main();
