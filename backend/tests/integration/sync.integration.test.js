import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, billPayload, createCustomer, createProduct, createStaff, createTenant, login, productPayload, unique } from "./factories.js";
import { runSyncRetentionCleanup } from "../../src/workers/syncCleanup.worker.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("sync integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const device = await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "sync-device" });
    const deviceHeaders = { "x-device-id": device.deviceId };
    return { tenant, ownerAuth, device, deviceHeaders };
  }

  describe("sync integration", () => {
    test("sync push CREATE_PRODUCT works", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "create-product-1", type: "CREATE_PRODUCT", payload: { product: productPayload({ name: "Sync Product" }) } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.ok(data.results[0].serverId);
    });

    test("CREATE_PRODUCT retried under a new event id converges to one product", async () => {
      // The same offline product re-pushed under a different event id (retry after a lost
      // ack). Event-level idempotency does NOT catch this (different event ids), so the
      // create itself must converge on the durable client identity: one server product,
      // both local ids mapped onto it, and no duplicate / name-conflict failure.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = productPayload({ name: "Parle-G Biscuit" });
      const response = await ctx.post("/api/sync/push", {
        events: [
          { eventId: "create-product-conv-1", type: "CREATE_PRODUCT", payload: { localProductId: "local_prod_x", product } },
          { eventId: "create-product-conv-2", type: "CREATE_PRODUCT", payload: { localProductId: "local_prod_x", product } },
        ],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.failed, 0, "neither product create should fail");
      assert.equal(data.summary.conflicts, 0, "retried product create must converge, not conflict");
      const serverIdA = data.idMappings.products?.local_prod_x;
      assert.ok(serverIdA, "local product id maps to a server product");

      const count = await ctx.db.product.count({ where: { shopId: tenant.shop.id, name: "Parle-G Biscuit", deletedAt: null } });
      assert.equal(count, 1, "exactly one product should exist after the retried create");
    });

    test("sync push CREATE_CUSTOMER works", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "create-customer-1", type: "CREATE_CUSTOMER", payload: { customer: { name: "Sync Customer", mobile: "6999999991", type: "regular" } } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.ok(data.results[0].serverId);
    });

    test("CREATE_CUSTOMER converges on existing mobile instead of duplicating or failing", async () => {
      // Same customer (same mobile) created twice with different event ids and different
      // local ids — e.g. a retry after a lost ack, or the same customer added on a second
      // device. Event-level idempotency does NOT catch this (different event ids), so the
      // create itself must converge: one server customer, both local ids mapped onto it,
      // and no permanently-failed sync event.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const mobile = "6999900042";
      const response = await ctx.post("/api/sync/push", {
        events: [
          { eventId: "create-customer-conv-1", type: "CREATE_CUSTOMER", payload: { localCustomerId: "local_cust_a", customer: { name: "Ramesh", mobile, type: "regular" } } },
          { eventId: "create-customer-conv-2", type: "CREATE_CUSTOMER", payload: { localCustomerId: "local_cust_b", customer: { name: "Ramesh", mobile, type: "regular" } } },
        ],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.failed, 0, "neither customer create should fail");
      assert.equal(data.summary.conflicts, 0, "duplicate-mobile create must converge, not conflict");
      const serverIdA = data.idMappings.customers?.local_cust_a;
      const serverIdB = data.idMappings.customers?.local_cust_b;
      assert.ok(serverIdA, "first local customer id maps to a server customer");
      assert.equal(serverIdB, serverIdA, "second local customer id converges to the same server customer");

      const count = await ctx.db.customer.count({ where: { shopId: tenant.shop.id, mobile, deletedAt: null } });
      assert.equal(count, 1, "exactly one active customer should exist for the mobile");
    });

    test("concurrent offline customer updates preserve the first write and create a durable conflict", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Shared customer" });
      const baseUpdatedAt = customer.updatedAt.toISOString();

      const first = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          eventId: "customer-device-a-update",
          type: "UPDATE_CUSTOMER",
          payload: { customerId: customer.id, baseUpdatedAt, customer: { name: "Device A name" } },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.summary.synced, 1);

      const second = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          eventId: "customer-device-b-update",
          type: "UPDATE_CUSTOMER",
          payload: { customerId: customer.id, baseUpdatedAt, customer: { name: "Device B name" } },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(second.summary.conflicts, 1);
      assert.equal(second.results[0].code, "SYNC_CUSTOMER_VERSION_CONFLICT");
      assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).name, "Device A name");

      const conflict = await ctx.db.syncConflict.findFirst({
        where: { shopId: tenant.shop.id, sourceEventId: "customer-device-b-update" },
      });
      assert.ok(conflict, "the competing device update is retained for owner review");
      assert.match(conflict.localSnapshotJson, /Device B name/);
      assert.match(conflict.serverSnapshotJson, /Device A name/);
    });

    test("bill creation posts append-only FinancialLedger entries exactly once across retries", async () => {
      // Part 4 consistency: a partial cash + udhar bill must post sale + cash_in + udhar_debit.
      // Re-pushing the same bill under a new event id (retry after lost ack) must NOT double-post:
      // the ledger is the dashboard's source of truth, so a retry that double-counted would
      // corrupt every money KPI. The unique idempotency key guarantees exactly-once.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const localBillId = "local-bill-ledger-1";
      const billBody = {
        ...billPayload(product, {
          quantity: 1,
          ratePerRateUnit: 100,
          customerId: customer.id,
          customerName: customer.name,
          buyerPaidAmount: 40,
          payments: [{ mode: "cash", amount: 40 }],
        }),
        localBillId,
        clientBillId: localBillId,
        idempotencyKey: "create-bill:test:ledger:1",
        creditAmount: 60,
      };
      const event = {
        type: "CREATE_BILL",
        payload: { localBillId, clientBillId: localBillId, idempotencyKey: "create-bill:test:ledger:1", bill: billBody },
      };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "create-bill-ledger-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "create-bill-ledger-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const ledger = await ctx.db.financialLedger.findMany({ where: { shopId: tenant.shop.id } });
      const ofType = (entryType) => ledger.filter((row) => row.entryType === entryType);
      assert.equal(ledger.length, 3, "sale + cash_in + udhar_debit, posted once despite the retry");
      assert.equal(ofType("sale").length, 1);
      assert.equal(Number(ofType("sale")[0].amountPaise), 10000, "sale = ₹100");
      assert.equal(ofType("cash_in").length, 1);
      assert.equal(Number(ofType("cash_in")[0].amountPaise), 4000, "cash_in = ₹40");
      assert.equal(ofType("upi_in").length, 0, "no UPI tender on this bill");
      assert.equal(ofType("udhar_debit").length, 1);
      assert.equal(Number(ofType("udhar_debit")[0].amountPaise), 6000, "udhar_debit = ₹60");
    });

    test("ADJUST_STOCK (damage) replayed under a new event id applies stock only once", async () => {
      // A damage adjustment that committed but lost its ack gets re-pushed under a new event id.
      // Event-level idempotency cannot catch this (different event ids), and damage is relative —
      // re-applying would decrement stock twice and corrupt inventory. The durable StockLedger
      // idempotencyKey guarantees exactly-once: stock moves once, one ledger row.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const payload = {
        productId: product.id,
        adjustmentType: "damage",
        quantity: 3,
        enteredUnit: product.baseUnit,
        idempotencyKey: "adjust-stock:test:dmg:1",
        clientMovementId: "adjust-stock:test:dmg:1",
        ownerPin: tenant.ownerPin,
      };
      const event = { type: "ADJUST_STOCK", ownerPin: tenant.ownerPin, payload };

      const first = assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "dmg-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.summary.failed, 0, JSON.stringify(first.results));
      assert.equal(first.summary.synced, 1, JSON.stringify(first.results));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      const replay = assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "dmg-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(replay.summary.failed, 0, JSON.stringify(replay.results));
      assert.equal(replay.summary.synced, 1, JSON.stringify(replay.results));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 7, "damage of 3 applied exactly once (10 → 7), not twice");
      const damageRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "damage" },
      });
      assert.equal(damageRows.length, 1, "exactly one damage ledger row despite the retry");
    });

    test("ADJUST_STOCK correction replayed under a new event id applies once", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const payload = {
        productId: product.id,
        adjustmentType: "correction",
        newStockBaseQty: 4,
        idempotencyKey: "adjust-stock:test:correction:1",
        clientMovementId: "adjust-stock:test:correction:1",
        ownerPin: tenant.ownerPin,
      };
      const event = { type: "ADJUST_STOCK", ownerPin: tenant.ownerPin, payload };

      const first = assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "correction-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.summary.failed, 0, JSON.stringify(first.results));
      assert.equal(first.summary.synced, 1, JSON.stringify(first.results));
      const replay = assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "correction-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(replay.summary.failed, 0, JSON.stringify(replay.results));
      assert.equal(replay.summary.synced, 1, JSON.stringify(replay.results));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 4, "correction must commit once and remain at the requested quantity");
      const correctionRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "correction" },
      });
      assert.equal(correctionRows.length, 1, "exactly one correction ledger row must survive a replay");
      assert.equal(correctionRows[0].idempotencyKey, payload.idempotencyKey);
    });
    test("STOCK_PURCHASE replayed under a new event id applies stock + cost + history once", async () => {
      // A purchase that committed but lost its ack gets re-pushed under a new event id. A double
      // apply would over-increment stock, recompute weighted-average cost off the inflated base,
      // and write a second PurchaseHistory row (doubling the supplier's outstanding due). The
      // durable StockLedger idempotencyKey guarantees exactly-once across all three.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, costPerRateUnit: 10 });
      const payload = {
        productId: product.id,
        quantity: 10,
        enteredUnit: product.baseUnit,
        billAmount: 200, // 10 units @ ₹20 → weightedAvgCost(10,10,10,20) = 15
        supplierName: "Acme Distributors",
        idempotencyKey: "stock-purchase:test:1",
        clientMovementId: "stock-purchase:test:1",
      };
      const event = { type: "STOCK_PURCHASE", payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "purch-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "purch-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 20, "purchase of 10 applied once (10 → 20), not twice");
      assert.equal(fresh.costPerRateUnit, 15, "weighted-average cost computed once (15), not off an inflated base");
      const purchaseRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "purchase" },
      });
      assert.equal(purchaseRows.length, 1, "exactly one purchase ledger row despite the retry");
      const history = await ctx.db.purchaseHistory.findMany({ where: { shopId: tenant.shop.id, productId: product.id } });
      assert.equal(history.length, 1, "exactly one PurchaseHistory row (supplier due not doubled)");
    });

    test("STOCK_PURCHASE_BATCH commits every invoice line atomically and replays exact-once", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const firstProduct = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, costPerRateUnit: 10 });
      const secondProduct = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 5, costPerRateUnit: 20 });
      const lines = [
        { productId: firstProduct.id, quantity: 2, enteredUnit: firstProduct.baseUnit, billAmount: 30, supplierName: "Batch Supplier", invoiceNumber: "BATCH-1", idempotencyKey: "batch-line-1", clientMovementId: "batch-line-1" },
        { productId: secondProduct.id, quantity: 3, enteredUnit: secondProduct.baseUnit, billAmount: 75, supplierName: "Batch Supplier", invoiceNumber: "BATCH-1", idempotencyKey: "batch-line-2", clientMovementId: "batch-line-2" },
      ];
      const event = { type: "STOCK_PURCHASE_BATCH", payload: { batchId: "batch-1", lines } };

      const first = assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "batch-event-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.summary.synced, 1, JSON.stringify(first.results));
      assert.equal(first.results[0].result.movements.length, 2);
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "batch-event-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      assert.equal((await ctx.db.product.findUnique({ where: { id: firstProduct.id } })).stockBaseQty, 12);
      assert.equal((await ctx.db.product.findUnique({ where: { id: secondProduct.id } })).stockBaseQty, 8);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, action: "purchase", idempotencyKey: { in: ["batch-line-1", "batch-line-2"] } } }), 2);
      assert.equal(await ctx.db.purchaseHistory.count({ where: { shopId: tenant.shop.id, invoiceNumber: "BATCH-1" } }), 2);

      const rejected = assertSuccess(await ctx.post("/api/sync/push", { events: [{
        type: "STOCK_PURCHASE_BATCH",
        eventId: "batch-event-invalid",
        payload: { batchId: "batch-invalid", lines: [
          { ...lines[0], idempotencyKey: "batch-invalid-line-1", clientMovementId: "batch-invalid-line-1", invoiceNumber: "BATCH-INVALID" },
          { ...lines[1], productId: "missing-product", idempotencyKey: "batch-invalid-line-2", clientMovementId: "batch-invalid-line-2", invoiceNumber: "BATCH-INVALID" },
        ] },
      }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(rejected.summary.synced, 0);
      assert.equal(await ctx.db.stockLedger.count({ where: { shopId: tenant.shop.id, idempotencyKey: "batch-invalid-line-1" } }), 0, "valid first line must not survive an invalid later line");
      assert.equal(await ctx.db.purchaseHistory.count({ where: { shopId: tenant.shop.id, invoiceNumber: "BATCH-INVALID" } }), 0);
    });

    test("STOCK_PURCHASE normalizes legacy partial purchase payloads before validation", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, costPerRateUnit: 10 });
      const result = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          type: "STOCK_PURCHASE",
          eventId: "legacy-purchase-normalize-1",
          payload: {
            productId: product.id,
            quantity: 10,
            enteredUnit: product.baseUnit,
            billAmount: 200,
            supplierName: "Legacy Supplier",
            purchasePaymentStatus: "partial",
            purchaseDueDate: "2026-06-18T12:00:00.000Z",
            idempotencyKey: "stock-purchase:legacy-normalize-1",
            clientMovementId: "stock-purchase:legacy-normalize-1",
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      assert.equal(String(result.results[0].status).toLowerCase(), "synced");
      const history = await ctx.db.purchaseHistory.findFirst({ where: { shopId: tenant.shop.id, productId: product.id } });
      assert.equal(history.purchasePaymentStatus, "due");
      assert.equal(history.purchasePaidAmount, 0);
      assert.equal(history.purchaseDueAmount, 200);
      assert.equal(history.purchaseDueDate.toISOString().slice(0, 10), "2026-06-18");
    });

    test("CREATE_LEDGER_ADJUSTMENT replayed under a new event id applies to udhar once", async () => {
      // A manual udhar adjustment that committed but lost its ack gets re-pushed under a new event
      // id. Event-level idempotency cannot catch this (different event ids), and a double apply
      // would move the customer's balance twice. The durable UdharLedger idempotencyKey guarantees
      // exactly-once: one adjustment row, balance moved once.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id); // starts at balance 0
      const payload = {
        customerId: customer.id,
        amount: 200, // debit adjustment: +₹200
        note: "manual correction",
        idempotencyKey: "ledger-adjust:test:1",
        clientLedgerId: "ledger-adjust:test:1",
      };
      const event = { type: "CREATE_LEDGER_ADJUSTMENT", payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ladj-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ladj-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const adjustments = await ctx.db.udharLedger.findMany({
        where: { shopId: tenant.shop.id, customerId: customer.id, mode: "adjustment" },
      });
      assert.equal(adjustments.length, 1, "exactly one adjustment ledger row despite the retry");
      const after = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(after.udharAmount, 200, "adjustment applied exactly once (balance ₹200, not ₹400)");
    });

    test("CREATE_LEDGER_ADJUSTMENT accepts negative repair amounts without schema conflicts", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          type: "CREATE_LEDGER_ADJUSTMENT",
          eventId: "ladj-negative-seed",
          payload: {
            customerId: customer.id,
            amount: 200,
            note: "opening correction",
            idempotencyKey: "ledger-adjust:negative-seed",
            clientLedgerId: "ledger-adjust:negative-seed",
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const result = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          type: "CREATE_LEDGER_ADJUSTMENT",
          eventId: "ladj-negative-1",
          payload: {
            customerId: customer.id,
            amount: -60,
            note: "reduce wrong opening balance",
            idempotencyKey: "ledger-adjust:negative-1",
            clientLedgerId: "ledger-adjust:negative-1",
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      assert.equal(String(result.results[0].status).toLowerCase(), "synced");
      const after = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(after.udharAmount, 140);
      const adjustments = await ctx.db.udharLedger.findMany({
        where: { shopId: tenant.shop.id, customerId: customer.id, mode: "adjustment" },
        orderBy: { createdAt: "asc" },
      });
      assert.deepEqual(adjustments.map((row) => row.type), ["debit", "payment"]);
    });

    test("STOCK_SALE replayed under a new event id decrements stock once", async () => {
      // A manual offline stock-out that committed but lost its ack gets re-pushed under a new event
      // id. STOCK_SALE is relative (decrement), so a double apply would remove stock twice. The
      // durable StockLedger idempotencyKey guarantees exactly-once.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const payload = {
        productId: product.id,
        quantity: 3,
        enteredUnit: product.baseUnit,
        idempotencyKey: "stock-sale:test:1",
        clientMovementId: "stock-sale:test:1",
      };
      const event = { type: "STOCK_SALE", payload };

      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ssale-1" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      // Retry under a brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await ctx.post("/api/sync/push", { events: [{ ...event, eventId: "ssale-1-retry" }] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const fresh = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(fresh.stockBaseQty, 7, "sale of 3 applied exactly once (10 → 7), not twice");
      const saleRows = await ctx.db.stockLedger.findMany({
        where: { shopId: tenant.shop.id, productId: product.id, action: "sale" },
      });
      assert.equal(saleRows.length, 1, "exactly one sale ledger row despite the retry");
    });

    test("sync push CREATE_BILL works", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 30 });
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "create-bill-1", type: "CREATE_BILL", payload: { bill: billPayload(product, { quantity: 2, ratePerRateUnit: 30 }) } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.ok(data.results[0].result.billId);
      const refreshedProduct = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshedProduct.stockBaseQty, 8);
    });

    test("delayed offline bills and udhar payments retain their original business dates", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 60 });
      const billBusinessDate = "2026-01-15T10:30:00.000Z";
      const paymentBusinessDate = "2026-01-16T09:15:00.000Z";
      const localBillId = "local-bill-business-date-1";

      const billResponse = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          eventId: "create-bill-business-date-1",
          type: "CREATE_BILL",
          client_created_at: billBusinessDate,
          payload: {
            localBillId,
            clientBillId: localBillId,
            idempotencyKey: "create-bill:test:business-date:1",
            bill: {
              ...billPayload(product, {
                quantity: 1,
                ratePerRateUnit: 60,
                customerId: customer.id,
                customerName: customer.name,
                buyerPaidAmount: 0,
                payments: [],
              }),
              localBillId,
              clientBillId: localBillId,
              idempotencyKey: "create-bill:test:business-date:1",
              creditAmount: 60,
              creditPayments: [{ mode: "credit", amount: 60 }],
              paymentStatus: "credit",
            },
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(billResponse.summary.synced, 1);

      const billId = billResponse.results[0].result.billId;
      const bill = await ctx.db.bill.findUnique({ where: { id: billId } });
      assert.equal(bill.businessDate.toISOString(), billBusinessDate, "bill keeps the device sale time, not the later sync time");

      const billUdhar = await ctx.db.udharLedger.findFirst({
        where: { shopId: tenant.shop.id, billId, type: "debit" },
      });
      assert.equal(billUdhar.businessDate.toISOString(), billBusinessDate, "bill debt stays on the same business day");

      const saleLedger = await ctx.db.financialLedger.findFirst({
        where: { shopId: tenant.shop.id, sourceType: "bill", sourceId: billId, entryType: "sale" },
      });
      assert.equal(saleLedger.businessDate.toISOString(), billBusinessDate, "financial sale posting uses the original business day");

      const report = assertSuccess(await ctx.get(
        "/api/reports/sales-summary?from=2026-01-15&to=2026-01-15",
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(report.totalBills, 1, "historical report finds the delayed offline sale on its actual day");
      assert.equal(report.totalSalesPaise, 6000);

      const paymentResponse = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          eventId: "udhar-payment-business-date-1",
          type: "UDHAR_PAYMENT",
          client_created_at: paymentBusinessDate,
          payload: {
            customerId: customer.id,
            localPaymentId: "local-payment-business-date-1",
            localLedgerEntryId: "local-ledger-business-date-1",
            idempotencyKey: "record-payment:test:business-date:1",
            payment: {
              amount: 20,
              mode: "cash",
              localPaymentId: "local-payment-business-date-1",
              localLedgerEntryId: "local-ledger-business-date-1",
              idempotencyKey: "record-payment:test:business-date:1",
            },
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(paymentResponse.summary.synced, 1);

      const paymentLedger = await ctx.db.udharLedger.findFirst({
        where: {
          shopId: tenant.shop.id,
          customerId: customer.id,
          type: "payment",
          clientLedgerId: "local-ledger-business-date-1",
        },
      });
      assert.equal(paymentLedger.businessDate.toISOString(), paymentBusinessDate, "repayment keeps the device payment time");
      const refreshedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(refreshedCustomer.udharAmount, 40);
    });

    test("offline CREATE_BILL with insufficient stock is recorded (not dropped), stock goes negative for reconcile", async () => {
      // The sale already happened at the counter offline; the server must record it rather
      // than reject + drop it. Stock is allowed to go negative so the shopkeeper sees the exact
      // deficit (per "allow stock shortfall" + "negative stock handling"), and the shortfall is
      // flagged on the sale ledger for reconciliation with the next stock-in.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 2, defaultPricePerRateUnit: 10 });
      const localBillId = "local-bill-shortfall-1";
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "create-bill-shortfall-1",
          type: "CREATE_BILL",
          payload: {
            localBillId,
            clientBillId: localBillId,
            idempotencyKey: "create-bill:test:shortfall:1",
            bill: {
              ...billPayload(product, { quantity: 5, ratePerRateUnit: 10, payments: [{ mode: "cash", amount: 50 }] }),
              localBillId,
              clientBillId: localBillId,
              idempotencyKey: "create-bill:test:shortfall:1",
            },
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1, "the completed offline sale is recorded, not rejected");
      assert.equal(data.summary.failed, 0);
      assert.equal(data.summary.conflicts, 0);

      const billId = data.results[0].result.billId;
      assert.ok(await ctx.db.bill.findUnique({ where: { id: billId } }), "bill is recorded");

      const refreshed = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(refreshed.stockBaseQty, -3, "stock reflects the real deficit (2 in stock, 5 sold) for reconciliation");

      const saleLedger = await ctx.db.stockLedger.findFirst({
        where: { shopId: tenant.shop.id, productId: product.id, action: "sale" },
      });
      assert.match(String(saleLedger?.note ?? ""), /shortfall/i, "shortfall flagged on the ledger for reconciliation");
    });

    test("sync push CREATE_BILL accepts separated creditAmount for udhar bill", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 80 });
      const localBillId = "local-bill-udhar-1";
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "create-udhar-bill-1",
          type: "CREATE_BILL",
          payload: {
            localBillId,
            clientBillId: localBillId,
            idempotencyKey: "create-bill:test:udhar:1",
            bill: {
              ...billPayload(product, {
                quantity: 1,
                ratePerRateUnit: 80,
                customerId: customer.id,
                customerName: customer.name,
                buyerPaidAmount: 0,
                payments: [],
              }),
              localBillId,
              clientBillId: localBillId,
              idempotencyKey: "create-bill:test:udhar:1",
              creditAmount: 80,
              creditPayments: [{ mode: "credit", amount: 80 }],
              paymentStatus: "credit",
            },
          },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 1);
      assert.equal(data.results[0].status, "synced");
      assert.equal(data.results[0].serverBillId, data.results[0].result.billId);
      assert.equal(data.idMappings.bills[localBillId], data.results[0].result.billId);

      const bill = await ctx.db.bill.findUnique({ where: { id: data.results[0].result.billId }, include: { payments: true } });
      assert.equal(bill.paidAmount, 0);
      assert.equal(bill.creditAmount, 80);
      assert.equal(bill.payments.length, 0);

      const updatedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updatedCustomer.udharAmount, 80);
      const ledger = await ctx.db.udharLedger.findFirst({ where: { shopId: tenant.shop.id, billId: bill.id, type: "debit" } });
      assert.equal(ledger.amount, 80);
    });

    test("two same-amount udhar payments can clear balance and retry idempotently", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, {
        name: "Split Pay Customer",
        type: "udhar",
        udharAmount: 200,
      });
      const eventA = {
        eventId: "udhar-split-pay-1",
        type: "UDHAR_PAYMENT",
        payload: {
          customerId: customer.id,
          localPaymentId: "local-payment-100-a",
          localLedgerEntryId: "local-ledger-100-a",
          idempotencyKey: "record-payment:test:split:a",
          payment: {
            amount: 100,
            mode: "cash",
            localPaymentId: "local-payment-100-a",
            localLedgerEntryId: "local-ledger-100-a",
            idempotencyKey: "record-payment:test:split:a",
          },
        },
      };
      const eventB = {
        eventId: "udhar-split-pay-2",
        type: "UDHAR_PAYMENT",
        payload: {
          customerId: customer.id,
          localPaymentId: "local-payment-100-b",
          localLedgerEntryId: "local-ledger-100-b",
          idempotencyKey: "record-payment:test:split:b",
          payment: {
            amount: 100,
            mode: "cash",
            localPaymentId: "local-payment-100-b",
            localLedgerEntryId: "local-ledger-100-b",
            idempotencyKey: "record-payment:test:split:b",
          },
        },
      };

      let data = assertSuccess(await ctx.post("/api/sync/push", {
        events: [eventA, eventB],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(data.summary.synced, 2);
      assert.equal(data.summary.failed, 0);

      data = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{ ...eventA, eventId: "udhar-split-pay-1-retry" }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(data.summary.synced, 1);
      assert.equal(data.results[0].result.idempotentReplay, true);

      const updatedCustomer = await ctx.db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updatedCustomer.udharAmount, 0);
      const paymentLedgers = await ctx.db.udharLedger.findMany({
        where: { shopId: tenant.shop.id, customerId: customer.id, type: "payment" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(paymentLedgers.length, 2);
      assert.deepEqual(paymentLedgers.map((row) => row.amount), [100, 100]);
    });

    test("same batch resolves local product and customer ids before creating bill", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [
          {
            eventId: "local-product-map-1",
            type: "CREATE_PRODUCT",
            payload: {
              localProductId: "local-prod-rice",
              product: productPayload({ localId: "local-prod-rice", name: "Offline Rice", stockBaseQty: 10, defaultPricePerRateUnit: 50 }),
            },
          },
          {
            eventId: "local-customer-map-1",
            type: "CREATE_CUSTOMER",
            payload: {
              localCustomerId: "local-cust-raju",
              customer: { localId: "local-cust-raju", name: "Raju Local", mobile: "6999999912", type: "regular" },
            },
          },
          {
            eventId: "local-bill-map-1",
            type: "CREATE_BILL",
            payload: {
              localBillId: "local-bill-rice-1",
              bill: {
                localId: "local-bill-rice-1",
                billType: "normal_sale",
                customerId: "local-cust-raju",
                localCustomerId: "local-cust-raju",
                customerName: "Raju Local",
                items: [
                  { productId: "local-prod-rice", localProductId: "local-prod-rice", name: "Offline Rice", quantity: 2, enteredUnit: "piece", ratePerRateUnit: 50, gstRate: 0 },
                ],
                discount: 0,
                buyerPaidAmount: 100,
                payments: [{ mode: "cash", amount: 100 }],
              },
            },
          },
        ],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });

      const data = assertSuccess(response);
      assert.equal(data.summary.synced, 3);
      assert.ok(data.idMappings.products["local-prod-rice"]);
      assert.ok(data.idMappings.customers["local-cust-raju"]);
      assert.ok(data.idMappings.bills["local-bill-rice-1"]);

      const bill = await ctx.db.bill.findUnique({ where: { id: data.idMappings.bills["local-bill-rice-1"] }, include: { items: true } });
      assert.equal(bill.customerId, data.idMappings.customers["local-cust-raju"]);
      assert.equal(bill.items[0].productId, data.idMappings.products["local-prod-rice"]);
    });

    test("duplicate event replay returns duplicate and does not duplicate DB row", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const event = { eventId: "duplicate-product-1", type: "CREATE_PRODUCT", payload: { product: productPayload({ name: "Only Once" }) } };
      assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const second = assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(second.summary.duplicates, 1);
      const count = await ctx.db.product.count({ where: { name: "Only Once" } });
      assert.equal(count, 1);
    });

    test("push batch over 500 is rejected with SYNC_BATCH_TOO_LARGE", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const events = Array.from({ length: 501 }, (_, i) => ({
        eventId: `too-large-${i}`,
        type: "CREATE_CUSTOMER",
        payload: { customer: { name: `Bulk ${i}`, type: "regular" } },
      }));
      const response = await ctx.post("/api/sync/push", { events }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assert.equal(response.status, 400, JSON.stringify(response.body));
      assert.equal(response.body?.code, "SYNC_BATCH_TOO_LARGE");
    });

    test("push response includes summary/serverTime", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{ eventId: "summary-1", type: "CREATE_CUSTOMER", payload: { customer: { name: "Summary Customer", type: "regular" } } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.ok(response.body.summary);
      assert.ok(response.body.serverTime);
      assert.ok(response.body.data.summary);
      assert.ok(response.body.data.serverTime);
    });

    test("pull supports since/cursor/limit and returns hasMore/nextCursor metadata", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      await createProduct(ctx.db, tenant.shop.id, { name: unique("Pull A") });
      await createProduct(ctx.db, tenant.shop.id, { name: unique("Pull B") });
      const since = encodeURIComponent(new Date(0).toISOString());
      const first = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=1`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.sync.limit, 1);
      assert.equal(first.sync.hasMore, true);
      assert.ok(first.sync.nextCursor);

      const second = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=1&cursor=${encodeURIComponent(first.sync.nextCursor)}`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.ok("hasMore" in second.sync);
      assert.ok("nextCursor" in second.sync);
    });

    test("sequence pull cannot miss same-record updates and emits durable tombstones", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: unique("Sequence Product") });
      const since = encodeURIComponent(new Date(0).toISOString());
      const baseline = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&afterSeq=0&limit=1000`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(baseline.sync.protocol, "server_sequence_v2");
      assert.ok(baseline.changes.some((change) => change.entity_id === product.id));
      const baselineSeq = BigInt(baseline.sync.nextServerSeq);

      await ctx.db.product.update({ where: { id: product.id }, data: { name: "Sequence update one" } });
      await ctx.db.product.update({ where: { id: product.id }, data: { name: "Sequence update two" } });
      const first = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&afterSeq=${baselineSeq}&limit=1`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.sync.hasMore, true);
      assert.equal(first.changes.length, 1);
      assert.equal(first.changes[0].entity.name, "Sequence update two", "change feed resolves to the committed current snapshot");
      const firstSeq = BigInt(first.sync.nextServerSeq);
      assert.ok(firstSeq > baselineSeq);

      const second = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&afterSeq=${firstSeq}&limit=1`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(second.changes.length, 1);
      assert.ok(BigInt(second.sync.nextServerSeq) > firstSeq, "each mutation receives a strictly increasing cursor");

      const beforeDelete = second.sync.nextServerSeq;
      await ctx.db.product.delete({ where: { id: product.id } });
      const deleted = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&afterSeq=${beforeDelete}&limit=100`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const tombstone = deleted.changes.find((change) => change.entity_id === product.id && change.operation_type === "delete");
      assert.ok(tombstone, "hard deletes must reach every device as a sequence tombstone");
      assert.equal(tombstone.entity, null);
    });

    test("cashier sync pull excludes product cost + supplier/purchase data; owner pull includes cost", async () => {
      // Synced data lives in inspectable IndexedDB, so a cashier device must never receive
      // cost/profit/supplier/purchase-cost data even though the UI hides it.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDevice = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "cashier-pull-device" });
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 50, costPerRateUnit: 30 });

      const since = encodeURIComponent(new Date(0).toISOString());
      const ownerPull = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const cashierPull = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=200`, { token: staffAuth.accessToken, headers: { "x-device-id": staffDevice.deviceId } }));

      const ownerProduct = ownerPull.products.find((p) => p.id === product.id);
      assert.equal(ownerProduct?.costPerRateUnit, 30, "owner receives product cost");

      const cashierProduct = cashierPull.products.find((p) => p.id === product.id);
      assert.ok(cashierProduct, "cashier still receives the product for billing");
      assert.equal(cashierProduct.costPerRateUnit, undefined, "cashier must NOT receive product cost");
      assert.equal(cashierProduct.defaultPricePerRateUnit, 50, "cashier still gets the selling price");
      assert.equal(cashierPull.suppliers.length, 0, "cashier receives no supplier records");
      assert.equal(cashierPull.purchaseHistory.length, 0, "cashier receives no purchase-cost history");
    });

    test("pull is shop-scoped", async () => {
      const a = await createTenant(ctx.db);
      const b = await createTenant(ctx.db);
      const authA = await login(ctx, a.ownerMobile, a.ownerPassword);
      const deviceA = await activateDeviceViaApi(ctx, authA.accessToken, { deviceId: "sync-a-device" });
      const productA = await createProduct(ctx.db, a.shop.id, { name: "A Sync Product" });
      const productB = await createProduct(ctx.db, b.shop.id, { name: "B Sync Product" });
      const since = encodeURIComponent(new Date(0).toISOString());
      const data = assertSuccess(await ctx.get(`/api/sync/pull?since=${since}&limit=100`, { token: authA.accessToken, headers: { "x-device-id": deviceA.deviceId } }));
      assert.ok(data.products.some((p) => p.id === productA.id));
      assert.equal(data.products.some((p) => p.id === productB.id), false);
    });

    test("ownerPin is stripped from stored OfflineSyncEvent requestJson/resultJson", async () => {
      const { ownerAuth, deviceHeaders } = await ownerCtx();
      const response = await ctx.post("/api/sync/push", {
        events: [{
          eventId: "pin-strip-sync-1",
          type: "CREATE_CUSTOMER",
          ownerPin: "1234",
          payload: { customer: { name: "Pin Safe", type: "regular", ownerPin: "1234" }, ownerPin: "1234" },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assertSuccess(response);
      const stored = await ctx.db.offlineSyncEvent.findFirst({ where: { eventId: "pin-strip-sync-1" } });
      assert.ok(stored);
      assert.doesNotMatch(stored.requestJson || "", /ownerPin|1234/i);
      assert.doesNotMatch(stored.resultJson || "", /ownerPin|1234/i);
    });

    // ── Bill durable-identity on pull ─────────────────────────────────────────
    // The offline double-count bug: a pulled server bill must carry its real
    // clientBillId/idempotencyKey columns so the client can collapse the pending
    // local row into it. These guard that pullSince returns them directly, with
    // no dependence on any recent-events window.

    async function pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId }) {
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });
      const billBody = {
        ...billPayload(product, {
          quantity: 1, ratePerRateUnit: 100,
          customerId: customer.id, customerName: customer.name,
          buyerPaidAmount: 100, payments: [{ mode: "cash", amount: 100 }],
        }),
        localBillId, clientBillId: localBillId, idempotencyKey,
      };
      return ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CREATE_BILL", payload: { localBillId, clientBillId: localBillId, idempotencyKey, bill: billBody } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    }

    const sinceEpoch = () => encodeURIComponent(new Date(0).toISOString());

    test("pull returns each bill's real clientBillId/idempotencyKey/sourceDeviceId columns", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-pullid-1";
      const idempotencyKey = "create-bill:test:pullid:1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId: "pull-id-1" }));

      const pull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const bill = pull.bills.find((b) => b.clientBillId === localBillId);
      assert.ok(bill, "pulled bill carries its real clientBillId column");
      assert.equal(bill.idempotencyKey, idempotencyKey, "pulled bill carries its idempotencyKey column");
      assert.ok(bill.sourceDeviceId, "pulled bill carries its sourceDeviceId column");
    });

    test("clientBillId survives on pull even with no CREATE_BILL sync events left (column-sourced, window-independent)", async () => {
      // Reproduces the >200-events / pruned-events case: the durable identity must
      // come from the bill row itself, never a recent CREATE_BILL event window.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-nowindow-1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey: "create-bill:test:nowindow:1", eventId: "no-window-1" }));

      // Drop every CREATE_BILL audit event — the old enrichment reconstructed
      // identity from these, so with them gone a window-based impl returns nothing.
      await ctx.db.offlineSyncEvent.deleteMany({ where: { shopId: tenant.shop.id, type: "CREATE_BILL" } });

      const pull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const bill = pull.bills.find((b) => b.clientBillId === localBillId);
      assert.ok(bill, "clientBillId still returned with zero CREATE_BILL events (it comes from the column)");
    });

    test("re-pushing the same bill under a new event id never creates a second bill; pull returns exactly one", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-rebush-1";
      const idempotencyKey = "create-bill:test:repush:1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId: "repush-1" }));
      // Lost-ack retry: same bill, brand-new event id (event-level idempotency cannot catch this).
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey, eventId: "repush-1-retry" }));

      const count = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, clientBillId: localBillId } });
      assert.equal(count, 1, "the retried push must converge on a single bill");

      const pull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const matches = pull.bills.filter((b) => b.clientBillId === localBillId);
      assert.equal(matches.length, 1, "pull returns exactly one bill for the client identity");
    });

    test("cashier pull still carries bill clientBillId (durable identity is not cost data)", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const localBillId = "local-bill-cashier-1";
      assertSuccess(await pushOneBill(tenant, ownerAuth, deviceHeaders, { localBillId, idempotencyKey: "create-bill:test:cashier:1", eventId: "cashier-id-1" }));

      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDevice = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "cashier-identity-device" });

      const cashierPull = assertSuccess(await ctx.get(`/api/sync/pull?since=${sinceEpoch()}&limit=200`, { token: staffAuth.accessToken, headers: { "x-device-id": staffDevice.deviceId } }));
      const bill = cashierPull.bills.find((b) => b.clientBillId === localBillId);
      assert.ok(bill, "cashier still receives the bill's clientBillId so it can de-dupe its own pending row");
      assert.equal(bill.grossProfit, undefined, "cashier still must NOT receive profit");
    });

    // ── Edit-after-finalize (void + recreate) and add-on ──────────────────────
    // The frontend never mutates a finalized bill: "Edit" = cancelBill(old) +
    // confirmBill(new) and "Add items" = confirmBill(new add-on), both over the
    // existing CREATE_BILL / CANCEL_BILL outbox events. These prove the SERVER
    // outcome of exactly that event sequence: one active bill, stock/udhar/totals
    // reflecting only the surviving bill(s), and idempotent under lost-ack retries.

    async function pushSale(ownerAuth, deviceHeaders, { product, customer, qty, rate, paid = 0, credit = 0, localBillId, idempotencyKey, eventId }) {
      const billBody = {
        ...billPayload(product, {
          quantity: qty,
          ratePerRateUnit: rate,
          customerId: customer ? customer.id : undefined,
          customerName: customer ? customer.name : "Walk-in",
          buyerPaidAmount: paid,
          payments: paid > 0 ? [{ mode: "cash", amount: paid }] : [],
        }),
        localBillId,
        clientBillId: localBillId,
        idempotencyKey,
        ...(credit > 0 ? { creditAmount: credit } : {}),
      };
      return ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CREATE_BILL", payload: { localBillId, clientBillId: localBillId, idempotencyKey, bill: billBody } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    }

    async function pushCancel(ownerAuth, deviceHeaders, { clientBillId, eventId, reason = "Edited — replaced by corrected bill" }) {
      return ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CANCEL_BILL", ownerPin: "1234", payload: { billId: clientBillId, localBillId: clientBillId, reason, ownerPin: "1234" } }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
    }

    test("edit-after-finalize (cancel old + create new) leaves exactly one active bill in totals, udhar and inventory", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id);
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      // Original finalized udhar bill A: 2 @ ₹100 = ₹200 on credit.
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, customer, qty: 2, rate: 100, credit: 200, localBillId: "edit-A", idempotencyKey: "ck:edit:A", eventId: "evt-edit-A" }));
      // The "edit": the corrected bill B is created first, then the original is voided
      // (exactly the order the frontend outbox emits).
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, customer, qty: 3, rate: 100, credit: 300, localBillId: "edit-B", idempotencyKey: "ck:edit:B", eventId: "evt-edit-B" }));
      assertSuccess(await pushCancel(ownerAuth, deviceHeaders, { clientBillId: "edit-A", eventId: "evt-edit-A-cancel" }));

      const billA = await ctx.db.bill.findFirst({ where: { shopId: tenant.shop.id, clientBillId: "edit-A" } });
      const billB = await ctx.db.bill.findFirst({ where: { shopId: tenant.shop.id, clientBillId: "edit-B" } });
      assert.equal(billA.status, "cancelled", "the original bill is voided");
      assert.equal(billB.status, "active", "the corrected bill stays active");
      assert.notEqual(billA.clientBillId, billB.clientBillId, "the corrected bill has its own client identity");
      const activeCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      assert.equal(activeCount, 1, "exactly one active bill survives the edit");

      // Inventory: A's 2 reversed, B's 3 applied → 10 - 3 = 7 (no stale double-deduction).
      const stocked = await ctx.db.product.findFirst({ where: { id: product.id } });
      assert.equal(stocked.stockBaseQty, 7, "stock reflects only the corrected bill");

      // Udhar: only B's ₹300 remains (A's ₹200 reversed on cancel).
      const ageing = assertSuccess(await ctx.get("/api/reports/udhar-ageing", { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(ageing.totalPendingUdharPaise, 30000, "udhar reflects only the corrected bill");
    });

    test("add items after finalize creates an independent add-on bill that sums with the original", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      // Original cash bill A (2 @ ₹100 = ₹200) and an add-on C (1 @ ₹100 = ₹100). No void.
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 2, rate: 100, paid: 200, localBillId: "addon-A", idempotencyKey: "ck:addon:A", eventId: "evt-addon-A" }));
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 1, rate: 100, paid: 100, localBillId: "addon-C", idempotencyKey: "ck:addon:C", eventId: "evt-addon-C" }));

      const activeCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      assert.equal(activeCount, 2, "the original and the add-on both stay active");

      const stocked = await ctx.db.product.findFirst({ where: { id: product.id } });
      assert.equal(stocked.stockBaseQty, 7, "both bills deduct stock (10 - 2 - 1)");

      const summary = assertSuccess(await ctx.get("/api/reports/payment-summary", { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(summary.total, 300, "dashboard total sums the original and the add-on");
    });

    test("re-pushing an offline edit (lost-ack retry) makes no duplicate bill and no stale stock", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10, defaultPricePerRateUnit: 100 });

      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 2, rate: 100, paid: 200, localBillId: "redo-A", idempotencyKey: "ck:redo:A", eventId: "evt-redo-A" }));
      assertSuccess(await pushSale(ownerAuth, deviceHeaders, { product, qty: 3, rate: 100, paid: 300, localBillId: "redo-B", idempotencyKey: "ck:redo:B", eventId: "evt-redo-B" }));
      assertSuccess(await pushCancel(ownerAuth, deviceHeaders, { clientBillId: "redo-A", eventId: "evt-redo-A-cancel" }));

      // Lost-ack retry: the whole edit replays under brand-new event ids. Re-cancel of an
      // already-cancelled bill and re-create under the same idempotency key are both no-ops.
      await pushSale(ownerAuth, deviceHeaders, { product, qty: 3, rate: 100, paid: 300, localBillId: "redo-B", idempotencyKey: "ck:redo:B", eventId: "evt-redo-B-retry" });
      await pushCancel(ownerAuth, deviceHeaders, { clientBillId: "redo-A", eventId: "evt-redo-A-cancel-retry" });

      const bCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, clientBillId: "redo-B" } });
      assert.equal(bCount, 1, "the corrected bill is not duplicated by the retry");
      const activeCount = await ctx.db.bill.count({ where: { shopId: tenant.shop.id, status: "active" } });
      assert.equal(activeCount, 1, "still exactly one active bill after the retry");
      const stocked = await ctx.db.product.findFirst({ where: { id: product.id } });
      assert.equal(stocked.stockBaseQty, 7, "re-cancel doesn't restore stock twice and re-create doesn't deduct twice");
    });

    test("supplier payment and owner reversal are append-only, exact-once, and restore due", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 10 });
      const purchase = await ctx.db.purchaseHistory.create({
        data: {
          shopId: tenant.shop.id,
          productId: product.id,
          supplierName: "Ledger Supplier",
          qtyBase: 2,
          pricePerRateUnit: 500,
          totalCost: 1000,
          billAmount: 1000,
          purchasePaidAmount: 100,
          purchaseDueAmount: 900,
          purchasePaymentStatus: "partial",
        },
      });
      const paymentEvent = {
        eventId: "supplier-payment-proof-1",
        type: "RECORD_SUPPLIER_PAYMENT",
        payload: { purchaseHistoryId: purchase.id, paymentId: "local-supplier-payment-1", amount: 250, mode: "upi", reference: "UTR-1001" },
      };
      const first = assertSuccess(await ctx.post("/api/sync/push", { events: [paymentEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.results[0].success, true);
      const paymentLedger = await ctx.db.financialLedger.findFirst({ where: { shopId: tenant.shop.id, sourceType: "supplier_payment", sourceId: "local-supplier-payment-1" } });
      assert.equal(first.results[0].serverId, paymentLedger.id, "payment reconciliation must expose the ledger id, never the purchase-history id");
      assertSuccess(await ctx.post("/api/sync/push", { events: [paymentEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      let updated = await ctx.db.purchaseHistory.findUnique({ where: { id: purchase.id } });
      assert.equal(updated.purchasePaidAmount, 350);
      assert.equal(updated.purchaseDueAmount, 650);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceType: "supplier_payment" } }), 1, "event replay never duplicates payment");

      const reverseEvent = {
        eventId: "supplier-payment-reverse-proof-1",
        type: "REVERSE_SUPPLIER_PAYMENT",
        ownerPin: "1234",
        payload: { paymentId: "local-supplier-payment-1", reason: "Duplicate UPI posting", ownerPin: "1234" },
      };
      const reversed = assertSuccess(await ctx.post("/api/sync/push", { events: [reverseEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const reversalLedger = await ctx.db.financialLedger.findFirst({ where: { shopId: tenant.shop.id, sourceType: "supplier_payment_reversal", sourceId: paymentLedger.id } });
      assert.equal(reversed.results[0].serverId, reversalLedger.id, "reversal reconciliation must expose the reversal-ledger id");
      assertSuccess(await ctx.post("/api/sync/push", { events: [reverseEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      updated = await ctx.db.purchaseHistory.findUnique({ where: { id: purchase.id } });
      assert.equal(updated.purchasePaidAmount, 100);
      assert.equal(updated.purchaseDueAmount, 900);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceType: "supplier_payment_reversal" } }), 1, "reversal replay is exact-once");
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: { in: ["SUPPLIER_PAYMENT_RECORDED", "SUPPLIER_PAYMENT_REVERSED"] } } }), 2);
    });

    test("push conflicts are persisted once with redacted snapshots and survive event replay", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const event = {
        eventId: "durable-conflict-event-1",
        type: "CREATE_PRODUCT",
        ownerPin: "1234",
        payload: {
          localProductId: "local_product_conflict_1",
          ownerPin: "1234",
          product: { name: "" },
        },
      };

      const first = assertSuccess(await ctx.post(
        "/api/sync/push",
        { events: [event] },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(first.summary.conflicts, 1);
      const firstConflictId = first.results[0].result.conflict_id;
      assert.ok(firstConflictId, "push result exposes the durable conflict id");

      const stored = await ctx.db.syncConflict.findUnique({ where: { id: firstConflictId } });
      assert.equal(stored.shopId, tenant.shop.id);
      assert.equal(stored.sourceEventId, event.eventId);
      assert.equal(stored.status, "open");
      assert.equal(stored.entityType, "product");
      assert.equal(stored.entityId, "local_product_conflict_1");
      assert.equal(stored.localSnapshotJson.includes("1234"), false, "owner PIN is never persisted in snapshots");

      const replay = assertSuccess(await ctx.post(
        "/api/sync/push",
        { events: [event] },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(replay.results[0].result.conflict_id, firstConflictId);
      assert.equal(
        await ctx.db.syncConflict.count({ where: { shopId: tenant.shop.id, sourceEventId: event.eventId } }),
        1,
        "event replay reuses one durable conflict record",
      );
    });

    test("client conflict reporting is idempotent and owner listing is tenant and role scoped", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const reportBody = {
        client_conflict_id: "client-conflict-1",
        entity_type: "product",
        entity_id: "server_product_1",
        reason_code: "SERVER_DELETED_LOCAL_EDIT",
        message: "Server deleted a product with a pending local edit",
        local_snapshot: { id: "server_product_1", name: "Local name", ownerPin: "1234" },
        server_snapshot: null,
        server_version: "72",
      };

      const reported = assertSuccess(await ctx.post(
        "/api/sync/conflicts/report",
        reportBody,
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      )).conflict;
      const repeated = assertSuccess(await ctx.post(
        "/api/sync/conflicts/report",
        { ...reportBody, message: "Same conflict reported again" },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      )).conflict;
      assert.equal(repeated.id, reported.id, "same client conflict id is an idempotent upsert");
      assert.equal(
        JSON.stringify(repeated.local_snapshot).includes("1234"),
        false,
        "client-reported snapshots are redacted server-side",
      );

      const listed = assertSuccess(await ctx.get(
        "/api/sync/conflicts?status=open&limit=20",
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(listed.summary.open, 1);
      assert.equal(listed.conflicts[0].id, reported.id);

      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDevice = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "conflict-cashier-device" });
      const denied = await ctx.get("/api/sync/conflicts", {
        token: staffAuth.accessToken,
        headers: { "x-device-id": staffDevice.deviceId },
      });
      assert.equal(denied.status, 403, "cashiers cannot inspect cross-device conflict snapshots");

      const other = await createTenant(ctx.db, { ownerPin: "5678" });
      const otherAuth = await login(ctx, other.ownerMobile, other.ownerPassword);
      const otherDevice = await activateDeviceViaApi(ctx, otherAuth.accessToken, { deviceId: "other-conflict-device" });
      const otherList = assertSuccess(await ctx.get("/api/sync/conflicts", {
        token: otherAuth.accessToken,
        headers: { "x-device-id": otherDevice.deviceId },
      }));
      assert.equal(otherList.conflicts.length, 0, "a different shop cannot see this tenant's conflict ledger");
    });

    test("owner conflict resolution is optimistic, audited, and visible across devices", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Server customer" });
      const conflict = assertSuccess(await ctx.post(
        "/api/sync/conflicts/report",
        {
          client_conflict_id: "resolution-conflict-1",
          entity_type: "customer",
          entity_id: customer.id,
          reason_code: "VERSION_MISMATCH",
          message: "Customer changed on another device",
          local_snapshot: { id: customer.id, name: "Local customer" },
          server_snapshot: { id: customer.id, name: "Server customer" },
        },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      )).conflict;

      const resolved = assertSuccess(await ctx.post(
        "/api/sync/resolve-conflict",
        {
          conflict_id: conflict.id,
          resolution: "use_server",
          expected_version: 1,
          note: "Reviewed against the paper ledger",
        },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      )).conflict;
      assert.equal(resolved.status, "resolved");
      assert.equal(resolved.resolution, "use_server");
      assert.equal(resolved.version, 2);
      assert.equal(resolved.resolved_by_user_id, tenant.owner.id);
      assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).name, "Server customer");

      const staleDecision = await ctx.post(
        "/api/sync/resolve-conflict",
        { conflict_id: conflict.id, resolution: "dismiss", expected_version: 1 },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      );
      assert.equal(staleDecision.status, 409, "a competing decision cannot overwrite the recorded resolution");

      const audit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, action: "SYNC_CONFLICT_RESOLVED", entityId: conflict.id },
      });
      assert.ok(audit, "the owner resolution has an immutable audit record");

      const history = assertSuccess(await ctx.get(
        "/api/sync/conflicts?status=resolved",
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(history.conflicts[0].id, conflict.id);
      assert.equal(history.conflicts[0].resolution_note, "Reviewed against the paper ledger");
    });

    test("owner conflict resolution applies mutable local data but blocks financial overwrites", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Cloud name" });
      const mutable = assertSuccess(await ctx.post("/api/sync/conflicts/report", {
        client_conflict_id: "apply-local-customer",
        entity_type: "customer",
        entity_id: customer.id,
        reason_code: "VERSION_MISMATCH",
        message: "Customer name changed offline",
        local_snapshot: { id: customer.id, name: "Counter name" },
        server_snapshot: { id: customer.id, name: "Cloud name" },
      }, { token: ownerAuth.accessToken, headers: deviceHeaders })).conflict;

      assertSuccess(await ctx.post("/api/sync/resolve-conflict", {
        conflict_id: mutable.id,
        resolution: "use_local",
        expected_version: mutable.version,
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal((await ctx.db.customer.findUnique({ where: { id: customer.id } })).name, "Counter name");

      const financial = assertSuccess(await ctx.post("/api/sync/conflicts/report", {
        client_conflict_id: "block-financial-overwrite",
        entity_type: "payment",
        entity_id: "payment_1",
        reason_code: "VERSION_MISMATCH",
        message: "Payment differs",
        local_snapshot: { id: "payment_1", amount: 100 },
        server_snapshot: { id: "payment_1", amount: 200 },
      }, { token: ownerAuth.accessToken, headers: deviceHeaders })).conflict;
      const blocked = await ctx.post("/api/sync/resolve-conflict", {
        conflict_id: financial.id,
        resolution: "use_local",
        expected_version: financial.version,
      }, { token: ownerAuth.accessToken, headers: deviceHeaders });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.body?.code, "SYNC_CONFLICT_COMPENSATING_ENTRY_REQUIRED");
      assert.equal((await ctx.db.syncConflict.findUnique({ where: { id: financial.id } })).status, "open");
    });

    test("owner conflict resolution accepts whole-record snapshots as the app actually stores them", async () => {
      // Real snapshots are captured off an offline device row / server DTO: client-only
      // sync columns, server-managed columns, and null for every empty optional field.
      // Resolution used to reject those outright ("expected string, received null" on
      // hsn/brand/imageUrl), so every Keep local / Keep cloud died with a generic error.
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "gops", stockBaseQty: 20, costPerRateUnit: 10 });
      const serverSnapshot = {
        ...(await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } })),
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        costPerRateUnitPaise: null,
        minPricePerRateUnitPaise: null,
        defaultPricePerRateUnitPaise: null,
        aliases: [],
      };
      const localSnapshot = {
        ...serverSnapshot,
        // Offline row: local identity + sync bookkeeping alongside the entity fields.
        id: "product_local_1",
        local_id: "product_local_1",
        server_id: product.id,
        tenant_id: tenant.shop.id,
        store_id: "store_1",
        sync_status: "conflict",
        version: 3,
        name: "gops counter",
        brand: "Local brand",
        defaultPricePerRateUnit: 26,
        stockBaseQty: 999, // stock must never ride along on an owner decision
        costPerRateUnit: 999,
      };
      const conflict = assertSuccess(await ctx.post("/api/sync/conflicts/report", {
        client_conflict_id: "conflict_product_gops_1",
        entity_type: "product",
        entity_id: product.id,
        reason_code: "CLIENT_SYNC_CONFLICT",
        message: "Server changed an entity that has unsynced local changes",
        local_snapshot: localSnapshot,
        server_snapshot: serverSnapshot,
      }, { token: ownerAuth.accessToken, headers: deviceHeaders })).conflict;

      assertSuccess(await ctx.post("/api/sync/resolve-conflict", {
        conflict_id: conflict.id,
        resolution: "use_local",
        expected_version: conflict.version,
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const applied = await ctx.db.product.findUniqueOrThrow({ where: { id: product.id } });
      assert.equal(applied.name, "gops counter");
      assert.equal(applied.brand, "Local brand");
      assert.equal(applied.defaultPricePerRateUnit, 26);
      assert.equal(applied.hsn, null, "an empty optional field stays empty instead of failing validation");
      assert.equal(applied.stockBaseQty, 20, "stock moves through the stock ledger, never through a conflict snapshot");
      assert.equal(applied.costPerRateUnit, 10, "weighted-average cost is never restored from a snapshot");
    });

    test("owner conflict resolution restores a supplier snapshot carrying null contact fields", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const supplier = await ctx.db.supplier.create({
        data: { shopId: tenant.shop.id, name: "Cloud supplier", mobile: "9876543210", address: null },
      });
      const conflict = assertSuccess(await ctx.post("/api/sync/conflicts/report", {
        client_conflict_id: "conflict_supplier_1",
        entity_type: "supplier",
        entity_id: supplier.id,
        reason_code: "CLIENT_SYNC_CONFLICT",
        message: "Server changed an entity that has unsynced local changes",
        local_snapshot: { ...supplier, createdAt: null, updatedAt: null, deletedAt: null, name: "Counter supplier", mobile: null },
        server_snapshot: { ...supplier, createdAt: null, updatedAt: null, deletedAt: null },
      }, { token: ownerAuth.accessToken, headers: deviceHeaders })).conflict;

      assertSuccess(await ctx.post("/api/sync/resolve-conflict", {
        conflict_id: conflict.id,
        resolution: "use_local",
        expected_version: conflict.version,
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const applied = await ctx.db.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
      assert.equal(applied.name, "Counter supplier");
      assert.equal(applied.mobile, null, "the chosen version's empty contact clears the stored one");
    });

    test("offline expense creation is exact-once and enters the device sync feed", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const event = {
        eventId: "expense-offline-1",
        type: "CREATE_EXPENSE",
        payload: {
          localExpenseId: "expense_local_1",
          expense: {
            idempotencyKey: "create-expense:expense_local_1",
            clientExpenseId: "expense_local_1",
            title: "Generator diesel",
            amount: 850,
            category: "Utilities",
            paymentMode: "cash",
            status: "paid",
            spentAt: "2026-07-31T10:00:00.000Z",
          },
        },
      };
      const first = assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const replay = assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.summary.synced, 1, JSON.stringify(first));
      assert.equal(replay.summary.duplicates, 1);
      assert.equal(await ctx.db.expense.count({ where: { shopId: tenant.shop.id, idempotencyKey: "create-expense:expense_local_1" } }), 1);
      const log = await ctx.db.changeLog.findFirst({ where: { shopId: tenant.shop.id, entityType: "expense" }, orderBy: { seq: "desc" } });
      assert.ok(log);
      const pulled = assertSuccess(await ctx.get(`/api/sync/pull?since=1970-01-01T00%3A00%3A00.000Z&afterSeq=${Number(log.seq) - 1}&limit=10`, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(pulled.changes.some((change) => change.entity_type === "expense" && change.entity?.title === "Generator diesel"), true);

      const expense = await ctx.db.expense.findFirstOrThrow({ where: { shopId: tenant.shop.id, idempotencyKey: "create-expense:expense_local_1" } });
      const updateEvent = {
        eventId: "expense-update-offline-1",
        type: "UPDATE_EXPENSE",
        payload: { expenseId: expense.id, localExpenseId: "expense_local_1", changes: { ...event.payload.expense, amount: 900 } },
      };
      assert.equal(assertSuccess(await ctx.post("/api/sync/push", { events: [updateEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders })).summary.synced, 1);
      assert.equal(assertSuccess(await ctx.post("/api/sync/push", { events: [updateEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders })).summary.duplicates, 1);
      assert.equal((await ctx.db.expense.findUnique({ where: { id: expense.id } })).amount, 900);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceType: "expense_update", sourceId: `${expense.id}:expense-update-offline-1` } }), 4);

      const deleteEvent = {
        eventId: "expense-delete-offline-1",
        type: "DELETE_EXPENSE",
        payload: { expenseId: expense.id, localExpenseId: "expense_local_1", ownerPin: "1234" },
      };
      assert.equal(assertSuccess(await ctx.post("/api/sync/push", { events: [deleteEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders })).summary.synced, 1);
      assert.equal(assertSuccess(await ctx.post("/api/sync/push", { events: [deleteEvent] }, { token: ownerAuth.accessToken, headers: deviceHeaders })).summary.duplicates, 1);
      assert.ok((await ctx.db.expense.findUnique({ where: { id: expense.id } })).deletedAt);
      assert.equal(await ctx.db.financialLedger.count({ where: { shopId: tenant.shop.id, sourceType: "expense_delete", sourceId: `${expense.id}:expense-delete-offline-1` } }), 2);
    });

    test("device sequence acknowledgements are monotonic, bounded, role-scoped, and tenant-scoped", async () => {
      const { tenant, ownerAuth, deviceHeaders, device } = await ownerCtx();
      await createProduct(ctx.db, tenant.shop.id, { name: "Acknowledgement Product" });

      const status = assertSuccess(await ctx.get(
        "/api/sync/status",
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      const serverSeq = String(status.server_version);
      assert.ok(BigInt(serverSeq) > 0n, "fixture mutation creates a server sequence");

      const first = assertSuccess(await ctx.post(
        "/api/sync/ack",
        { server_seq: serverSeq },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      )).acknowledgement;
      assert.equal(first.accepted, true);
      assert.equal(first.applied_server_seq, serverSeq);
      assert.equal(first.lag, "0");

      const stale = assertSuccess(await ctx.post(
        "/api/sync/ack",
        { server_seq: "0" },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      )).acknowledgement;
      assert.equal(stale.accepted, false, "a delayed acknowledgement cannot move the cursor backwards");
      assert.equal(stale.stale_ack_ignored, true);
      assert.equal(stale.applied_server_seq, serverSeq);

      const future = await ctx.post(
        "/api/sync/ack",
        { server_seq: String(BigInt(serverSeq) + 1n) },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      );
      assert.equal(future.status, 409, "a device cannot claim a sequence the shop server has not issued");

      const staleAt = new Date(Date.now() - 30 * 60 * 1000);
      await ctx.db.device.createMany({
        data: [
          {
            shopId: tenant.shop.id,
            deviceId: "fleet-stale-device",
            deviceName: "Back counter",
            lastAppliedServerSeq: 0,
            lastSyncAckAt: staleAt,
            lastSeenAt: staleAt,
          },
          {
            shopId: tenant.shop.id,
            deviceId: "fleet-never-device",
            deviceName: "New terminal",
          },
        ],
      });

      const fleet = assertSuccess(await ctx.get(
        "/api/sync/devices",
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(fleet.server_seq, serverSeq);
      assert.equal(fleet.summary.current, 1);
      assert.equal(fleet.summary.stale, 1);
      assert.equal(fleet.summary.never_acknowledged, 1);
      assert.equal(fleet.summary.attention, 2);
      assert.equal(
        fleet.devices.find((row) => row.device_id === device.deviceId).state,
        "current",
      );
      assert.equal(
        fleet.devices.find((row) => row.device_id === "fleet-stale-device").lag,
        serverSeq,
      );

      const staff = await createStaff(ctx.db, tenant.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const staffDevice = await activateDeviceViaApi(ctx, staffAuth.accessToken, { deviceId: "fleet-cashier-device" });
      const denied = await ctx.get("/api/sync/devices", {
        token: staffAuth.accessToken,
        headers: { "x-device-id": staffDevice.deviceId },
      });
      assert.equal(denied.status, 403, "cashiers cannot inspect other terminals' sync position");

      const other = await createTenant(ctx.db, { ownerPin: "5678" });
      const otherAuth = await login(ctx, other.ownerMobile, other.ownerPassword);
      const otherDevice = await activateDeviceViaApi(ctx, otherAuth.accessToken, { deviceId: "other-fleet-device" });
      const otherFleet = assertSuccess(await ctx.get("/api/sync/devices", {
        token: otherAuth.accessToken,
        headers: { "x-device-id": otherDevice.deviceId },
      }));
      assert.equal(
        otherFleet.devices.some((row) => row.device_id === "fleet-stale-device"),
        false,
        "fleet state never crosses shop boundaries",
      );
    });

    test("sync retention is dry-run by default and never deletes failed events or open conflicts", async () => {
      const { tenant } = await ownerCtx();
      const old = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
      const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await ctx.db.offlineSyncEvent.createMany({
        data: [
          { shopId: tenant.shop.id, eventId: "retention-synced", type: "CREATE_PRODUCT", status: "synced", createdAt: old },
          { shopId: tenant.shop.id, eventId: "retention-failed", type: "CREATE_PRODUCT", status: "failed", createdAt: old },
        ],
      });
      await ctx.db.syncConflict.createMany({
        data: [
          {
            id: "retention-resolved-conflict",
            shopId: tenant.shop.id,
            clientConflictId: "retention-resolved-client",
            entityType: "product",
            entityId: "product_resolved",
            reasonCode: "TEST",
            message: "Resolved old conflict",
            status: "resolved",
            resolvedAt: old,
            expiresAt: expired,
          },
          {
            id: "retention-open-conflict",
            shopId: tenant.shop.id,
            clientConflictId: "retention-open-client",
            entityType: "product",
            entityId: "product_open",
            reasonCode: "TEST",
            message: "Open old conflict",
            status: "open",
            expiresAt: expired,
          },
        ],
      });

      const dryRun = await runSyncRetentionCleanup({ retentionDays: 90, limit: 100 });
      assert.equal(dryRun.status, "DRY_RUN");
      assert.equal(dryRun.eligibleOfflineSyncEvents, 1, "only old synced events are eligible");
      assert.equal(dryRun.eligibleSyncConflicts, 1, "only expired closed conflicts are eligible");
      assert.equal(await ctx.db.offlineSyncEvent.count({ where: { shopId: tenant.shop.id } }), 2);
      assert.equal(await ctx.db.syncConflict.count({ where: { shopId: tenant.shop.id } }), 2);

      const applied = await runSyncRetentionCleanup({ retentionDays: 90, limit: 100, dryRun: false, confirm: true });
      assert.equal(applied.status, "APPLIED");
      assert.equal(applied.deletedOfflineSyncEvents, 1);
      assert.equal(applied.deletedSyncConflicts, 1);
      assert.ok(await ctx.db.offlineSyncEvent.findFirst({ where: { shopId: tenant.shop.id, eventId: "retention-failed" } }), "failed event remains retryable");
      assert.ok(await ctx.db.syncConflict.findUnique({ where: { id: "retention-open-conflict" } }), "open conflict is preserved");
    });
  });
}
