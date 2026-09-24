import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, createStaff, login, billPayload } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";
import { formatDateInTimeZone } from "../../src/utils/dates.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("furniture delivery unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  async function fixture() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    await ctx.db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType("furniture")) } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
    const input = { customerName: "QA Furniture Buyer", status: "confirmed", items: [{ productId: product.id, name: product.name, qty: 1, rate: 100 }] };
    const order = assertSuccess(await ctx.post("/api/furniture-orders", input, options), 201);
    const path = `/api/furniture-orders/${order.id}`;
    const receipt = { amount: 100, mode: "cash", clientRequestId: "qa-receipt-001", expectedPaidTotal: 0 };
    const post = async (suffix, body, status = 200) => assertSuccess(await ctx.post(path + suffix, body, options), status);
    const ready = async () => post("/status", { status: "ready" });
    const sale = async (overrides = {}) => assertSuccess(await ctx.post("/api/bills/confirm", { ...billPayload(product, { quantity: 1, customerName: input.customerName, ...overrides }), reason: "QA delivery mismatch fixture" }, options), 201);
    return { tenant, options, product, input, order, path, post, receipt, ready, sale };
  }
  test("matching bill proves delivery once, retains receipt history and does not duplicate stock or cash", async () => {
    const f = await fixture();
    await f.post("/payments", f.receipt, 201);
    await f.ready();
    assertFailure(await ctx.post(f.path + "/status", { status: "delivered" }, f.options), 409);
    const bill = await f.sale();
    const counts = { stock: await ctx.db.stockLedger.count(), financial: await ctx.db.financialLedger.count(), payments: await ctx.db.payment.count() };
    const delivered = await f.post("/status", { status: "delivered", billNumber: bill.billNo });
    assert.equal(delivered.billId, bill.id);
    assert.equal((await f.post("/status", { status: "delivered", billNumber: bill.billNo })).id, f.order.id);
    assert.equal((await f.post("/status", { status: "installed" })).status, "installed");
    assert.equal((await ctx.db.product.findUnique({ where: { id: f.product.id } })).stockBaseQty, 9);
    assert.equal(await ctx.db.stockLedger.count(), counts.stock);
    assert.equal(await ctx.db.financialLedger.count(), counts.financial + 2, "delivery applies the advance without collecting cash again");
    assert.equal(await ctx.db.payment.count(), counts.payments);
    const closing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", f.options));
    assert.deepEqual(closing.furnitureTenders, { cash: 0, upi: 0, bank: 0, other: 0 });
    assert.equal(closing.cashReceivedPaise, 10_000, "same-day receipt and application leave the bill's one cash collection");
    assert.equal((await f.post("/payments", f.receipt, 201)).payments.length, 1, "a lost receipt response can be replayed even after delivery");
    assertFailure(await ctx.post(f.path + "/payments", { ...f.receipt, clientRequestId: "qa-new-after-sale" }, f.options), 409);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: f.order.id, action: "FURNITURE_ORDER_PAYMENT_ADDED" } }), 1);
    const ledger = await ctx.db.financialLedger.groupBy({
      by: ["entryType"], where: { shopId: f.tenant.shop.id, sourceType: "furniture_order", sourceId: f.order.id }, _sum: { amountPaise: true },
    });
    assert.deepEqual(Object.fromEntries(ledger.map((entry) => [entry.entryType, Number(entry._sum.amountPaise)])), {
      furniture_advance: 0,
      furniture_cash: 0,
    });
    const journals = await ctx.db.journalEntry.findMany({ where: { shopId: f.tenant.shop.id, sourceType: "furniture_order" }, include: { lines: true } });
    assert.equal(journals.length, 2);
    assert.ok(journals.every((journal) => journal.lines.reduce((sum, line) => sum + Number(line.debitPaise), 0)
      === journal.lines.reduce((sum, line) => sum + Number(line.creditPaise), 0)));
    assertFailure(await ctx.request("DELETE", f.path, f.options), 409);
  });
  test("receipt retries bind their contents, stale devices and overpayments cannot change the balance", async () => {
    const f = await fixture();
    assertFailure(await ctx.post(f.path + "/payments", { amount: 100 }, f.options), 400);
    const receipt = { ...f.receipt, amount: 40 };
    await f.post("/payments", receipt, 201);
    await f.post("/payments", receipt, 201);
    const closing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", f.options));
    assert.deepEqual(closing.furnitureTenders, { cash: 40, upi: 0, bank: 0, other: 0 });
    assert.equal(closing.cashReceivedPaise, 4_000);
    assertFailure(await ctx.post(f.path + "/payments", { ...receipt, amount: 41 }, f.options), 409);
    assertFailure(await ctx.post(f.path + "/payments", { ...receipt, mode: "upi" }, f.options), 409);
    assertFailure(await ctx.post(f.path + "/payments", { ...receipt, clientRequestId: "stale-device-key" }, f.options), 409);
    assertFailure(await ctx.post(f.path + "/payments", { ...receipt, clientRequestId: "overpayment-key", expectedPaidTotal: 40, amount: 61 }, f.options), 409);
    const order = assertSuccess(await ctx.get(f.path, f.options));
    assert.equal(order.balanceDue, 60);
    assert.equal(order.payments.length, 1);
    assertFailure(await ctx.request("DELETE", f.path + `/payments/${order.payments[0].id}`, f.options), 409);
    assertFailure(await ctx.request("DELETE", f.path, f.options), 409);
    assertFailure(await ctx.post(f.path + "/cancel", {}, f.options), 409);
    assertFailure(await ctx.patch(f.path, { items: [{ ...f.input.items[0], rate: 39 }] }, f.options), 409);
    assert.equal((await ctx.db.furnitureOrder.findUnique({ where: { id: f.order.id } })).status, "confirmed");
  });
  test("simultaneous receipt retries persist exactly one receipt and audit", async () => {
    const f = await fixture();
    const responses = await Promise.all([ctx.post(f.path + "/payments", f.receipt, f.options), ctx.post(f.path + "/payments", f.receipt, f.options)]);
    for (const response of responses) assert.equal(assertSuccess(response, 201).paidTotal, 100);
    assert.equal(await ctx.db.furnitureOrderPayment.count({ where: { orderId: f.order.id } }), 1);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: f.order.id, action: "FURNITURE_ORDER_PAYMENT_ADDED" } }), 1);
    assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: f.order.id } }), 2);
    assert.equal(await ctx.db.journalEntry.count({ where: { shopId: f.tenant.shop.id, sourceType: "furniture_order" } }), 1);
  });
  test("concurrent receipt retries with different contents reject the losing payload", async () => {
    const f = await fixture();
    const responses = await Promise.all([40, 41].map((amount) =>
      ctx.post(f.path + "/payments", { ...f.receipt, amount }, f.options)));
    const saved = assertSuccess(responses.find((response) => response.status === 201), 201);
    assert.equal(assertFailure(responses.find((response) => response.status !== 201), 409).code, "ORDER_PAYMENT_REPLAY_MISMATCH");
    const payments = await ctx.db.furnitureOrderPayment.findMany({ where: { orderId: f.order.id } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].amount, saved.paidTotal);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: f.order.id, action: "FURNITURE_ORDER_PAYMENT_ADDED" } }), 1);
    assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: f.order.id } }), 2);
    assert.equal(await ctx.db.journalEntry.count({ where: { shopId: f.tenant.shop.id, sourceType: "furniture_order" } }), 1);
  });
  test("receipt and delivery changes roll back if mandatory audit cannot be saved", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite fault injection");
    const f = await fixture();
    const fail = async (action, operation) => {
      await ctx.db.$executeRawUnsafe(`CREATE TRIGGER qa_furniture_audit BEFORE INSERT ON AuditLog WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'forced furniture audit failure'); END`);
      try { await operation(); } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER qa_furniture_audit"); }
    };
    await fail("FURNITURE_ORDER_PAYMENT_ADDED", async () => assertFailure(await ctx.post(f.path + "/payments", f.receipt, f.options), 503));
    assert.equal(await ctx.db.furnitureOrderPayment.count({ where: { orderId: f.order.id } }), 0);
    await f.post("/payments", f.receipt, 201);
    await f.ready();
    const bill = await f.sale();
    await fail("FURNITURE_ORDER_STATUS_CHANGED", async () => assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: bill.id }, f.options), 503));
    const stored = await ctx.db.furnitureOrder.findUnique({ where: { id: f.order.id } });
    assert.equal(stored.status, "ready");
    assert.equal(stored.billId, null);
    assert.equal((await f.post("/status", { status: "delivered", billId: bill.id })).status, "delivered");
  });
  test("wrong customer, total, quantity, tender or reused bill cannot prove delivery", async () => {
    const f = await fixture();
    await f.post("/payments", f.receipt, 201);
    await f.ready();
    for (const overrides of [{ customerName: "Someone else" }, { ratePerRateUnit: 101 }, { quantity: 2, ratePerRateUnit: 50 }, { payments: [{ mode: "upi", amount: 100 }] }]) {
      const bill = await f.sale(overrides);
      assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: bill.id }, f.options), 409);
    }
    const bill = await f.sale();
    await f.post("/status", { status: "delivered", billId: bill.id });
    const other = assertSuccess(await ctx.post("/api/furniture-orders", f.input, f.options), 201);
    const path = `/api/furniture-orders/${other.id}`;
    assertSuccess(await ctx.post(path + "/payments", f.receipt, f.options), 201);
    assertSuccess(await ctx.post(path + "/status", { status: "ready" }, f.options));
    assertFailure(await ctx.post(path + "/status", { status: "delivered", billId: bill.id }, f.options), 409);
  });
  test("cancelled, returned and stockless bills cannot prove delivery or installation", async () => {
    const f = await fixture();
    await f.post("/payments", f.receipt, 201);
    await f.ready();
    const bill = await f.sale();
    await ctx.db.bill.update({ where: { id: bill.id }, data: { status: "cancelled" } });
    assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: bill.id }, f.options), 409);
    await ctx.db.bill.update({ where: { id: bill.id }, data: { status: "active" } });
    await ctx.db.stockLedger.deleteMany({ where: { billId: bill.id } });
    assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: bill.id }, f.options), 409);
    const valid = await f.sale();
    await f.post("/status", { status: "delivered", billId: valid.id });
    // A returned invoice can be produced by the ordinary sale-return flow; the
    // relation alone is enough for this delivery guard's regression fixture.
    await ctx.db.bill.create({ data: { shopId: f.tenant.shop.id, billNo: "QA-RETURN", billType: "sales_return", returnOfBillId: valid.id } });
    assertFailure(await ctx.post(f.path + "/status", { status: "installed" }, f.options), 409);
  });
  test("foreign bills and older unlinked deliveries stay protected", async () => {
    const f = await fixture();
    await f.ready();
    const other = await fixture();
    const foreignBill = await other.sale();
    assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: foreignBill.id }, f.options), 404);
    await ctx.db.furnitureOrder.update({ where: { id: f.order.id }, data: { status: "delivered" } });
    const legacy = assertSuccess(await ctx.get(f.path, f.options));
    assert.equal(legacy.needsDeliveryReview, true);
    assert.equal(legacy.canDelete, false);
    assert.equal(legacy.canReceivePayment, false);
    assertFailure(await ctx.post(f.path + "/status", { status: "installed" }, f.options), 409);
    assertFailure(await ctx.post(f.path + "/payments", f.receipt, f.options), 409);
  });

  test("dated partial refunds require the owner PIN, preserve receipts and replay exactly once", async () => {
    const f = await fixture();
    const paid = await f.post("/payments", { ...f.receipt, paidOn: "2026-06-01" }, 201);
    const path = `${f.path}/payments/${paid.payments[0].id}/adjust`;
    const refund = { kind: "refund", amount: 40, expectedPaidTotal: 100, reason: "Customer changed the order", clientRequestId: "refund-001" };
    assertFailure(await ctx.post(path, refund, { ...f.options, ownerPin: "0000" }), 403);
    const responses = await Promise.all([ctx.post(path, refund, f.options), ctx.post(path, refund, f.options)]);
    for (const response of responses) assert.equal(assertSuccess(response).paidTotal, 60);
    assert.equal(await ctx.db.furnitureOrderPayment.count({ where: { orderId: f.order.id } }), 2);
    assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: f.order.id } }), 4);
    assert.equal(await ctx.db.journalEntry.count({ where: { shopId: f.tenant.shop.id, sourceType: "furniture_order" } }), 2);
    assertFailure(await ctx.post(path, { ...refund, amount: 41 }, f.options), 409);
    assertFailure(await ctx.post(path, { ...refund, clientRequestId: "refund-002" }, f.options), 409);
    assertFailure(await ctx.post(path, { ...refund, clientRequestId: "refund-002", expectedPaidTotal: 60, amount: 61 }, f.options), 409);
    const { getDailyClosing } = await import("../../src/modules/reports/reports.service.js");
    const past = await getDailyClosing(f.tenant.shop.id, { date: "2026-06-01", locationId: f.order.locationId });
    const today = await getDailyClosing(f.tenant.shop.id, { date: formatDateInTimeZone(new Date()), locationId: f.order.locationId });
    assert.equal(past.expectedCashPaise, 10_000);
    assert.equal(today.expectedCashPaise, -4_000);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: f.order.id, action: "FURNITURE_ORDER_PAYMENT_REFUNDED" } }), 1);
    const final = assertSuccess(await ctx.post(path, { ...refund, clientRequestId: "refund-003", expectedPaidTotal: 60, amount: 60 }, f.options));
    assert.equal(final.paidTotal, 0);
    assert.equal(final.payments[0].amount, 100);
    assert.equal(final.payments[0].refundableAmount, 0);
    assert.equal((await f.post("/cancel", {})).status, "cancelled");
    assertFailure(await ctx.request("DELETE", f.path, f.options), 409);
  });

  test("corrected tender is used for the bill and zeroed old modes do not prevent delivery", async () => {
    const f = await fixture();
    const paid = await f.post("/payments", f.receipt, 201);
    const path = `${f.path}/payments/${paid.payments[0].id}/adjust`;
    const correction = { kind: "correction", amount: 100, expectedPaidTotal: 100, mode: "upi", reference: "UTR-001", reason: "Receipt was entered as cash by mistake", clientRequestId: "correction-001" };
    const responses = await Promise.all([ctx.post(path, correction, f.options), ctx.post(path, correction, f.options)]);
    for (const response of responses) assert.equal(assertSuccess(response).paidTotal, 100);
    const corrected = assertSuccess(responses[0]);
    assert.equal(corrected.paidTotal, 100);
    assert.equal(corrected.payments.length, 3);
    assert.equal(assertSuccess(await ctx.post(path, correction, f.options)).payments.length, 3);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: f.order.id, action: "FURNITURE_ORDER_PAYMENT_CORRECTED" } }), 1);
    assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: f.order.id } }), 6);
    assert.equal(await ctx.db.journalEntry.count({ where: { shopId: f.tenant.shop.id, sourceType: "furniture_order" } }), 3);
    assertFailure(await ctx.post(path, { ...correction, mode: "bank" }, f.options), 409);
    const closing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", f.options));
    assert.equal(closing.cashReceivedPaise, 0);
    assert.equal(closing.upiReceivedPaise, 10_000);
    await f.ready();
    const bill = await f.sale({ payments: [{ mode: "upi", amount: 100 }] });
    await f.post("/status", { status: "delivered", billId: bill.id });
    const final = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", f.options));
    assert.equal(final.cashReceivedPaise, 0);
    assert.equal(final.upiReceivedPaise, 10_000);
    assertFailure(await ctx.post(path, { ...correction, clientRequestId: "correction-002" }, f.options), 409);
  });

  test("refund audit failure rolls back the adjustment, financial ledger and journal together", async () => {
    const f = await fixture();
    const paid = await f.post("/payments", f.receipt, 201);
    const ledgerBefore = await ctx.db.financialLedger.count();
    const journalsBefore = await ctx.db.journalEntry.count();
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER qa_furniture_refund BEFORE INSERT ON AuditLog WHEN NEW.action = 'FURNITURE_ORDER_PAYMENT_REFUNDED' BEGIN SELECT RAISE(ABORT, 'forced refund audit failure'); END`);
    try {
      assertFailure(await ctx.post(`${f.path}/payments/${paid.payments[0].id}/adjust`, { kind: "refund", amount: 100, expectedPaidTotal: 100, reason: "Cancelled by customer", clientRequestId: "refund-rollback-001" }, f.options), 503);
      assert.equal((await ctx.db.furnitureOrderPayment.count({ where: { orderId: f.order.id } })), 1);
      assert.equal(await ctx.db.financialLedger.count(), ledgerBefore);
      assert.equal(await ctx.db.journalEntry.count(), journalsBefore);
    } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER qa_furniture_refund"); }
  });

  test("legacy unposted receipts cannot manufacture negative liability on delivery or refund", async () => {
    const f = await fixture();
    const old = await ctx.db.furnitureOrderPayment.create({ data: { orderId: f.order.id, amount: 100, mode: "cash", paidOn: new Date() } });
    await f.ready();
    const bill = await f.sale();
    assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: bill.id }, f.options), 409);
    assertFailure(await ctx.post(`${f.path}/payments/${old.id}/adjust`, { kind: "refund", amount: 100, expectedPaidTotal: 100, reason: "Legacy review", clientRequestId: "legacy-refund-001" }, f.options), 409);
    assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: f.order.id } }), 0);
  });

  test("branch assignments protect product lookups, direct actions and reservations", async () => {
    const f = await fixture();
    const branch = await ctx.db.storeLocation.create({ data: { shopId: f.tenant.shop.id, code: "BRANCH", name: "Branch showroom" } });
    const { staff, staffPassword } = await createStaff(ctx.db, f.tenant.shop.id);
    await ctx.db.userLocationAccess.create({ data: { shopId: f.tenant.shop.id, userId: staff.id, locationId: branch.id, canSell: true } });
    const auth = await login(ctx, staff.mobile, staffPassword);
    const options = { token: auth.accessToken, headers: { "x-location-id": branch.id } };
    assertFailure(await ctx.get(f.path, options), 403);
    assertFailure(await ctx.post(f.path + "/payments", f.receipt, options), 403);
    assert.deepEqual(assertSuccess(await ctx.get(`/api/furniture-orders/for-product/${f.product.id}`, options)), []);
    assert.deepEqual(assertSuccess(await ctx.get("/api/furniture-orders/reservations", options)), {});
    assertFailure(await ctx.post("/api/furniture-orders", f.input, options), 409, "global stock cannot be promised by an empty branch");
    await f.post("/payments", f.receipt, 201);
    await f.ready();
    const bill = await f.sale();
    await ctx.db.bill.update({ where: { id: bill.id }, data: { locationId: branch.id } });
    assertFailure(await ctx.post(f.path + "/status", { status: "delivered", billId: bill.id }, f.options), 409);
  });

  test("credit recovery links an existing customer receipt, updates all order views and reverses cleanly", async () => {
    const f = await fixture();
    const customer = assertSuccess(await ctx.post("/api/customers", { name: f.input.customerName, type: "udhar" }, f.options), 201);
    await f.post("/payments", { ...f.receipt, amount: 40 }, 201);
    await f.ready();
    const bill = await f.sale({ customerId: customer.id, buyerPaidAmount: 40, payments: [{ mode: "cash", amount: 40 }, { mode: "credit", amount: 60 }] });
    await f.post("/status", { status: "delivered", billId: bill.id });
    const collection = assertSuccess(await ctx.post(`/api/customers/${customer.id}/udhar-payment`, { amount: 60, mode: "upi", idempotencyKey: "furniture-credit-001" }, f.options));
    const counts = { ledger: await ctx.db.financialLedger.count(), journal: await ctx.db.journalEntry.count() };
    const candidates = assertSuccess(await ctx.get(f.path + "/collections", f.options));
    assert.equal(candidates.order.balanceDue, 60, "customer-wide recovery does not silently pick an order");
    assert.equal(candidates.payments[0].id, collection.ledgerEntryId);
    const path = `${f.path}/collections/${collection.ledgerEntryId}/link`;
    const input = { expectedPaidTotal: 40, reason: "Customer confirmed this payment is for this invoice" };
    assertFailure(await ctx.post(path, input, { ...f.options, ownerPin: "0000" }), 403);
    for (const response of await Promise.all([ctx.post(path, input, f.options), ctx.post(path, input, f.options)])) {
      const result = assertSuccess(response);
      assert.equal(result.balanceDue, 0);
      assert.equal(result.paidTotal, 100);
    }
    assert.equal(await ctx.db.financialLedger.count(), counts.ledger);
    assert.equal(await ctx.db.journalEntry.count(), counts.journal);
    assert.equal(assertSuccess(await ctx.get(f.path, f.options)).balanceDue, 0);
    assert.equal(assertSuccess(await ctx.get("/api/furniture-orders/summary", f.options)).pendingCollection, 0);
    assertSuccess(await ctx.post(`/api/customers/${customer.id}/udhar-payment/${collection.ledgerEntryId}/reverse`, { reason: "UPI payment failed settlement" }, f.options));
    assert.equal(assertSuccess(await ctx.get(f.path, f.options)).balanceDue, 60);
    assert.equal(assertSuccess(await ctx.get("/api/furniture-orders/summary", f.options)).pendingCollection, 60);
  });

  test("delivery applies old advances on the bill date, with no collection on the later confirmation day", async () => {
    const f = await fixture();
    await f.post("/payments", { ...f.receipt, paidOn: "2026-06-01" }, 201);
    await f.ready();
    const bill = await f.sale();
    const saleDate = new Date("2026-06-02T10:00:00Z");
    await ctx.db.bill.update({ where: { id: bill.id }, data: { businessDate: saleDate } });
    await ctx.db.financialLedger.updateMany({ where: { billId: bill.id }, data: { businessDate: saleDate } });
    await f.post("/status", { status: "delivered", billId: bill.id });
    const { getDailyClosing } = await import("../../src/modules/reports/reports.service.js");
    const old = await getDailyClosing(f.tenant.shop.id, { date: "2026-06-01", locationId: f.order.locationId });
    const sold = await getDailyClosing(f.tenant.shop.id, { date: "2026-06-02", locationId: f.order.locationId });
    const today = await getDailyClosing(f.tenant.shop.id, { date: formatDateInTimeZone(new Date()), locationId: f.order.locationId });
    assert.equal(old.expectedCashPaise, 10_000);
    assert.equal(sold.expectedCashPaise, 0);
    assert.equal(today.expectedCashPaise, 0);
    assert.equal(sold.totalSalesPaise, 10_000);
  });

  test("bank reconciliation matches the actual advance and refuses its repeated invoice tender", async () => {
    const f = await fixture();
    await f.post("/payments", { ...f.receipt, mode: "upi" }, 201);
    await f.ready();
    const bill = await f.sale({ payments: [{ mode: "upi", amount: 100 }] });
    await f.post("/status", { status: "delivered", billId: bill.id });
    const original = await ctx.db.financialLedger.findFirst({ where: { sourceId: f.order.id, entryType: "furniture_upi", amountPaise: 10_000n } });
    const invoice = await ctx.db.financialLedger.findFirst({ where: { billId: bill.id, sourceType: "bill", entryType: "upi_in" } });
    const day = formatDateInTimeZone(new Date());
    assertSuccess(await ctx.post("/api/accounting/bank-statements/import", {
      accountType: "upi", accountName: "QA UPI", fileName: "qa-furniture.csv",
      csvText: `Date,Description,Reference,Debit,Credit\n${day},Furniture advance,QA-ADV,,100.00`,
    }, f.options), 201);
    const view = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", f.options));
    const transaction = view.transactions[0];
    assert.deepEqual(transaction.suggestions.map((row) => row.ledgerRowId), [original.id]);
    assertFailure(await ctx.post(`/api/accounting/bank-transactions/${transaction.id}/match`, { ledgerRowIds: [invoice.id] }, f.options), 409);
    assertSuccess(await ctx.post(`/api/accounting/bank-transactions/${transaction.id}/match`, { ledgerRowIds: [original.id] }, f.options), 201);
    const payments = assertSuccess(await ctx.get(`/api/furniture-orders/payments?from=${day}&to=${day}`, f.options));
    assert.equal(payments.length, 2);
    assert.equal(payments.reduce((sum, payment) => sum + payment.amount, 0), 0, "statement adjustment offsets the invoice tender");
  });

  test("a closed accounting period blocks backdated receipts with no partial financial history", async () => {
    const f = await fixture();
    await ctx.db.accountingPeriod.create({ data: { shopId: f.tenant.shop.id, name: "Closed June", startsAt: new Date("2026-05-31"), endsAt: new Date("2026-07-01"), status: "closed" } });
    assertFailure(await ctx.post(f.path + "/payments", { ...f.receipt, paidOn: "2026-06-01" }, f.options), 409);
    assert.equal(await ctx.db.furnitureOrderPayment.count({ where: { orderId: f.order.id } }), 0);
    assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: f.order.id } }), 0);
  });
}
