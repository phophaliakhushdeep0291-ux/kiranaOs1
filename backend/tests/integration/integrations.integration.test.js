import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createProduct, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("integration control-plane tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  async function ownerContext() {
    const tenant = await createTenant(ctx.db, { planCode: "pro" });
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    return { tenant, auth };
  }

  describe("integration control plane", () => {
    test("API keys are disclosed once, paginate resources, enforce scopes, and stop after revocation", async () => {
      const { tenant, auth } = await ownerContext();
      const first = await createProduct(ctx.db, tenant.shop.id, { name: "API Product A" });
      const second = await createProduct(ctx.db, tenant.shop.id, { name: "API Product B" });

      const created = assertSuccess(await ctx.post("/api/integrations/api-keys", {
        name: "Catalog sync",
        scopes: ["catalog:read"],
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.match(created.secret, /^kos_test_/);

      const listed = assertSuccess(await ctx.get("/api/integrations/api-keys", { token: auth.accessToken }));
      assert.equal(listed.length, 1);
      assert.equal("secret" in listed[0], false);
      assert.equal("keyHash" in listed[0], false);

      const page1 = assertSuccess(await ctx.get("/api/integrations/v1/catalog?limit=1", {
        headers: { authorization: `Bearer ${created.secret}` },
        autoDevice: false,
      }));
      assert.equal(page1.items.length, 1);
      assert.equal(page1.hasMore, true);
      assert.ok(page1.nextCursor);

      const page2 = assertSuccess(await ctx.get(`/api/integrations/v1/catalog?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`, {
        headers: { authorization: `Bearer ${created.secret}` },
        autoDevice: false,
      }));
      assert.equal(page2.items.length, 1);
      assert.notEqual(page2.items[0].id, page1.items[0].id);
      assert.deepEqual(new Set([page1.items[0].id, page2.items[0].id]), new Set([first.id, second.id]));

      const forbidden = assertFailure(await ctx.get("/api/integrations/v1/customers", {
        headers: { authorization: `Bearer ${created.secret}` },
        autoDevice: false,
      }), 403);
      assert.equal(forbidden.code, "INTEGRATION_SCOPE_REQUIRED");

      assertSuccess(await ctx.delete(`/api/integrations/api-keys/${created.id}`, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      const revoked = assertFailure(await ctx.get("/api/integrations/v1/catalog", {
        headers: { authorization: `Bearer ${created.secret}` },
        autoDevice: false,
      }), 401);
      assert.equal(revoked.code, "INTEGRATION_KEY_INVALID");
    });

    test("invalid key expiry is rejected and a plan downgrade disables an issued key", async () => {
      const { tenant, auth } = await ownerContext();
      const badExpiry = await ctx.post("/api/integrations/api-keys", {
        name: "Already expired",
        scopes: ["catalog:read"],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      assert.equal(badExpiry.status, 400, JSON.stringify(badExpiry.body));

      const created = assertSuccess(await ctx.post("/api/integrations/api-keys", {
        name: "ERP sync",
        scopes: ["catalog:read"],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      await ctx.db.subscription.update({ where: { shopId: tenant.shop.id }, data: { planCode: "growth" } });

      const downgraded = await ctx.get("/api/integrations/v1/catalog", {
        headers: { authorization: `Bearer ${created.secret}` },
        autoDevice: false,
      });
      assert.ok([402, 403].includes(downgraded.status), JSON.stringify(downgraded.body));
    });

    test("archiving an endpoint preserves delivery evidence and permits later URL reuse", async () => {
      const { tenant, auth } = await ownerContext();
      const endpoint = assertSuccess(await ctx.post("/api/integrations/webhooks", {
        name: "ERP receiver",
        url: "https://hooks.example.com/kiranaos",
        events: ["bill.created"],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);

      const duplicate = assertFailure(await ctx.post("/api/integrations/webhooks", {
        name: "Duplicate receiver",
        url: "https://hooks.example.com/kiranaos",
        events: ["bill.created"],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
      assert.equal(duplicate.code, "WEBHOOK_URL_DUPLICATE");

      const delivery = await ctx.db.webhookDelivery.create({
        data: {
          shopId: tenant.shop.id,
          endpointId: endpoint.id,
          eventId: "evt_preserved_history",
          eventType: "bill.created",
          payloadJson: JSON.stringify({ billNo: "B-1" }),
          status: "failed",
          lastError: "Connection refused",
        },
      });
      const archived = assertSuccess(await ctx.delete(`/api/integrations/webhooks/${endpoint.id}`, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.equal(archived.archived, true);

      const storedEndpoint = await ctx.db.webhookEndpoint.findUnique({ where: { id: endpoint.id } });
      assert.ok(storedEndpoint.deletedAt);
      assert.equal(storedEndpoint.enabled, false);
      assert.ok(await ctx.db.webhookDelivery.findUnique({ where: { id: delivery.id } }));
      assert.equal((await ctx.get("/api/integrations/webhooks", { token: auth.accessToken })).body.data.length, 0);

      const reused = assertSuccess(await ctx.post("/api/integrations/webhooks", {
        name: "Replacement receiver",
        url: "https://hooks.example.com/kiranaos",
        events: ["bill.created"],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      assert.notEqual(reused.id, endpoint.id);
    });
  });
}
