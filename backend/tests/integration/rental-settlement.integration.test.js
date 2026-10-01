import { formatDateInTimeZone } from "../../src/utils/dates.js";
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, createStaff, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("rental settlement unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));

  async function fixture() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    await ctx.db.shop.update({ where: { id: tenant.shop.id }, data: { settingsJson: JSON.stringify(settingsForBusinessType("clothing")) } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken };
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
    const day = formatDateInTimeZone(new Date());
    const input = {
      customerName: "QA Renter", customerPhone: "9999999991", customerAddress: "QA address",
      fromDate: day, toDate: day, items: [{ productId: product.id, name: product.name, qty: 1, amount: 100 }],
      rentAmount: 100, advancePaid: 100, depositAmount: 200, paymentMode: "cash", clientRequestId: `rental-${Date.now()}-${Math.random()}`,
    };
    const rental = assertSuccess(await ctx.post("/api/rentals", input, options), 201);
    return { tenant, options, product, rental, input };
  }
  const payment = { expectedAdvancePaid: 100, amount: 10, paymentMode: "upi", reference: "QA-collection" };

  test("returned rental can be settled once with an auditable collection and no stock change", async () => {
    const { tenant, options, product, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertFailure(await ctx.post(`${path}/settle`, payment, options), 409);
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, amount: 11 }, options), 409);
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, expectedAdvancePaid: 99 }, options), 409);
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, amount: -10 }, options), 400);
    const settled = assertSuccess(await ctx.post(`${path}/settle`, payment, options));
    assert.equal(settled.balanceDue, 0);
    assert.equal(settled.advancePaid, 110);
    assert.equal(settled.depositAmount, 200);
    assert.equal(settled.status, "returned");
    assert.equal(assertSuccess(await ctx.post(`${path}/settle`, payment, options)).balanceDue, 0);
    const audits = await ctx.db.auditLog.findMany({ where: { shopId: tenant.shop.id, entityId: rental.id, action: "RENTAL_BALANCE_COLLECTED" } });
    assert.equal(audits.length, 1);
    assert.equal(JSON.parse(audits[0].metadataJson).amount, 10);
    assert.equal(JSON.parse(audits[0].metadataJson).paymentMode, "upi");
    assert.equal(audits[0].userId, tenant.owner.id);
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 5);
    assert.equal(assertSuccess(await ctx.get("/api/rentals/summary", options)).pendingCollection, 0);
    const other = await fixture();
    assertFailure(await ctx.post(`${path}/settle`, payment, other.options), 404);
  });

  test("collection rolls back when its mandatory audit cannot be written", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite fault injection");
    const { options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER fail_rental_collection_audit BEFORE INSERT ON AuditLog
      WHEN NEW.action = 'RENTAL_BALANCE_COLLECTED' BEGIN SELECT RAISE(ABORT, 'forced rental audit failure'); END`);
    try {
      assertFailure(await ctx.post(`${path}/settle`, payment, options), 503);
      assert.equal(assertSuccess(await ctx.get(path, options)).balanceDue, 10);
    } finally {
      await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_rental_collection_audit");
    }
  });

  test("simultaneous final collections cannot double-charge the balance", async () => {
    const { options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    const responses = await Promise.all([ctx.post(`${path}/settle`, payment, options), ctx.post(`${path}/settle`, payment, options)]);
    for (const response of responses) assert.equal(assertSuccess(response).advancePaid, 110);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: rental.id, action: "RENTAL_BALANCE_COLLECTED" } }), 1);
  });
  test("booking, return, collection and protected refund reconcile journals, stock and cash exactly once", async () => {
    const { tenant, options, product, rental, input } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    const day = rental.fromDateKey;
    const closing = async () => assertSuccess(await ctx.get(`/api/reports/daily-closing?date=${day}&source=live`, options));
    assert.equal(assertSuccess(await ctx.post("/api/rentals", input, options), 201).id, rental.id);
    assertFailure(await ctx.post("/api/rentals", { ...input, depositAmount: 201 }, options), 409);
    assert.equal((await closing()).cashReceivedPaise, 30000);
    assert.equal((await closing()).totalSalesPaise, 0, "deposits and advances are not retail sales");
    assertFailure(await ctx.patch(path, { advancePaid: 0 }, options), 409);
    assertFailure(await ctx.delete(path, options), 409);
    assertSuccess(await ctx.post(`${path}/pickup`, {}, options));
    assertFailure(await ctx.post(`${path}/cancel`, {}, options), 409);
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    assertFailure(await ctx.post(`${path}/return`, { damageCharge: 20 }, options), 409);
    assertSuccess(await ctx.post(`${path}/settle`, payment, options));
    assertFailure(await ctx.post(`${path}/settle`, { ...payment, paymentMode: "cash" }, options), 409);
    const refund = { amount: 200, paymentMode: "cash", reason: "Items returned intact" };
    assertFailure(await ctx.post(`${path}/refund`, refund, { ...options, ownerPin: "0000" }), 403);
    const approved = { ...options, ownerPin: tenant.ownerPin };
    const results = await Promise.all([ctx.post(`${path}/refund`, refund, approved), ctx.post(`${path}/refund`, refund, approved)]);
    for (const result of results) assert.equal(assertSuccess(result).depositHeld, 0);
    assertFailure(await ctx.post(`${path}/refund`, { ...refund, paymentMode: "upi" }, approved), 409);
    assertFailure(await ctx.delete(path, options), 409);
    const report = await closing();
    const statement = assertSuccess(await ctx.get(`/api/rentals/payments?from=${day}&to=${day}`, options));
    assert.equal(statement.length, 3);
    assert.deepEqual(statement.map((row) => row.amount).sort((a, b) => a - b), [-200, 10, 300]);
    assert.equal(report.expectedCashPaise, 10000);
    assert.deepEqual(report.rentalTenders, { cash: 100, upi: 10, bank: 0, other: 0 });
    assert.equal(assertSuccess(await ctx.get("/api/rentals/summary", options)).depositHeld, 0);
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 5);
    const journals = await ctx.db.journalEntry.findMany({ where: { shopId: tenant.shop.id, sourceType: "rental" }, include: { lines: true } });
    assert.equal(journals.length, 4);
    for (const journal of journals) assert.equal(journal.lines.reduce((sum, line) => sum + line.debitPaise - line.creditPaise, 0n), 0n);
    const events = await ctx.db.financialLedger.findMany({ where: { sourceId: rental.id } });
    for (const row of events) assert.equal(row.direction, ["rental_advance", "rental_deposit", "rental_income"].includes(row.entryType) ? "credit" : "debit");
    const ledger = await ctx.db.financialLedger.groupBy({ by: ["entryType"], where: { shopId: tenant.shop.id, sourceType: "rental" }, _sum: { amountPaise: true } });
    const totals = Object.fromEntries(ledger.map((row) => [row.entryType, row._sum.amountPaise]));
    assert.equal(totals.rental_income, 11000n);
    assert.equal(totals.rental_deposit, 0n);
    assert.equal(totals.rental_advance, 0n);
    assert.equal(totals.rental_receivable, 0n);
  });

  test("UPI statement matching includes rental collection and refunds with their signed amounts", async () => {
    const { tenant, options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    assertSuccess(await ctx.post(`${path}/settle`, payment, options));
    assertSuccess(await ctx.post(`${path}/refund`, { amount: 200, paymentMode: "upi", reason: "Deposit returned" }, { ...options, ownerPin: tenant.ownerPin }));
    assertSuccess(await ctx.post("/api/accounting/bank-statements/import", {
      accountType: "upi", accountName: "QA rental UPI", fileName: "rental.csv",
      csvText: `Date,Description,Reference,Debit,Credit\n${rental.fromDateKey},Rental fee,QA-collection,,10.00\n${rental.fromDateKey},Rental deposit refund,QA-refund,200.00,`,
    }, { ...options, ownerPin: tenant.ownerPin }), 201);
    const view = assertSuccess(await ctx.get("/api/accounting/bank-reconciliation", options));
    assert.equal(view.transactions.length, 2);
    for (const transaction of view.transactions) {
      assert.equal(transaction.suggestions.length, 1);
      const matched = assertSuccess(await ctx.post(`/api/accounting/bank-transactions/${transaction.id}/match`, {
        ledgerRowIds: [transaction.suggestions[0].ledgerRowId], note: "QA rental receipt / refund verified",
      }, { ...options, ownerPin: tenant.ownerPin }), 201);
      assert.equal(matched.matchStatus, "matched");
    }
  });

  test("cancellation preserves received cash until refund and replay survives later settlement", async () => {
    const { tenant, options, rental, input } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    assertSuccess(await ctx.post(`${path}/cancel`, { reason: "Event cancelled" }, options));
    const cancelled = assertSuccess(await ctx.get(path, options));
    assert.equal(cancelled.balanceDue, 0);
    assert.equal(cancelled.depositHeld, 200);
    assert.equal(assertSuccess(await ctx.get("/api/rentals/summary", options)).depositHeld, 200);
    const result = assertSuccess(await ctx.post(`${path}/refund`, { amount: 300, paymentMode: "upi", reason: "Full cancellation refund" }, { ...options, ownerPin: tenant.ownerPin }));
    assert.equal(result.advancePaid, 0);
    assert.equal(result.depositHeld, 0);
    assert.equal(assertSuccess(await ctx.post("/api/rentals", input, options), 201).id, rental.id);
    assert.equal(await ctx.db.rentalBooking.count({ where: { shopId: tenant.shop.id } }), 1);
    const report = assertSuccess(await ctx.get(`/api/reports/daily-closing?date=${rental.fromDateKey}&source=live`, options));
    assert.deepEqual(report.rentalTenders, { cash: 300, upi: -300, bank: 0, other: 0 });
  });

  test("refund belongs to its actual day; rental postings invalidate earlier closing snapshots", async () => {
    const { tenant, options, rental } = await fixture();
    const { getDailyClosing } = await import("../../src/modules/reports/reports.service.js");
    const { getSnapshotStaleness } = await import("../../src/modules/reports/dailyClosingSnapshot.service.js");
    const path = `/api/rentals/${rental.id}`;
    await ctx.db.financialLedger.updateMany({ where: { sourceId: rental.id }, data: { businessDate: new Date("2026-06-01T10:00:00Z") } });
    assertSuccess(await ctx.post(`${path}/cancel`, {}, options));
    assertSuccess(await ctx.post(`${path}/refund`, { amount: 300, paymentMode: "cash", reason: "Refund today" }, { ...options, ownerPin: tenant.ownerPin }));
    assert.equal((await getDailyClosing(tenant.shop.id, { date: "2026-06-01", locationId: rental.locationId })).expectedCashPaise, 30000);
    assert.equal((await getDailyClosing(tenant.shop.id, { date: rental.fromDateKey, locationId: rental.locationId })).expectedCashPaise, -30000);
    assert.equal((await getSnapshotStaleness(tenant.shop.id, rental.fromDateKey, { generatedAt: new Date("2026-01-01"), storeId: rental.locationId })).stale, true);
  });

  test("legacy payments are never inferred; missing refund audit rolls back all money changes", async (t) => {
    const { tenant, options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    await ctx.db.rentalBooking.update({ where: { id: rental.id }, data: { financialVersion: 0 } });
    assertFailure(await ctx.post(`${path}/return`, {}, options), 409);
    assertFailure(await ctx.post(`${path}/cancel`, {}, options), 409);
    assert.equal(assertSuccess(await ctx.get(path, options)).depositHeld, null);
    await ctx.db.rentalBooking.update({ where: { id: rental.id }, data: { financialVersion: 1 } });
    assertSuccess(await ctx.post(`${path}/return`, {}, options));
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite audit fault injection");
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER fail_rental_refund_audit BEFORE INSERT ON AuditLog
      WHEN NEW.action = 'RENTAL_REFUNDED' BEGIN SELECT RAISE(ABORT, 'forced refund audit failure'); END`);
    try {
      assertFailure(await ctx.post(`${path}/refund`, { amount: 200, paymentMode: "cash", reason: "Rollback proof" }, { ...options, ownerPin: tenant.ownerPin }), 503);
      assert.equal(assertSuccess(await ctx.get(path, options)).depositHeld, 200);
      assert.equal(await ctx.db.financialLedger.count({ where: { sourceId: rental.id, idempotencyKey: { contains: ":refunded:" } } }), 0);
    } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_rental_refund_audit"); }
  });

  test("another branch cannot expose or mutate a rental by guessing its id", async () => {
    const { tenant, rental } = await fixture();
    const location = await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, code: "BRANCH", name: "Other branch", isPrimary: false } });
    const { staff, staffPassword } = await createStaff(ctx.db, tenant.shop.id);
    await ctx.db.userLocationAccess.create({ data: { shopId: tenant.shop.id, userId: staff.id, locationId: location.id, canSell: true } });
    const auth = await login(ctx, staff.mobile, staffPassword);
    const options = { token: auth.accessToken, headers: { "x-location-id": location.id } };
    assertFailure(await ctx.get(`/api/rentals/${rental.id}`, options), 403);
    assertFailure(await ctx.post(`/api/rentals/${rental.id}/pickup`, {}, options), 403);
    assert.deepEqual(assertSuccess(await ctx.get("/api/rentals", options)), []);
    assert.deepEqual(assertSuccess(await ctx.get(`/api/rentals/payments?from=${rental.fromDateKey}&to=${rental.toDateKey}`, options)), []);
    await ctx.db.rentalBooking.update({ where: { id: rental.id }, data: { financialVersion: 0, locationId: null } });
    assertFailure(await ctx.get(`/api/rentals/${rental.id}`, options), 403);
    assert.deepEqual(assertSuccess(await ctx.get("/api/rentals", options)), []);
  });

}
