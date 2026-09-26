import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess, assertFailure } from "./setup.js";
import { createTenant, createProduct, createStaff, login } from "./factories.js";
import { settingsForBusinessType } from "../../src/verticals/registry.js";
import { formatDateInTimeZone } from "../../src/utils/dates.js";

const ctx = await createIntegrationContext();
if (ctx.skip) test("furniture invoicing unavailable", { skip: ctx.reason }, () => {});
else {
  after(() => ctx.close());
  beforeEach(() => resetDatabase(ctx.db));
  async function fixture({ custom = false } = {}) {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    const shopId = tenant.shop.id;
    await ctx.db.shop.update({ where: { id: shopId }, data: { settingsJson: JSON.stringify(settingsForBusinessType("furniture")) } });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const options = { token: auth.accessToken, ownerPin: tenant.ownerPin };
    const product = await createProduct(ctx.db, shopId, { name: "Oak Chair", stockBaseQty: 10, defaultPricePerRateUnit: 100 });
    const order = assertSuccess(await ctx.post("/api/furniture-orders", { customerName: "Invoice QA Buyer", customerPhone: "9876543210", status: "confirmed",
      items: [{ productId: product.id, name: product.name, qty: 1, rate: 100 }, ...(custom ? [{ name: "Custom Cushion", qty: 1, rate: 50 }] : [])],
      ...(custom ? { deliveryCharge: 20, installCharge: 10, discount: 10 } : {}),
    }, options), 201);
    const path = `/api/furniture-orders/${order.id}`;
    const post = async (suffix, input, status = 200) => assertSuccess(await ctx.post(path + suffix, input, options), status);
    const pay = (amount = order.grandTotal, extra = {}) => post("/payments", { clientRequestId: "invoice-receipt-001", amount, mode: "cash", expectedPaidTotal: 0, ...extra }, 201);
    const ready = () => post("/status", { status: "ready" });
    const preview = () => ctx.get(path + "/invoice-preview", options).then(assertSuccess);
    const input = (review, extra = {}) => ({ previewToken: review.previewToken, taxMode: "none", reason: "Goods loaded and delivery confirmed",
      taxes: review.lines.map(({ lineId, gstRate, hsn }) => ({ lineId, gstRate, ...(hsn ? { hsn } : {}) })), ...extra });
    return { tenant, shopId, options, product, order, path, post, pay, ready, preview, input };
  }

  test("invoice and delivery commit once under simultaneous retries without collecting the advance twice", async () => {
    const f = await fixture();
    await f.pay(100, { paidOn: "2026-06-01" });
    await f.ready();
    const review = await f.preview();
    const input = f.input(review);
    const results = await Promise.all([ctx.post(f.path + "/invoice", input, f.options), ctx.post(f.path + "/invoice", input, f.options)]);
    const orders = results.map((response) => assertSuccess(response, 201));
    assert.equal(orders[0].status, "delivered");
    assert.equal(orders[0].billId, orders[1].billId);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 1);
    assert.equal(await ctx.db.stockLedger.count({ where: { productId: f.product.id, action: "sale" } }), 1);
    assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stockBaseQty, 9);
    assert.equal(await ctx.db.auditLog.count({ where: { shopId: f.shopId, action: "FURNITURE_ORDER_INVOICED" } }), 1);
    const closing = assertSuccess(await ctx.get(`/api/reports/daily-closing?source=live&date=${formatDateInTimeZone(new Date())}`, f.options));
    assert.equal(closing.expectedCashPaise, 0, "today's invoice offsets its advance rather than taking new cash");
    assert.equal(closing.totalSalesPaise, 10000);
    assertFailure(await ctx.post(f.path + "/invoice", { ...input, reason: "Different request" }, f.options), 409);
  });

  test("PIN, ready status and preview freshness protect the combined action", async () => {
    const f = await fixture();
    assertFailure(await ctx.get(f.path + "/invoice-preview", f.options), 409);
    await f.pay(40);
    await f.ready();
    const input = f.input(await f.preview());
    assertFailure(await ctx.post(f.path + "/invoice", input, { ...f.options, ownerPin: "0000" }), 403);
    await f.pay(60, { clientRequestId: "invoice-receipt-002", expectedPaidTotal: 40 });
    assertFailure(await ctx.post(f.path + "/invoice", input, f.options), 409);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    const fresh = f.input(await f.preview());
    assert.equal((await f.post("/invoice", fresh, 201)).status, "delivered");
  });

  test("delivery audit failure rolls back the invoice, stock, application and status as one operation", async (t) => {
    if (!process.env.DATABASE_URL?.startsWith("file:")) return t.skip("SQLite fault injection");
    const f = await fixture();
    await f.pay(); await f.ready();
    const input = f.input(await f.preview());
    const count = await ctx.db.financialLedger.count({ where: { shopId: f.shopId } });
    await ctx.db.$executeRawUnsafe("CREATE TRIGGER qa_invoice_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'FURNITURE_ORDER_INVOICED' BEGIN SELECT RAISE(ABORT, 'forced invoice audit failure'); END");
    try { assertFailure(await ctx.post(f.path + "/invoice", input, f.options), 503); }
    finally { await ctx.db.$executeRawUnsafe("DROP TRIGGER qa_invoice_audit"); }
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    assert.equal(await ctx.db.financialLedger.count({ where: { shopId: f.shopId } }), count);
    assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stockBaseQty, 10);
    assert.equal((await ctx.db.furnitureOrder.findUniqueOrThrow({ where: { id: f.order.id } })).status, "ready");
    assert.equal((await f.post("/invoice", input, 201)).status, "delivered");
  });

  test("remaining credit is assigned only to the matching customer and posted exactly once", async () => {
    const f = await fixture();
    await f.pay(40); await f.ready();
    const customer = assertSuccess(await ctx.post("/api/customers", { name: f.order.customerName, mobile: f.order.customerPhone, type: "udhar" }, f.options), 201);
    const wrong = assertSuccess(await ctx.post("/api/customers", { name: "Different Buyer", type: "udhar" }, f.options), 201);
    const review = await f.preview();
    assert.deepEqual(review.customers.map((row) => row.id), [customer.id]);
    assertFailure(await ctx.post(f.path + "/invoice", f.input(review), f.options), 409);
    assertFailure(await ctx.post(f.path + "/invoice", f.input(review, { customerId: wrong.id }), f.options), 409);
    const order = await f.post("/invoice", f.input(review, { customerId: customer.id }), 201);
    assert.equal(order.balanceDue, 60);
    assert.equal(order.customerId, customer.id);
    const bill = await ctx.db.bill.findUniqueOrThrow({ where: { id: order.billId } });
    assert.equal(bill.creditAmount, 60);
    assert.equal((await ctx.db.customer.findUniqueOrThrow({ where: { id: customer.id } })).udharAmount, 60);
    assert.equal(await ctx.db.udharLedger.count({ where: { billId: bill.id, type: "debit" } }), 1);
  });

  test("custom pieces, delivery, installation and discount keep the agreed inclusive invoice total", async () => {
    const f = await fixture({ custom: true });
    await f.pay(); await f.ready();
    await ctx.db.storeLocation.update({ where: { id: f.order.locationId }, data: { gstNumber: "27AAPFU0939F1ZV" } });
    const review = await f.preview();
    assert.equal(review.lines.length, 4);
    const input = f.input(review, { taxMode: "inclusive", taxes: review.lines.map((line) => ({ lineId: line.lineId, gstRate: 18, hsn: "9403" })) });
    const order = await f.post("/invoice", input, 201);
    const bill = await ctx.db.bill.findUniqueOrThrow({ where: { id: order.billId }, include: { items: true } });
    assert.equal(bill.billType, "gst_invoice");
    assert.equal(bill.grandTotal, 170);
    assert.equal(bill.discount, 10);
    assert.ok(bill.gst > 0);
    assert.equal(bill.items.length, 4);
    assert.equal(order.balanceDue, 0);
  });

  test("pack conversion preserves base quantity and stock shortage leaves no partial invoice", async () => {
    const f = await fixture();
    await ctx.db.productSellingUnit.create({ data: { shopId: f.shopId, productId: f.product.id, name: "Pair", unitCode: "pair", unitType: "pack", conversionToBase: 2, defaultPrice: 200, isDefault: true } });
    await f.pay(); await f.ready();
    const review = await f.preview();
    assert.equal(review.lines[0].quantity, 0.5);
    const input = f.input(review);
    await ctx.db.product.update({ where: { id: f.product.id }, data: { stockBaseQty: 0 } });
    assertFailure(await ctx.post(f.path + "/invoice", input, f.options), 409);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    await ctx.db.product.update({ where: { id: f.product.id }, data: { stockBaseQty: 10 } });
    const delivered = await f.post("/invoice", input, 201);
    const line = await ctx.db.billItem.findFirst({ where: { billId: delivered.billId } });
    assert.equal(line.quantityInBaseUnit, 1);
    assert.equal(line.lineTotal, 100);
  });

  test("delivery cannot consume stock held for another order, including made-to-order lines", async () => {
    const f = await fixture();
    await ctx.db.furnitureOrderItem.updateMany({ where: { orderId: f.order.id }, data: { reserveStock: false } });
    const held = assertSuccess(await ctx.post("/api/furniture-orders", { customerName: "Other Buyer", status: "confirmed",
      items: [{ productId: f.product.id, name: f.product.name, qty: 10, rate: 100 }],
    }, f.options), 201);
    await f.pay(); await f.ready();
    const input = f.input(await f.preview());
    const error = assertFailure(await ctx.post(f.path + "/invoice", input, f.options), 409);
    assert.equal(error.code, "ORDER_NOT_AVAILABLE");
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    assert.equal((await ctx.db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stockBaseQty, 10);
    assertSuccess(await ctx.post(`/api/furniture-orders/${held.id}/status`, { status: "cancelled" }, f.options));
    assert.equal((await f.post("/invoice", input, 201)).status, "delivered");
  });

  test("invoicing never guesses a counted variant from the catalogue default", async () => {
    const f = await fixture();
    await ctx.db.product.update({ where: { id: f.product.id }, data: { packagingMode: "per_pack" } });
    for (const [name, unitCode, isDefault] of [["Blue", "blue", true], ["Red", "red", false]]) {
      await ctx.db.productSellingUnit.create({ data: { shopId: f.shopId, productId: f.product.id, name, unitCode, isDefault,
        unitType: "pack", conversionToBase: 1, defaultPrice: 100, onHandQty: 5 } });
    }
    await f.pay(); await f.ready();
    const error = assertFailure(await ctx.get(f.path + "/invoice-preview", f.options), 409);
    assert.equal(error.code, "ORDER_INVOICE_VARIANT_REQUIRED");
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    assert.equal(await ctx.db.stockLedger.count({ where: { shopId: f.shopId, action: "sale" } }), 0);
  });

  test("tax review rejects missing lines and cannot silently replace a catalogue HSN", async () => {
    const f = await fixture();
    await ctx.db.product.update({ where: { id: f.product.id }, data: { hsn: "9403", gstRate: 18 } });
    await f.pay(); await f.ready();
    const input = f.input(await f.preview());
    assertFailure(await ctx.post(f.path + "/invoice", { ...input, taxes: [{ ...input.taxes[0], lineId: "different-line" }] }, f.options), 409);
    assertFailure(await ctx.post(f.path + "/invoice", { ...input, taxes: [{ ...input.taxes[0], hsn: "9404" }] }, f.options), 409);
    assert.equal(await ctx.db.bill.count({ where: { shopId: f.shopId } }), 0);
    assert.equal((await f.post("/invoice", input, 201)).status, "delivered");
  });

  test("branch-only staff and foreign tenants cannot invoice another order", async () => {
    const f = await fixture();
    await f.pay(); await f.ready();
    const input = f.input(await f.preview());
    const branch = await ctx.db.storeLocation.create({ data: { shopId: f.shopId, code: "SECOND", name: "Second branch" } });
    const { staff, staffPassword } = await createStaff(ctx.db, f.shopId);
    await ctx.db.userLocationAccess.create({ data: { shopId: f.shopId, userId: staff.id, locationId: branch.id, canSell: true } });
    const staffAuth = await login(ctx, staff.mobile, staffPassword);
    assertFailure(await ctx.post(f.path + "/invoice", input, { token: staffAuth.accessToken, ownerPin: f.tenant.ownerPin, headers: { "x-location-id": branch.id } }), 403);
    assertFailure(await ctx.post(f.path + "/invoice", input, { ...f.options, headers: { "x-location-id": branch.id } }), 403);
    const foreign = await fixture();
    assertFailure(await ctx.post(f.path + "/invoice", input, foreign.options), 404);
    assert.equal(await ctx.db.bill.count(), 0);
  });
}
