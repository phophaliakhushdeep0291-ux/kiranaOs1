import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess, todayRangeQuery } from "./setup.js";
import { createProduct, createStaff, createTenant, login, productPayload } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("product/inventory integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, ownerAuth };
  }

  describe("product and inventory integration", () => {
    test("product create works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = assertSuccess(await ctx.post("/api/products", productPayload({ name: "Rice" }), { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(product.name, "Rice");
    });

    test("product update works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Old Name" });
      const updated = assertSuccess(await ctx.patch(`/api/products/${product.id}`, { name: "New Name" }, { token: ownerAuth.accessToken }));
      assert.equal(updated.name, "New Name");
    });

    test("product findMany, loose-item fields, and search work for billing", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const created = assertSuccess(await ctx.post("/api/products", productPayload({
        name: "Loose Sugar",
        category: "grocery",
        displayUnit: "kg",
        baseUnit: "g",
        rateUnit: "kg",
        isLooseItem: true,
        brand: "Daily",
        mrp: 48,
        reorderLevel: 5,
        description: "Loose counter sugar",
        imageUrl: "https://example.test/sugar.png",
      }), { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 201);

      assert.equal(created.isLooseItem, true);
      assert.equal(created.brand, "Daily");
      assert.equal(created.mrp, 48);
      assert.equal(created.reorderLevel, 5);

      const rows = await ctx.db.product.findMany({ where: { shopId: tenant.shop.id, name: "Loose Sugar" } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].isLooseItem, true);

      const updated = assertSuccess(await ctx.patch(`/api/products/${created.id}`, {
        isLooseItem: false,
        brand: "Daily Select",
        mrp: 50,
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(updated.isLooseItem, false);
      assert.equal(updated.brand, "Daily Select");
      assert.equal(updated.mrp, 50);

      const search = assertSuccess(await ctx.get("/api/products?search=Sugar", { token: ownerAuth.accessToken }));
      assert.ok(search.some((product) => product.id === created.id), "billing product search should return the created product");
    });

    test("product soft delete works and list excludes deleted products", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Delete Me" });
      assertSuccess(await ctx.delete(`/api/products/${product.id}`, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      const list = assertSuccess(await ctx.get("/api/products", { token: ownerAuth.accessToken }));
      assert.equal(list.some((p) => p.id === product.id), false);
    });

    test("product restore works", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id);
      await ctx.delete(`/api/products/${product.id}`, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin });
      const restored = assertSuccess(await ctx.post(`/api/products/${product.id}/restore`, {}, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(restored.id, product.id);
      assert.equal(restored.deletedAt, null);
    });

    test("stock purchase increases stock", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5, costPerRateUnit: 10 });
      const purchaseRequest = {
        idempotencyKey: "products-purchase-proof-1",
        productId: product.id,
        supplierName: "Test Supplier",
        quantity: 3,
        enteredUnit: "piece",
        billAmount: 45,
        supplierBillNo: "SUP-1001",
        purchasePaymentStatus: "partial",
        purchasePaymentMode: "cash",
        purchasePaidAmount: 30,
        purchaseDueAmount: 15,
        purchaseDueDate: "2026-06-15",
        updateCost: false,
      };
      const result = assertSuccess(await ctx.post("/api/inventory/purchase", purchaseRequest, { token: ownerAuth.accessToken }), 201);
      assert.equal(result.newStock, 8);
      assert.equal(result.invoiceNumber, "SUP-1001");
      assert.equal(result.purchasePaymentStatus, "partial");
      assert.equal(result.purchasePaymentMode, "cash");
      assert.equal(result.purchasePaidAmount, 30);
      assert.equal(result.purchaseDueAmount, 15);

      const history = await ctx.db.purchaseHistory.findFirst({ where: { productId: product.id, shopId: tenant.shop.id } });
      assert.equal(history.invoiceNumber, "SUP-1001");
      assert.equal(history.purchasePaymentStatus, "partial");
      assert.equal(history.purchasePaymentMode, "cash");
      assert.equal(history.purchasePaidAmount, 30);
      assert.equal(history.purchaseDueAmount, 15);
      assert.equal(history.purchaseDueDate.toISOString().slice(0, 10), "2026-06-15");

      const ledger = await ctx.db.stockLedger.findFirst({ where: { productId: product.id, shopId: tenant.shop.id, action: "purchase" } });
      assert.equal(ledger.invoiceNumber, "SUP-1001");
      assert.equal(ledger.purchasePaidAmount, 30);
      assert.equal(ledger.purchaseDueAmount, 15);

      const summary = assertSuccess(await ctx.get(`/api/reports/payment-summary?${todayRangeQuery()}`, { token: ownerAuth.accessToken }));
      assert.equal(summary.purchaseCashPaid, 30);
      assert.equal(summary.purchaseDue, 15);

      const replay = assertSuccess(await ctx.post("/api/inventory/purchase", purchaseRequest, { token: ownerAuth.accessToken }), 200);
      assert.equal(replay.idempotentReplay, true);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, idempotencyKey: purchaseRequest.idempotencyKey } }), 1);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { shopId: tenant.shop.id, productId: product.id } }), 1);

      const changedReplay = assertFailure(await ctx.post("/api/inventory/purchase", {
        ...purchaseRequest,
        quantity: 4,
      }, { token: ownerAuth.accessToken }), 409);
      assert.equal(changedReplay.code, "IDEMPOTENCY_KEY_REUSED");
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, idempotencyKey: purchaseRequest.idempotencyKey } }), 1);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { shopId: tenant.shop.id, productId: product.id } }), 1);
    });

    test("stock damage decreases stock", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
      const result = assertSuccess(await ctx.post("/api/inventory/damage", {
        idempotencyKey: "products-damage-proof-1",
        productId: product.id,
        quantity: 2,
        enteredUnit: "piece",
        note: "broken",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(result.newStockBaseQty, 3);

      const changedReplay = assertFailure(await ctx.post("/api/inventory/damage", {
        idempotencyKey: "products-damage-proof-1",
        productId: product.id,
        quantity: 1,
        enteredUnit: "piece",
        note: "changed retry",
      }, { token: ownerAuth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(changedReplay.code, "IDEMPOTENCY_KEY_REUSED");
      const refreshed = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshed.stockBaseQty, 3);
    });

    test("stock correction requires PIN for staff", async () => {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5 });
      assertFailure(await ctx.post("/api/inventory/correction", {
        productId: product.id,
        newStockBaseQty: 10,
      }, { token: staffAuth.accessToken }), 403);
    });

    test("low-stock endpoint returns low-stock product", async () => {
      const { tenant, ownerAuth } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 2, lowStockThreshold: 5 });
      const low = assertSuccess(await ctx.get("/api/inventory/low-stock", { token: ownerAuth.accessToken }));
      assert.ok(low.some((p) => p.id === product.id));
    });
  });
}
