import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, login, activateDeviceViaApi } from "./factories.js";
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
    const device = await activateDeviceViaApi(ctx, auth.accessToken, { deviceId: `rental-device-${tenant.shop.id}` });
    const options = { token: auth.accessToken, headers: { "x-device-id": device.deviceId } };
    const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
    const day = new Date().toISOString().slice(0, 10);
    const input = {
      customerName: "QA Renter", customerPhone: "9999999991", customerAddress: "QA address",
      fromDate: day, toDate: day, items: [{ productId: product.id, name: product.name, qty: 1, amount: 100 }],
      rentAmount: 100, advancePaid: 100, depositAmount: 200, paymentMode: "cash", clientRequestId: `rental-${tenant.shop.id}`,
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
  test("booking, return, collection and owner refund reconcile the journal and daily cash without duplicate money", async () => {
    const { tenant, options, product, rental, input } = await fixture();
    const id = rental.id, path = `/api/rentals/${id}`;
    assert.equal(assertSuccess(await ctx.post("/api/rentals", input, options), 201).id, id);
    assert.equal(await ctx.db.rentalBooking.count({ where: { shopId: tenant.shop.id } }), 1);
    assert.equal(await ctx.db.auditLog.count({ where: { entityId: id, action: "RENTAL_BOOKED" } }), 1);
    assertFailure(await ctx.post("/api/rentals", { ...input, rentAmount: 101 }, options), 409);
    assertFailure(await ctx.patch(path, { advancePaid: 90 }, options), 409);
    assertFailure(await ctx.patch(path, { depositAmount: 0 }, options), 409);
    const day = (await import("../../src/utils/dates.js")).formatDateInTimeZone(new Date());
    const closing = () => ctx.get(`/api/reports/daily-closing?date=${day}&source=live`, options).then(assertSuccess);
    assert.equal((await closing()).expectedCashPaise, 30000);
    assert.equal((await closing()).totalSalesPaise, 0, "a refundable deposit is not a sale");
    assertSuccess(await ctx.post("/api/reports/daily-closing/snapshot", { date: day }, options), 201);
    assertSuccess(await ctx.post(`${path}/pickup`, {}, options));
    assertFailure(await ctx.post(`${path}/cancel`, {}, options), 409);
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    assertSuccess(await ctx.post(`${path}/return`, { damageCharge: 10 }, options));
    const stale = assertSuccess(await ctx.get(`/api/reports/daily-closing?date=${day}&source=snapshot`, options));
    assert.equal(stale.snapshot.staleness.stale, true);
    assertSuccess(await ctx.post(`${path}/settle`, payment, options));
    const refund = { amount: 200, paymentMode: "cash", reason: "Security deposit returned", ownerPin: tenant.ownerPin };
    assertFailure(await ctx.post(`${path}/refund`, { ...refund, ownerPin: "0000" }, options), 403);
    assertFailure(await ctx.post(`${path}/refund`, { ...refund, amount: 201 }, options), 409);
    const responses = await Promise.all([ctx.post(`${path}/refund`, refund, options), ctx.post(`${path}/refund`, refund, options)]);
    for (const response of responses) assert.equal(assertSuccess(response).depositHeld, 0);
    assertSuccess(await ctx.post(`${path}/refund`, refund, options));
    assertFailure(await ctx.post(`${path}/refund`, { ...refund, paymentMode: "upi" }, options), 409);
    assertFailure(await ctx.delete(path, options), 409);
    const report = await closing();
    assert.deepEqual(report.rentalTenders, { cash: 100, upi: 10, bank: 0, other: 0 });
    assert.equal(report.expectedCashPaise, 10000);
    assert.equal(report.upiReceivedPaise, 1000);
    const { getTrialBalance } = await import("../../src/modules/finance/general-ledger.service.js");
    const trial = await getTrialBalance(tenant.shop.id, {}, ctx.db);
    assert.equal(trial.status, "balanced");
    for (const code of ["2400", "2410", "1110"]) assert.equal(trial.accounts.find(row => row.code === code).balancePaise, 0);
    assert.equal(trial.accounts.find(row => row.code === "4100").balancePaise, -11000);
    assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 5);
    const other = await fixture();
    assertFailure(await ctx.post(`${path}/refund`, { ...refund, ownerPin: other.tenant.ownerPin }, other.options), 404);
    const branch = await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, name: "Other branch", code: "OTHER", active: true } });
    const { getDailyClosing } = await import("../../src/modules/reports/reports.service.js");
    assert.equal((await getDailyClosing(tenant.shop.id, { date: day, locationId: branch.id }, ctx.db)).expectedCashPaise, 0);
  });

  test("cancellation retains cash until the advance and deposit are explicitly refunded", async () => {
    const { tenant, options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    const cancelled = assertSuccess(await ctx.post(`${path}/cancel`, {}, options));
    assert.equal(cancelled.balanceDue, 0);
    assert.equal(cancelled.depositHeld, 200);
    assert.equal(assertSuccess(await ctx.get("/api/rentals/summary", options)).depositHeld, 200);
    const refund = { amount: 300, paymentMode: "upi", reason: "Cancelled booking refund", ownerPin: tenant.ownerPin };
    assert.equal(assertSuccess(await ctx.post(`${path}/refund`, refund, options)).advancePaid, 0);
    assertSuccess(await ctx.post(`${path}/refund`, refund, options));
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceId: rental.id, entryType: "rental_upi" } }), 1);
  });

  test("legacy booking money is never guessed and refund failure rolls back the liability", async (t) => {
    const { tenant, options, rental } = await fixture();
    const path = `/api/rentals/${rental.id}`;
    await ctx.db.rentalBooking.update({ where: { id: rental.id }, data: { financialVersion: 0 } });
    assertFailure(await ctx.post(`${path}/return`, {}, options), 409);
    await ctx.db.rentalBooking.update({ where: { id: rental.id }, data: { financialVersion: 1 } });
    assertSuccess(await ctx.post(`${path}/return`, {}, options));
    if (!process.env.DATABASE_URL?.startsWith("file:")) return;
    const before = await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id } });
    await ctx.db.$executeRawUnsafe(`CREATE TRIGGER fail_rental_refund_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'RENTAL_FINANCIAL_EVENT' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
    try {
      assertFailure(await ctx.post(`${path}/refund`, { amount: 200, paymentMode: "cash", reason: "Refund rollback", ownerPin: tenant.ownerPin }, options), 503);
      assert.equal((await ctx.db.rentalBooking.findUnique({ where: { id: rental.id } })).depositRefunded, 0);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id } }), before);
    } finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS fail_rental_refund_audit"); }
  });

}
