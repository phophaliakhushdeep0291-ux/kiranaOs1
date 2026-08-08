/**
 * Capture-on-first-scan against a real database.
 *
 * tests/barcode-binding.examples.js proves the service's decisions with a Prisma double.
 * This file proves the parts only a database can: that `Product_shopId_barcode_key`
 * actually exists on the deployed schema, that two simultaneous binds cannot both win,
 * and that a bind queued offline lands exactly once through /api/sync/push.
 */
import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { activateDeviceViaApi, createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("barcode binding integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerCtx() {
    const tenant = await createTenant(ctx.db, { ownerPin: "1234" });
    const ownerAuth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const device = await activateDeviceViaApi(ctx, ownerAuth.accessToken, { deviceId: "bind-device" });
    return { tenant, ownerAuth, deviceHeaders: { "x-device-id": device.deviceId } };
  }

  describe("barcode binding", () => {
    test("an unknown code binds to the picked product", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });

      const bound = assertSuccess(await ctx.post(
        `/api/products/${product.id}/barcode`,
        { barcode: "8901234567890" },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));
      assert.equal(bound.barcode, "8901234567890");

      const stored = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(stored.barcode, "8901234567890");
      assert.equal(stored.sku, "8901234567890", "an empty sku mirrors the code so either column resolves a scan");
    });

    test("the same code cannot be bound to a second product", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const first = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });
      const second = await createProduct(ctx.db, tenant.shop.id, { name: "Good Day" });

      assertSuccess(await ctx.post(`/api/products/${first.id}/barcode`, { barcode: "8901234567890" }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      const rejected = assertFailure(
        await ctx.post(`/api/products/${second.id}/barcode`, { barcode: "8901234567890" }, { token: ownerAuth.accessToken, headers: deviceHeaders }),
        409,
      );
      assert.match(JSON.stringify(rejected), /Parle-G/, "the cashier is told which product owns the code");

      const stored = await ctx.db.product.findUnique({ where: { id: second.id } });
      assert.equal(stored.barcode, null, "the losing product is left untouched");
    });

    test("the database itself refuses a duplicate, not just the service", async () => {
      // The UI check and the service check are both bypassable — an import, a script, a
      // future endpoint. The unique index is the guarantee that survives all of them.
      const { tenant } = await ownerCtx();
      const first = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });
      await ctx.db.product.update({ where: { id: first.id }, data: { barcode: "8901234567890" } });
      const second = await createProduct(ctx.db, tenant.shop.id, { name: "Good Day" });

      await assert.rejects(
        ctx.db.product.update({ where: { id: second.id }, data: { barcode: "8901234567890" } }),
        (error) => error.code === "P2002",
        "Product_shopId_barcode_key must exist on the deployed schema",
      );
    });

    test("products with no barcode do not collide with each other", async () => {
      // NULL is not a value in a unique index. The starter catalog ships all 560 rows
      // barcode-less, so this is the normal state of a new shop, not an edge case.
      const { tenant } = await ownerCtx();
      await createProduct(ctx.db, tenant.shop.id, { name: "Blank One" });
      await createProduct(ctx.db, tenant.shop.id, { name: "Blank Two" });
      const blanks = await ctx.db.product.count({ where: { shopId: tenant.shop.id, barcode: null } });
      assert.equal(blanks, 2, "a catalogue of unbarcoded products must be storable");
    });

    test("two devices binding the same code concurrently resolve without data loss", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const first = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });
      const second = await createProduct(ctx.db, tenant.shop.id, { name: "Good Day" });

      const [a, b] = await Promise.all([
        ctx.post(`/api/products/${first.id}/barcode`, { barcode: "8901234567890" }, { token: ownerAuth.accessToken, headers: deviceHeaders }),
        ctx.post(`/api/products/${second.id}/barcode`, { barcode: "8901234567890" }, { token: ownerAuth.accessToken, headers: deviceHeaders }),
      ]);

      const outcomes = [a, b].map((response) => response.status);
      assert.equal(outcomes.filter((status) => status < 400).length, 1, "exactly one device wins");
      assert.equal(outcomes.filter((status) => status === 409).length, 1, "the other is told the code was taken");

      const owners = await ctx.db.product.count({ where: { shopId: tenant.shop.id, barcode: "8901234567890" } });
      assert.equal(owners, 1, "the code resolves to exactly one product");

      const rows = await ctx.db.product.findMany({ where: { shopId: tenant.shop.id }, select: { name: true } });
      assert.equal(rows.length, 2, "neither product was lost or duplicated by the race");
    });

    test("a product that already has a code is never rebound from the till", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });
      assertSuccess(await ctx.post(`/api/products/${product.id}/barcode`, { barcode: "8901234567890" }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      assertFailure(
        await ctx.post(`/api/products/${product.id}/barcode`, { barcode: "8909999999999" }, { token: ownerAuth.accessToken, headers: deviceHeaders }),
        409,
      );
      const stored = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(stored.barcode, "8901234567890", "the original code survives");
    });

    test("the bind endpoint cannot be used to edit anything else", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G", defaultPricePerRateUnit: 20 });

      assertSuccess(await ctx.post(
        `/api/products/${product.id}/barcode`,
        { barcode: "8901234567890", name: "Renamed", defaultPricePerRateUnit: 1 },
        { token: ownerAuth.accessToken, headers: deviceHeaders },
      ));

      const stored = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(stored.name, "Parle-G", "a scan is not a product edit");
      assert.equal(Number(stored.defaultPricePerRateUnit), 20, "and it certainly is not a price change");
    });

    test("an offline bind syncs once and replay does not duplicate it", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });
      const event = {
        eventId: `barcode-bind:${product.id}:8901234567890`,
        type: "BIND_PRODUCT_BARCODE",
        payload: { productId: product.id, localProductId: product.id, barcode: "8901234567890" },
      };

      const first = assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(first.summary.synced, 1);

      // The device never saw the ack and pushes the same op again. The outbox keys it
      // deterministically on (product, code), so it is the same event id.
      const replay = assertSuccess(await ctx.post("/api/sync/push", { events: [event] }, { token: ownerAuth.accessToken, headers: deviceHeaders }));
      assert.equal(replay.results[0].status, "duplicate", "a replay is deduplicated, not re-applied");
      assert.equal(replay.results[0].success, true);

      const stored = await ctx.db.product.findUnique({ where: { id: product.id } });
      assert.equal(stored.barcode, "8901234567890");

      const audits = await ctx.db.auditLog.count({
        where: { shopId: tenant.shop.id, action: "product_barcode_bound", entityId: product.id },
      });
      assert.equal(audits, 1, "the bind is audited exactly once");
    });

    test("an offline bind that lost the code comes back as a conflict, not a retry", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const winner = await createProduct(ctx.db, tenant.shop.id, { name: "Good Day" });
      const loser = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });
      await ctx.db.product.update({ where: { id: winner.id }, data: { barcode: "8901234567890" } });

      const response = assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          eventId: `barcode-bind:${loser.id}:8901234567890`,
          type: "BIND_PRODUCT_BARCODE",
          payload: { productId: loser.id, barcode: "8901234567890" },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const result = response.results[0];
      assert.equal(result.status, "conflict", "it resolves through the existing conflict path");
      assert.equal(result.success, false);
      assert.equal(result.code, "PRODUCT_BARCODE_DUPLICATE", "the owner is told what to fix");
      assert.equal(result.result.retryable, false, "retrying it unchanged could never succeed");
      assert.ok(result.result.conflict_id, "and it lands in the durable conflict ledger like any other");

      const stored = await ctx.db.product.findUnique({ where: { id: loser.id } });
      assert.equal(stored.barcode, null, "nothing was overwritten");
    });

    test("a bind is audited with the user and the originating device", async () => {
      const { tenant, ownerAuth, deviceHeaders } = await ownerCtx();
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Parle-G" });

      assertSuccess(await ctx.post("/api/sync/push", {
        events: [{
          eventId: `barcode-bind:${product.id}:8901234567890`,
          type: "BIND_PRODUCT_BARCODE",
          payload: { productId: product.id, barcode: "8901234567890", sourceDeviceId: "till-7" },
        }],
      }, { token: ownerAuth.accessToken, headers: deviceHeaders }));

      const audit = await ctx.db.auditLog.findFirst({
        where: { shopId: tenant.shop.id, action: "product_barcode_bound" },
      });
      assert.ok(audit, "the bind is on the audit trail");
      assert.equal(audit.deviceId, "till-7", "the till that scanned it is recorded");
      assert.ok(audit.userId, "so is the user who was signed in");
    });
  });
}
