import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { billPayload, createCustomer, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("retail operations integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerContext(overrides = {}) {
    const tenant = await createTenant(ctx.db, { planCode: "pro", gstNumber: "27AAPFU0939F1ZV", ...overrides });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  describe("retail operations foundation", () => {
    test("creates a second store and atomically transfers location stock", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Branch Rice", stockBaseQty: 20 });
      const locations = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken }));
      assert.equal(locations.locations.length, 1);
      assert.equal(locations.locations[0].isPrimary, true);

      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Market Branch", code: "MKT01", city: "Pune" }, { token: auth.accessToken }), 201);
      const transfer = assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: locations.locations[0].id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 7 }],
        note: "Opening stock",
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(transfer.status, "completed");

      const mainInventory = assertSuccess(await ctx.get(`/api/stores/${locations.locations[0].id}/inventory`, { token: auth.accessToken }));
      const branchInventory = assertSuccess(await ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }));
      assert.equal(mainInventory.products.find((row) => row.id === product.id).stockBaseQty, 13);
      assert.equal(branchInventory.products.find((row) => row.id === product.id).stockBaseQty, 7);
      const mainCatalog = assertSuccess(await ctx.get("/api/products", { token: auth.accessToken, headers: { "x-location-id": locations.locations[0].id } }));
      const branchCatalog = assertSuccess(await ctx.get("/api/products", { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      assert.equal(mainCatalog.find((row) => row.id === product.id).stockBaseQty, 13, "primary catalog must show residual branch stock");
      assert.equal(branchCatalog.find((row) => row.id === product.id).stockBaseQty, 7, "branch catalog must show branch stock instead of company stock");
      assert.equal(branchCatalog.find((row) => row.id === product.id).inventoryLocationId, branch.id);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 20, "a transfer must not change company-wide stock");

      const overdraw = assertFailure(await ctx.post("/api/stores/transfers", {
        fromLocationId: branch.id,
        toLocationId: locations.locations[0].id,
        items: [{ productId: product.id, quantityBaseQty: 8 }], ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(overdraw.code, "INSUFFICIENT_LOCATION_STOCK");
    });

    test("enforces the subscribed store limit", async () => {
      const { tenant, auth } = await ownerContext();
      assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken }));
      assertSuccess(await ctx.post("/api/stores", { name: "Second Store", code: "S02" }, { token: auth.accessToken }), 201);
      const blocked = assertFailure(await ctx.post("/api/stores", { name: "Third Store", code: "S03" }, { token: auth.accessToken }), 403);
      assert.equal(blocked.code, "STORE_LIMIT_REACHED");
    });

    test("routes public customer orders to one branch with live stock, pricing, and guarded fulfillment", async () => {
      const { tenant, auth } = await ownerContext();
      await ctx.db.shop.update({
        where: { id: tenant.shop.id },
        data: { settingsJson: JSON.stringify({ customerOrdering: { enabled: true } }) },
      });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Online Branch Rice", stockBaseQty: 20, defaultPricePerRateUnit: 50 });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Online Branch", code: "ONL02", city: "Pune" }, { token: auth.accessToken }), 201);
      assertSuccess(await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 4 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      await ctx.db.pricingRule.create({ data: {
        shopId: tenant.shop.id,
        locationId: branch.id,
        name: "Online branch price",
        ruleType: "PROMOTIONAL_PRICE",
        status: "ACTIVE",
        priority: 7,
        productId: product.id,
        fixedUnitPrice: 45,
      } });

      const catalog = assertSuccess(await ctx.get(`/api/public/shops/${tenant.shop.id}/catalog?locationId=${branch.id}`));
      assert.equal(catalog.location.id, branch.id);
      assert.equal(catalog.products.find((row) => row.id === product.id).price, 45);

      const submitted = assertSuccess(await ctx.post(`/api/public/shops/${tenant.shop.id}/orders`, {
        locationId: branch.id,
        fulfillmentType: "pickup",
        promisedSlot: "Tomorrow morning",
        customerName: "Online Customer",
        customerMobile: "9876543210",
        items: [{ productId: product.id, qty: 2 }],
      }, { headers: { "Idempotency-Key": "branch-order-integration-1" } }), 201);
      assert.equal(submitted.locationId, branch.id);
      assert.equal(submitted.estimatedTotal, 90);

      const branchOrders = assertSuccess(await ctx.get("/api/orders", { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      const primaryOrders = assertSuccess(await ctx.get("/api/orders", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.equal(branchOrders.orders.length, 1);
      assert.equal(primaryOrders.orders.length, 0);
      const accepted = assertSuccess(await ctx.patch(`/api/orders/${submitted.orderId}`, { status: "accepted" }, { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      assert.equal(accepted.status, "accepted");
      assert.ok(accepted.acceptedAt);
      const ready = assertSuccess(await ctx.patch(`/api/orders/${submitted.orderId}`, { status: "ready" }, { token: auth.accessToken, headers: { "x-location-id": branch.id } }));
      assert.equal(ready.status, "ready");
      const invalid = assertFailure(await ctx.patch(`/api/orders/${submitted.orderId}`, { status: "accepted" }, { token: auth.accessToken, headers: { "x-location-id": branch.id } }), 409);
      assert.equal(invalid.code, "INVALID_ORDER_TRANSITION");
    });

    test("keeps branch billing, purchasing, stock ledger, reports, and closing isolated", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Branch-owned Flour", stockBaseQty: 20, defaultPricePerRateUnit: 25 });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];
      const branch = assertSuccess(await ctx.post("/api/stores", { name: "Billing Branch", code: "BILL02" }, { token: auth.accessToken }), 201);
      await ctx.post("/api/stores/transfers", {
        fromLocationId: primary.id,
        toLocationId: branch.id,
        items: [{ productId: product.id, quantityBaseQty: 8 }],
        ownerPin: tenant.ownerPin,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin });

      const branchHeaders = { "x-location-id": branch.id };
      const bill = assertSuccess(await ctx.post(
        "/api/bills/confirm",
        billPayload(product, { quantity: 3, ratePerRateUnit: 25 }),
        { token: auth.accessToken, headers: branchHeaders },
      ), 201);
      assert.equal(bill.locationId, branch.id);

      assertSuccess(await ctx.post("/api/inventory/purchase", {
        productId: product.id,
        supplierName: "Branch Supplier",
        quantity: 2,
        enteredUnit: "piece",
        billAmount: 20,
        updateCost: false,
      }, { token: auth.accessToken, headers: branchHeaders }), 201);

      const [mainInventory, branchInventory, storedBill, branchLedger] = await Promise.all([
        ctx.get(`/api/stores/${primary.id}/inventory`, { token: auth.accessToken }),
        ctx.get(`/api/stores/${branch.id}/inventory`, { token: auth.accessToken }),
        ctx.db.bill.findUnique({ where: { id: bill.id } }),
        ctx.db.stockLedger.findMany({ where: { shopId: tenant.shop.id, locationId: branch.id } }),
      ]);
      assert.equal(assertSuccess(mainInventory).products.find((row) => row.id === product.id).stockBaseQty, 12);
      assert.equal(assertSuccess(branchInventory).products.find((row) => row.id === product.id).stockBaseQty, 7);
      assert.equal(storedBill.locationId, branch.id);
      assert.equal(branchLedger.some((row) => row.action === "sale"), true);
      assert.equal(branchLedger.some((row) => row.action === "purchase"), true);

      const branchClosing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: auth.accessToken, headers: branchHeaders }));
      const mainClosing = assertSuccess(await ctx.get("/api/reports/daily-closing?source=live", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.equal(branchClosing.location.id, branch.id);
      assert.equal(branchClosing.totalBills, 1);
      assert.equal(mainClosing.totalBills, 0);

      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const snapshot = assertSuccess(await ctx.post("/api/reports/daily-closing/snapshot", { date }, { token: auth.accessToken, headers: branchHeaders }), 201);
      assert.equal(snapshot.snapshot.storeId, branch.id);
    });

    test("runs a branch-aware purchase order through partial and complete atomic receiving", async () => {
      const { tenant, auth } = await ownerContext();
      const product = await createProduct(ctx.db, tenant.shop.id, {
        name: "Reorder Oil",
        stockBaseQty: 3,
        lowStockThreshold: 5,
        reorderLevel: 10,
        costPerRateUnit: 20,
        baseUnit: "piece",
        rateUnit: "piece",
      });
      const supplier = await ctx.db.supplier.create({ data: { shopId: tenant.shop.id, name: "Reliable Wholesale" } });
      const primary = assertSuccess(await ctx.get("/api/stores", { token: auth.accessToken })).locations[0];

      const suggestions = assertSuccess(await ctx.get("/api/purchase-orders/suggestions", { token: auth.accessToken, headers: { "x-location-id": primary.id } }));
      assert.equal(suggestions.find((row) => row.productId === product.id).recommendedOrderBaseQty, 7);

      const order = assertSuccess(await ctx.post("/api/purchase-orders", {
        supplierId: supplier.id,
        supplierName: supplier.name,
        expectedOn: "2026-07-20",
        items: [{ productId: product.id, orderedBaseQty: 10, expectedRate: 18 }],
      }, { token: auth.accessToken, headers: { "x-location-id": primary.id } }), 201);
      assert.equal(order.status, "draft");
      assert.equal(order.expectedTotal, 180);

      const sent = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/send`, {}, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(sent.status, "sent");
      const orderItemId = sent.items[0].id;

      const firstReceiptPayload = {
        idempotencyKey: `po-receipt-${order.id}-1`,
        supplierInvoiceNumber: "SUP-1001",
        paidAmount: 68,
        paymentMode: "cash",
        items: [{ purchaseOrderItemId: orderItemId, quantityBaseQty: 4, actualRate: 17 }],
      };
      const partial = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receive`, firstReceiptPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(partial.purchaseOrder.status, "partially_received");
      assert.equal(partial.purchaseOrder.items[0].receivedBaseQty, 4);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7);

      const replay = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receive`, firstReceiptPayload, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(replay.idempotentReplay, true);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 7, "receipt retry must not add stock twice");

      const overReceipt = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/receive`, {
        idempotencyKey: `po-receipt-${order.id}-over`, paidAmount: 133, paymentMode: "cash",
        items: [{ purchaseOrderItemId: orderItemId, quantityBaseQty: 7, actualRate: 19 }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(overReceipt.code, "PURCHASE_ORDER_OVER_RECEIPT");

      const completed = assertSuccess(await ctx.post(`/api/purchase-orders/${order.id}/receive`, {
        idempotencyKey: `po-receipt-${order.id}-2`, supplierInvoiceNumber: "SUP-1001", paidAmount: 114, paymentMode: "bank",
        items: [{ purchaseOrderItemId: orderItemId, quantityBaseQty: 6, actualRate: 19 }],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(completed.purchaseOrder.status, "received");
      assert.equal(completed.purchaseOrder.items[0].receivedBaseQty, 10);
      assert.equal((await ctx.db.product.findUnique({ where: { id: product.id } })).stockBaseQty, 13);
      assert.equal(await ctx.db.purchaseReceipt.count({ where: { purchaseOrderId: order.id } }), 2);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { purchaseOrderId: order.id } }), 2);

      const cannotCancel = assertFailure(await ctx.post(`/api/purchase-orders/${order.id}/cancel`, { reason: "Too late" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(cannotCancel.code, "PURCHASE_ORDER_NOT_CANCELLABLE");
    });

    test("earns loyalty points once and reverses available points on bill cancellation", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Loyal Buyer" });
      const product = await createProduct(ctx.db, tenant.shop.id, { defaultPricePerRateUnit: 20, stockBaseQty: 20 });
      assertSuccess(await ctx.request("PUT", "/api/loyalty/program", { token: auth.accessToken, ownerPin: tenant.ownerPin, body: { active: true, pointsPerRupee: 2, redemptionPaisePerPoint: 25, minimumRedeemPoints: 10, ownerPin: tenant.ownerPin } }));

      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { customerId: customer.id, customerName: customer.name, quantity: 2 }), { token: auth.accessToken }), 201);
      const account = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(account.account.pointsBalance, 80);
      assert.equal(account.account.transactions.filter((row) => row.type === "earn").length, 1);

      const redemptionPayload = {
        ...billPayload(product, {
          quantity: 1,
          ratePerRateUnit: 20,
          customerId: customer.id,
          customerName: customer.name,
          actualAmount: 10,
          buyerPaidAmount: 10,
          payments: [{ mode: "cash", amount: 10 }],
        }),
        loyaltyPointsToRedeem: 40,
        sensitiveActions: ["loyalty_redemption"],
        reason: "Customer requested loyalty redemption",
        ownerPin: tenant.ownerPin,
      };
      const redemptionBill = assertSuccess(await ctx.post("/api/bills/confirm", redemptionPayload, { token: auth.accessToken }), 201);
      assert.equal(redemptionBill.loyaltyPointsRedeemed, 40);
      assert.equal(redemptionBill.loyaltyDiscount, 10);
      assert.equal(redemptionBill.discount, 10);
      assert.equal(redemptionBill.grandTotal, 10);
      const afterRedemption = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(afterRedemption.account.pointsBalance, 60);
      assert.equal(afterRedemption.account.transactions.some((row) => row.type === "redeem" && row.billId === redemptionBill.id), true);

      assertSuccess(await ctx.post(`/api/bills/${redemptionBill.id}/cancel`, { reason: "Redemption bill cancelled" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const redemptionRestored = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(redemptionRestored.account.pointsBalance, 80);
      assert.equal(redemptionRestored.account.transactions.some((row) => row.type === "redeem_reversal" && row.billId === redemptionBill.id), true);

      assertSuccess(await ctx.post(`/api/bills/${bill.id}/cancel`, { reason: "Customer changed mind" }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      const reversed = assertSuccess(await ctx.get(`/api/loyalty/accounts/${customer.id}`, { token: auth.accessToken }));
      assert.equal(reversed.account.pointsBalance, 0);
      assert.equal(reversed.account.transactions.some((row) => row.type === "adjustment" && row.points === -80), true);
    });

    test("reports GST readiness, exports an HSN invoice register, and blocks fake legal submission", async () => {
      const { tenant, auth } = await ownerContext();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "GST Buyer" });
      await ctx.db.customer.update({ where: { id: customer.id }, data: { stateCode: "29", gstNumber: "29ABCDE1234F1Z5" } });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Taxed Goods", hsn: "1905", gstRate: 5, defaultPricePerRateUnit: 105 });
      const bill = assertSuccess(await ctx.post("/api/bills/confirm", billPayload(product, { billType: "gst_invoice", customerId: customer.id, customerName: customer.name, quantity: 1, ratePerRateUnit: 105, gstRate: 5 }), { token: auth.accessToken }), 201);

      const readiness = assertSuccess(await ctx.get("/api/compliance/readiness", { token: auth.accessToken }));
      assert.equal(readiness.checks.find((row) => row.key === "gstin").ready, true);
      assert.equal(readiness.checks.find((row) => row.key === "hsn").ready, true);
      assert.equal(readiness.checks.find((row) => row.key === "eway").ready, true);
      assert.equal(readiness.provider.legalSubmission, false);

      const retailPayment = assertSuccess(await ctx.get("/api/payment-provider/retail/readiness", { token: auth.accessToken }));
      assert.equal(retailPayment.configured, false);
      assert.equal(retailPayment.confirmationRequired, false);
      const unconfiguredPayment = assertFailure(await ctx.post("/api/payment-provider/retail/intents", { amountPaise: 10500 }, { token: auth.accessToken }), 503);
      assert.equal(unconfiguredPayment.code, "RETAIL_PAYMENT_PROVIDER_NOT_CONFIGURED");

      const csv = await ctx.get("/api/compliance/gst-register?range=yearly&format=csv", { token: auth.accessToken });
      assert.equal(csv.status, 200);
      assert.match(csv.text, /Invoice Number/);
      assert.match(csv.text, /1905/);
      assert.match(csv.text, new RegExp(bill.billNo));

      const register = assertSuccess(await ctx.get("/api/compliance/gst-register?range=yearly&format=json", { token: auth.accessToken }));
      const invoiceLine = register.rows.find((row) => row.invoiceNumber === bill.billNo);
      assert.equal(invoiceLine.supplyType, "interstate");
      assert.equal(invoiceLine.placeOfSupply, "29");
      assert.equal(invoiceLine.igst, 5);
      assert.equal(invoiceLine.cgst, 0);
      assert.equal(invoiceLine.sgst, 0);

      const missingHsnProduct = await createProduct(ctx.db, tenant.shop.id, { name: "Unclassified Snack", category: "snacks", hsn: null, gstRate: 0 });
      const hsnBefore = assertSuccess(await ctx.get("/api/compliance/hsn-summary", { token: auth.accessToken }));
      assert.equal(hsnBefore.categories.find((row) => row.category === "snacks").missingHsn, 1);
      const assigned = assertSuccess(await ctx.request("PUT", "/api/compliance/hsn-category", {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
        body: { category: "snacks", hsn: "2106", gstRate: 12 },
      }));
      assert.equal(assigned.updatedProducts, 1);
      const classified = await ctx.db.product.findUnique({ where: { id: missingHsnProduct.id } });
      assert.equal(classified.hsn, "2106");
      assert.equal(classified.gstRate, 12);

      const gstr1 = await ctx.get("/api/compliance/gstr1-working?range=yearly&format=csv", { token: auth.accessToken });
      assert.equal(gstr1.status, 200);
      assert.match(gstr1.text, /B2B/);
      assert.match(gstr1.text, /HSN/);

      const ewayDraft = assertSuccess(await ctx.post(`/api/compliance/e-way-bills/${bill.id}/draft`, {
        transportMode: "road",
        transporterName: "Reliable Roadways",
        vehicleNumber: "MH12AB1234",
        vehicleType: "regular",
        distanceKm: 85,
        transportDocumentNumber: "LR-1001",
        transportDocumentDate: "2026-07-13",
        deliveryAddress: "12 Market Road, Pune, Maharashtra",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.equal(ewayDraft.documentType, "e_way_bill");
      assert.equal(ewayDraft.status, "sandbox_only");
      assert.match(ewayDraft.externalReference, /^DRAFT-/);
      const storedTransport = JSON.parse(ewayDraft.payloadJson).transport;
      assert.equal(storedTransport.vehicleNumber, "MH12AB1234");
      assert.equal(storedTransport.distanceKm, 85);

      const disabledEway = assertFailure(await ctx.post(`/api/compliance/e-way-bills/${bill.id}/submit`, {
        transportMode: "road", transporterName: "Reliable Roadways", vehicleNumber: "MH12AB1234", distanceKm: 85, deliveryAddress: "12 Market Road, Pune, Maharashtra",
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
      assert.equal(disabledEway.code, "GST_LEGAL_PROVIDER_NOT_READY");

      const disabled = assertFailure(await ctx.post(`/api/compliance/e-invoices/${bill.id}/sandbox`, {}, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
      assert.equal(disabled.code, "GST_PROVIDER_NOT_CONFIGURED");
    });
  });
}
