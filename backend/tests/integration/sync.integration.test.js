import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, billPayload, createCustomer, createProduct, createTenant, login, productPayload, unique } from "./factories.js";

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
  });
}
