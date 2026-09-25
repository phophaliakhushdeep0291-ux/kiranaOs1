import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";
import { formatDateInTimeZone } from "../../src/utils/dates.js";

/**
 * Opening the historical receipts on a legacy furniture order.
 *
 * An order taken before receipts reached the journal holds money the accounts
 * have no record of — SO-000001 is the standing example: ₹120 received, no
 * linked bill, catalogue stock untouched. `requireFurnitureAccounting` refuses
 * to invoice, refund or correct such an order, which is right, but left it
 * frozen with no way out. This is the way out, and what it must not do is as
 * important as what it must:
 *
 *   - it may not open a receipt on the owner's word alone. The amount and tender
 *     are restated and compared, so a confirmation nobody read is refused.
 *   - it may not post the opening rows on TODAY. The money moved on the receipt's
 *     own date, and dating it now would drop historical cash into tonight's
 *     drawer and make a closing that was already counted disagree with the till.
 *   - it may not half-open an order. Confirming some receipts and not others
 *     would report success while the order stayed frozen.
 */

const ctx = await createIntegrationContext();
if (ctx.skip) test("furniture history reconciliation unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));

  /** An order whose receipt exists but whose ledger history does not — a legacy row. */
  async function legacyOrder({ paidOn = "2026-06-01", amount = 120, receiptAmount = null, extraReceipt = null } = {}) {
    const firstReceipt = receiptAmount ?? amount;
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    const shopId = tenant.shop.id;
    await ctx.db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(settingsForBusinessType("furniture")) } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    const product = await createProduct(ctx.db, shopId, { name: "Teak Wardrobe", stockBaseQty: 10, defaultPricePerRateUnit: amount });

    const order = assertSuccess(await ctx.post("/api/furniture-orders", {
      customerName: "Legacy Buyer", customerPhone: "9876500011", status: "confirmed",
      items: [{ productId: product.id, name: product.name, qty: 1, rate: amount }],
    }, options), 201);
    const path = `/api/furniture-orders/${order.id}`;
    assertSuccess(await ctx.post(`${path}/payments`, {
      clientRequestId: "legacy-receipt-001", amount: firstReceipt, mode: "cash", expectedPaidTotal: 0, paidOn,
    }, options), 201);

    if (extraReceipt) {
      assertSuccess(await ctx.post(`${path}/payments`, {
        clientRequestId: "legacy-receipt-002", expectedPaidTotal: firstReceipt, ...extraReceipt,
      }, options), 201);
    }

    // Strip the journal history the modern path wrote. What is left is exactly
    // the shape a pre-journal order has on disk: a receipt on the order, nothing
    // in the ledger to back it.
    await ctx.db.financialLedger.deleteMany({
      where: { shopId, sourceType: "furniture_order", sourceId: order.id },
    });
    // The journal entry goes too. An order that predates the journal has no row
    // in either place, and leaving one behind would make the fixture a
    // half-migrated order rather than a legacy one.
    await ctx.db.journalEntry.deleteMany({ where: { shopId, sourceType: "furniture_order" } });

    const payment = await ctx.db.furnitureOrderPayment.findFirst({ where: { orderId: order.id } });
    return { tenant, shopId, options, product, order, path, payment, amount: firstReceipt };
  }

  test("a legacy order is frozen, and says which receipt is unbacked", async () => {
    const f = await legacyOrder();

    // The freeze is on money, not on movement — "ready" is a shop-floor step and
    // is allowed. What an unbacked receipt stops is invoicing it, which is the
    // step that would recognise revenue against cash the accounts never saw.
    assertSuccess(await ctx.post(`${f.path}/status`, { status: "ready" }, f.options));
    const refusal = assertFailure(await ctx.get(`${f.path}/invoice-preview`, f.options), 409);
    assert.equal(refusal.code, "ORDER_LEGACY_FINANCE_REVIEW", "an unbacked receipt must not be invoiceable");

    // Named, not counted: the owner is asked to restate these figures, which
    // cannot be done against a boolean.
    const detail = assertSuccess(await ctx.get(f.path, f.options));
    assert.equal(detail.needsHistoryReconciliation, true);
    assert.equal(detail.unreconciledReceipts.length, 1);
    assert.equal(detail.unreconciledReceipts[0].amount, f.amount);
    assert.equal(detail.unreconciledReceipts[0].mode, "cash");
  });

  test("a restatement that disagrees with the receipt is refused", async () => {
    const f = await legacyOrder();

    const wrongAmount = assertFailure(await ctx.post(`${f.path}/reconcile-history`, {
      receipts: [{ paymentId: f.payment.id, amount: 999, mode: "cash" }], reason: "Opening balance review",
    }, f.options), 409);
    assert.equal(wrongAmount.code, "ORDER_HISTORY_MISMATCH");

    const wrongMode = assertFailure(await ctx.post(`${f.path}/reconcile-history`, {
      receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "upi" }], reason: "Opening balance review",
    }, f.options), 409);
    assert.equal(wrongMode.code, "ORDER_HISTORY_MISMATCH", "the tender is part of what is being confirmed");

    // Still frozen — a refused confirmation must change nothing.
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId, sourceType: "furniture_order" } }), 0);
  });

  test("every unbacked receipt must be confirmed in one request", async () => {
    const f = await legacyOrder({ receiptAmount: 90, extraReceipt: { amount: 30, mode: "upi", paidOn: "2026-06-02" } });

    const partial = assertFailure(await ctx.post(`${f.path}/reconcile-history`, {
      receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Opening balance review",
    }, f.options), 409);
    assert.equal(partial.code, "ORDER_HISTORY_INCOMPLETE", "half an order's history is not an opening balance");
  });

  test("opening the receipt dates it back, and unfreezes the order", async () => {
    const f = await legacyOrder({ paidOn: "2026-06-01" });

    const reconciled = assertSuccess(await ctx.post(`${f.path}/reconcile-history`, {
      receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }],
      reason: "Opening balance reviewed against the receipt book",
    }, f.options));
    assert.equal(reconciled.needsHistoryReconciliation, false);
    assert.equal(reconciled.unreconciledReceipts.length, 0);

    // THE assertion this workflow exists for. The rows carry the receipt's own
    // date, not today's: posting them now would move June's cash into tonight's
    // drawer and make a counted closing disagree with the till.
    const rows = await ctx.db.financialLedger.findMany({
      where: { shopId: f.shopId, sourceType: "furniture_order", sourceId: f.order.id },
    });
    assert.equal(rows.length, 2, "a receipt opens as its tender row and its advance row");
    for (const row of rows) {
      assert.equal(formatDateInTimeZone(row.businessDate), "2026-06-01",
        "opening history belongs to the day the money actually moved, read in the shop's timezone");
      assert.equal(row.amountPaise, BigInt(f.amount * 100));
    }
    assert.deepEqual(
      rows.map((row) => row.entryType).sort(),
      ["furniture_advance", "furniture_cash"],
      "the same two rows the modern receipt path writes, so the guard can recognise them",
    );

    // The audit is what makes this reviewable afterwards.
    const audit = await ctx.db.auditLog.findFirst({
      where: { shopId: f.shopId, action: "FURNITURE_ORDER_HISTORY_RECONCILED", entityId: f.order.id },
    });
    assert.ok(audit, "opening historical money must leave an audit record");
    assert.match(JSON.parse(audit.metadataJson).reason, /receipt book/);

    // And the order can now finish the journey it was stuck on.
    assertSuccess(await ctx.post(`${f.path}/status`, { status: "ready" }, f.options));
    const review = assertSuccess(await ctx.get(`${f.path}/invoice-preview`, f.options));
    const invoiced = assertSuccess(await ctx.post(`${f.path}/invoice`, {
      previewToken: review.previewToken, taxMode: "none", reason: "Goods loaded and delivery confirmed",
      taxes: review.lines.map(({ lineId, gstRate, hsn }) => ({ lineId, gstRate, ...(hsn ? { hsn } : {}) })),
    }, f.options), 201);
    assert.equal(invoiced.status, "delivered");
    assert.ok(invoiced.billId, "the frozen order now carries the bill it was missing");
  });

  test("a replayed confirmation is the same opening, not a second one", async () => {
    const f = await legacyOrder();
    const body = {
      receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Opening balance review",
    };
    assertSuccess(await ctx.post(`${f.path}/reconcile-history`, body, f.options));
    assertSuccess(await ctx.post(`${f.path}/reconcile-history`, body, f.options));

    assert.equal(
      await ctx.db.financialLedger.count({ where: { shopId: f.shopId, sourceType: "furniture_order", sourceId: f.order.id } }),
      2,
      "a retry after a lost response must not open the same receipt twice",
    );
  });

  test("opening historical money needs the owner PIN", async () => {
    const f = await legacyOrder();
    const refused = assertFailure(await ctx.post(`${f.path}/reconcile-history`, {
      receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Opening balance review",
    }, { token: f.options.token }), 403);
    assert.match(String(refused.code), /FORBIDDEN|OWNER_PIN/, "the PIN middleware refuses before the service is reached");
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId, sourceType: "furniture_order" } }), 0);
  });
  test("a changed replay is rejected without changing history", async () => {
    const f = await legacyOrder();
    const body = { receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Receipt book checked" };
    assertSuccess(await ctx.post(`${f.path}/reconcile-history`, body, f.options));
    body.receipts[0].amount = 1;
    assert.equal(assertFailure(await ctx.post(`${f.path}/reconcile-history`, body, f.options), 409).code, "ORDER_HISTORY_MISMATCH");
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId } }), 2);
  });

  test("partial journal history is refused without appending anything", async () => {
    const f = await legacyOrder();
    await ctx.db.financialLedger.create({ data: {
      shopId: f.shopId, sourceType: "furniture_order", sourceId: f.order.id,
      entryType: "furniture_cash", direction: "debit", amountPaise: 12000n,
      businessDate: f.payment.paidOn, paymentMode: "cash",
      idempotencyKey: `furniture:${f.order.id}:receipt:${f.payment.id}:furniture_cash`,
    } });
    const body = { receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Receipt book checked" };
    assert.equal(assertFailure(await ctx.post(`${f.path}/reconcile-history`, body, f.options), 409).code, "ORDER_HISTORY_PARTIAL");
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId } }), 1);
  });

  test("a closed accounting period cannot be rewritten", async () => {
    const f = await legacyOrder();
    await ctx.db.accountingPeriod.create({ data: { shopId: f.shopId, name: "Closed June", startsAt: new Date("2026-05-31"), endsAt: new Date("2026-07-01"), status: "closed" } });
    const body = { receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Receipt book checked" };
    assert.equal(assertFailure(await ctx.post(`${f.path}/reconcile-history`, body, f.options), 409).code, "ACCOUNTING_PERIOD_CLOSED");
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId } }), 0);
    assert.equal(await ctx.db.auditLog.count({ where: { shopId: f.shopId, action: "FURNITURE_ORDER_HISTORY_RECONCILED" } }), 0);
  });

  test("installed legacy order gets one reviewed historical invoice without changing delivery dates", async () => {
    const f = await legacyOrder();
    const deliveredAt = new Date("2026-06-03T08:00:00Z");
    const installedAt = new Date("2026-06-04T08:00:00Z");
    await ctx.db.furnitureOrder.update({ where: { id: f.order.id }, data: { status: "installed", deliveredAt, installedAt, locationId: null } });
    const receiptBody = { receipts: [{ paymentId: f.payment.id, amount: f.amount, mode: "cash" }], reason: "Original receipt book reviewed" };
    assertSuccess(await ctx.post(`${f.path}/reconcile-history`, receiptBody, f.options));
    const review = assertSuccess(await ctx.get(`${f.path}/invoice-preview`, f.options));
    assert.equal(review.legacyDelivery, true);
    const input = { previewToken: review.previewToken, taxMode: "none", reason: "No invoice or prior stock deduction exists",
      taxes: review.lines.map(({ lineId, gstRate }) => ({ lineId, gstRate })) };
    assert.equal(assertFailure(await ctx.post(`${f.path}/invoice`, input, f.options), 409).code, "ORDER_LEGACY_STOCK_REVIEW");
    input.legacyStockConfirmed = true;
    input.businessDate = "2026-06-03";
    const invoice = assertSuccess(await ctx.post(`${f.path}/invoice`, input, f.options), 201);
    assert.equal(invoice.status, "installed");
    assert.equal(invoice.deliveredAt, deliveredAt.toISOString());
    assert.equal(invoice.installedAt, installedAt.toISOString());
    assert.ok(invoice.billId);
    const bill = await ctx.db.bill.findUnique({ where: { id: invoice.billId } });
    assert.equal(formatDateInTimeZone(bill.businessDate), "2026-06-03");
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.product.id } })).stockBaseQty, 9);
    assertSuccess(await ctx.post(`${f.path}/invoice`, input, f.options), 201);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 1);
    assert.equal(await ctx.db.stockLedger.count({ where: { shopId: f.shopId, action: "sale" } }), 1);
    const paidDay = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live&date=2026-06-01", f.options));
    const saleDay = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live&date=2026-06-03", f.options));
    assert.equal(paidDay.expectedCashPaise, 12000);
    assert.equal(saleDay.expectedCashPaise, 0);
    assert.equal(saleDay.totalSalesPaise, 12000);
  });

}
