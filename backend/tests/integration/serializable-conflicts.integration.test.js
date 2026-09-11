import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createIntegrationContext, resetDatabase, assertSuccess, TEST_DATABASE_URL } from "./setup.js";
import { activateDeviceViaApi, createProduct, createTenant, login, productPayload } from "./factories.js";
import { isSqliteTestDatabaseUrl } from "../../scripts/test-db-utils.js";
import { serializableTransaction } from "../../src/lib/transactions.js";

// Two requests racing for the same rows. SQLite queues them, so the loser runs
// after the winner and its own guards answer; PostgreSQL aborts the loser's
// Serializable transaction (P2034), which used to reach the client as a 500.
// serializableTransaction replays the loser, which must give SQLite's answer:
// the HTTP races below expect the same statuses on both engines, and never a
// 500 or 503.

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("serializable conflict integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  const onSqlite = isSqliteTestDatabaseUrl(TEST_DATABASE_URL);

  async function ownerContext() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const credentials = { token: auth.accessToken };
    // Activate the device and the primary location before racing, so each race
    // is between the two writes under test and not two first-request setups.
    assertSuccess(await ctx.get("/api/orders", credentials));
    const location = await ctx.db.storeLocation.findFirstOrThrow({ where: { shopId: tenant.shop.id, isPrimary: true } });
    return { tenant, auth, credentials, location };
  }

  function createGuestOrder(tenant, location, overrides = {}) {
    return ctx.db.customerOrder.create({
      data: {
        shopId: tenant.shop.id,
        locationId: location.id,
        customerName: "Table guest",
        customerMobile: "9876500001",
        itemsJson: "[]",
        itemCount: 1,
        estimatedTotal: 240,
        ...overrides,
      },
    });
  }

  describe("a write conflict is replayed, not surfaced", () => {
    test("the losing transaction runs again and neither write is lost", {
      skip: onSqlite && "SQLite has one writer, so two open transactions cannot be forced to overlap; PostgreSQL proves this in CI.",
    }, async () => {
      const tenant = await createTenant(ctx.db);
      const counter = await createProduct(ctx.db, tenant.shop.id, { stockBaseQty: 0 });

      // Both transactions read the row before either writes. The second writer
      // then waits on the first's row lock and, once it commits, PostgreSQL
      // aborts it: "could not serialize access due to concurrent update".
      let arrivals = 0;
      let releaseReaders;
      const bothRead = new Promise((resolve) => { releaseReaders = resolve; });
      const attempts = [0, 0];
      const increment = (slot) => serializableTransaction(async (tx) => {
        attempts[slot] += 1;
        const row = await tx.product.findUniqueOrThrow({ where: { id: counter.id } });
        if (attempts[slot] === 1) {
          arrivals += 1;
          if (arrivals === 2) releaseReaders();
          const outcome = await Promise.race([bothRead.then(() => "read"), delay(5_000, "timeout", { ref: false })]);
          if (outcome === "timeout") throw new Error("the other transaction never reached its read");
        }
        await tx.product.update({ where: { id: counter.id }, data: { stockBaseQty: row.stockBaseQty + 1 } });
      }, { timeout: 15_000 });

      await Promise.all([increment(0), increment(1)]);

      const stored = await ctx.db.product.findUniqueOrThrow({ where: { id: counter.id } });
      assert.equal(stored.stockBaseQty, 2, "both increments must land");
      assert.equal(attempts[0] + attempts[1], 3, `exactly one transaction must lose and run again, got ${attempts}`);
    });
  });

  describe("racing requests on PostgreSQL get SQLite's answer", () => {
    test("two tills changing different fields of one order both succeed", async () => {
      const { tenant, credentials, location } = await ownerContext();
      // A few rounds, so a PostgreSQL run is all but certain to hit a conflict.
      for (let round = 0; round < 3; round += 1) {
        const order = await createGuestOrder(tenant, location);
        const responses = await Promise.all([
          ctx.patch(`/api/orders/${order.id}`, { paymentStatus: "paid" }, credentials),
          ctx.patch(`/api/orders/${order.id}`, { status: "accepted" }, credentials),
        ]);
        for (const response of responses) assertSuccess(response);

        const stored = await ctx.db.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
        assert.equal(stored.paymentStatus, "paid");
        assert.equal(stored.status, "accepted");
        // A replayed transaction's first attempt rolled back with its audit row.
        assert.equal(await ctx.db.auditLog.count({
          where: { shopId: tenant.shop.id, entityId: order.id, action: "CUSTOMER_ORDER_STATUS_UPDATED" },
        }), 2);
      }
    });

    test("two tills accepting one guest order: one claims it, the other is told", async () => {
      const { tenant, credentials, location } = await ownerContext();
      const order = await createGuestOrder(tenant, location, { fulfillmentType: "dine_in", tableName: "T4" });
      const keys = [randomUUID(), randomUUID()];
      const responses = await Promise.all(keys.map((acceptanceKey) => (
        ctx.patch(`/api/orders/${order.id}`, { status: "accepted", acceptanceKey }, credentials)
      )));

      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409], JSON.stringify(responses.map((response) => response.body)));
      const refused = responses.find((response) => response.status === 409);
      assert.equal(refused.body.code, "ORDER_ALREADY_CLAIMED");
      const winner = keys[responses.findIndex((response) => response.status === 200)];
      const stored = await ctx.db.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(stored.acceptanceKey, winner);
      assert.equal(await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, entityId: order.id, action: "CUSTOMER_ORDER_STATUS_UPDATED" },
      }), 1);
    });

    // One product queued offline, and a push of it under a given event id. Two
    // overlapping pushes send it under different event ids; the loser must
    // resolve to the winner's product. A 409 here would be recorded as a sync
    // conflict and parked for the shopkeeper.
    async function queuedOfflineProduct(name) {
      const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const device = await activateDeviceViaApi(ctx, auth.accessToken, { deviceId: "race-device" });
      const options = { token: auth.accessToken, headers: { "x-device-id": device.deviceId } };
      const product = productPayload({ name });
      const push = (eventId) => ctx.post("/api/sync/push", {
        events: [{ eventId, type: "CREATE_PRODUCT", payload: { localProductId: "local_prod_race", product, ownerPin: "1234" } }],
      }, options);
      return { tenant, push };
    }

    async function assertConvergedOnOneProduct(tenant, name, responses) {
      const serverIds = responses.map((response) => {
        const data = assertSuccess(response);
        assert.equal(data.summary.conflicts, 0, JSON.stringify(data.results));
        assert.equal(data.summary.failed, 0, JSON.stringify(data.results));
        return data.idMappings.products?.local_prod_race;
      });
      assert.ok(serverIds[0]);
      assert.equal(serverIds[1], serverIds[0], "both pushes must map the local product onto the same server product");
      assert.equal(await ctx.db.product.count({ where: { shopId: tenant.shop.id, name, deletedAt: null } }), 1);
    }

    test("one offline product pushed twice at once converges on one product", async () => {
      const { tenant, push } = await queuedOfflineProduct("Race Rusk 200g");
      const responses = await Promise.all([push("create-product-race-1"), push("create-product-race-2")]);
      await assertConvergedOnOneProduct(tenant, "Race Rusk 200g", responses);
    });

    test("a push whose twin commits between its replay lookup and its name check converges", async () => {
      // The schedule the race above only sometimes draws (release certification
      // run 34493467939), forced. Push 1 looks its product up by client identity
      // and finds nothing; push 2 then creates it; push 1's pre-transaction name
      // check finds that product under the same name. The reads stay real reads:
      // push 1's name check is only held until push 2 has committed.
      const { tenant, push } = await queuedOfflineProduct("Held Rusk 200g");
      const products = ctx.db.product;
      const originalFindMany = products.findMany;
      // createProduct's pre-transaction name check reads every active product's name.
      const isNameCheck = (args) => args?.select?.name === true
        && args.where?.shopId === tenant.shop.id
        && args.where.deletedAt === null
        && Object.keys(args.where).length === 2;
      let twin = null;
      products.findMany = async (args) => {
        if (!twin && isNameCheck(args)) {
          twin = push("create-product-held-2");
          const outcome = await Promise.race([twin.then(() => "done"), delay(10_000, "timeout", { ref: false })]);
          if (outcome === "timeout") throw new Error("push 2 never finished while push 1 waited at its name check");
        }
        return originalFindMany.call(products, args);
      };

      let first;
      try {
        first = await push("create-product-held-1");
      } finally {
        products.findMany = originalFindMany;
      }

      assert.ok(twin, "push 1 never reached its name check, so nothing was interleaved");
      await assertConvergedOnOneProduct(tenant, "Held Rusk 200g", [first, await twin]);
    });
  });
}
