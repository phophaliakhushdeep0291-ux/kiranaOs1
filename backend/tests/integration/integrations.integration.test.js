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
      const overview = assertSuccess(await ctx.get("/api/integrations/overview", { token: auth.accessToken }));
      assert.equal(overview.providers.find((provider) => provider.id === "api").status, "upgrade_required");
      assert.equal(overview.providers.find((provider) => provider.id === "tally").status, "upgrade_required");
    });

    test("integration credentials, endpoints, retry requests, and Tally confirmations roll back with required audit", async () => {
      const { tenant, auth } = await ownerContext();
      const key = assertSuccess(await ctx.post("/api/integrations/api-keys", {
        name: "Rollback key",
        scopes: ["catalog:read"],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      const endpoint = assertSuccess(await ctx.post("/api/integrations/webhooks", {
        name: "Rollback endpoint",
        url: "https://hooks.example.com/rollback-proof",
        events: ["bill.created"],
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 201);
      const delivery = await ctx.db.webhookDelivery.create({
        data: {
          shopId: tenant.shop.id,
          endpointId: endpoint.id,
          eventId: "evt_retry_audit_rollback",
          eventType: "bill.created",
          payloadJson: JSON.stringify({ billNo: "ROLLBACK-1" }),
          status: "failed",
          attemptCount: 1,
          lastError: "Original failure",
        },
      });

      await ctx.db.$executeRawUnsafe(`
        CREATE TRIGGER force_integration_audit_failure
        BEFORE INSERT ON AuditLog
        WHEN NEW.action IN (
          'INTEGRATION_API_KEY_CREATED',
          'INTEGRATION_API_KEY_REVOKED',
          'WEBHOOK_ENDPOINT_CREATED',
          'WEBHOOK_ENDPOINT_UPDATED',
          'WEBHOOK_ENDPOINT_ARCHIVED',
          'WEBHOOK_ENDPOINT_TEST_REQUESTED',
          'WEBHOOK_DELIVERY_RETRY_REQUESTED',
          'TALLY_VOUCHERS_POSTED'
        )
        BEGIN
          SELECT RAISE(ABORT, 'forced integration audit failure');
        END;
      `);
      try {
        const keyCount = await ctx.db.integrationApiKey.count({ where: { shopId: tenant.shop.id } });
        const failedKey = assertFailure(await ctx.post("/api/integrations/api-keys", {
          name: "Must not survive",
          scopes: ["catalog:read"],
        }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
        assert.equal(failedKey.code, "INTEGRATION_AUDIT_UNAVAILABLE");
        assert.equal(await ctx.db.integrationApiKey.count({ where: { shopId: tenant.shop.id } }), keyCount);

        assertFailure(await ctx.delete(`/api/integrations/api-keys/${key.id}`, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        }), 503);
        assert.equal((await ctx.db.integrationApiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt, null);

        const endpointCount = await ctx.db.webhookEndpoint.count({ where: { shopId: tenant.shop.id } });
        assertFailure(await ctx.post("/api/integrations/webhooks", {
          name: "Must not survive",
          url: "https://hooks.example.com/must-not-survive",
          events: ["bill.created"],
        }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
        assert.equal(await ctx.db.webhookEndpoint.count({ where: { shopId: tenant.shop.id } }), endpointCount);

        assertFailure(await ctx.patch(`/api/integrations/webhooks/${endpoint.id}`, {
          name: "Changed without audit",
        }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 503);
        assert.equal((await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } })).name, "Rollback endpoint");

        const deliveryCount = await ctx.db.webhookDelivery.count({ where: { endpointId: endpoint.id } });
        assertFailure(await ctx.post(`/api/integrations/webhooks/${endpoint.id}/test`, {}, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        }), 503);
        assert.equal(await ctx.db.webhookDelivery.count({ where: { endpointId: endpoint.id } }), deliveryCount);

        assertFailure(await ctx.post(`/api/integrations/deliveries/${delivery.id}/retry`, {}, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        }), 503);
        const retryRolledBack = await ctx.db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
        assert.equal(retryRolledBack.status, "failed");
        assert.equal(retryRolledBack.lastError, "Original failure");

        assertFailure(await ctx.delete(`/api/integrations/webhooks/${endpoint.id}`, {
          token: auth.accessToken,
          ownerPin: tenant.ownerPin,
        }), 503);
        const archiveRolledBack = await ctx.db.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
        assert.equal(archiveRolledBack.deletedAt, null);
        assert.equal(archiveRolledBack.enabled, true);

        assertFailure(await ctx.post("/api/integrations/exports/tally/posted", {
          documents: [{ type: "sale", id: "bill-audit-rollback", voucherNumber: "INV-ROLLBACK", remoteId: "artha-sale-audit-rollback" }],
        }, { token: auth.accessToken }), 503);
        assert.equal(await ctx.db.tallyPost.count({ where: { shopId: tenant.shop.id, documentId: "bill-audit-rollback" } }), 0);
      } finally {
        await ctx.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS force_integration_audit_failure");
      }
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
      const olderDelivery = await ctx.db.webhookDelivery.create({
        data: {
          shopId: tenant.shop.id,
          endpointId: endpoint.id,
          eventId: "evt_older_history",
          eventType: "bill.created",
          payloadJson: JSON.stringify({ billNo: "B-0" }),
          status: "delivered",
          deliveredAt: new Date(),
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      const history = assertSuccess(await ctx.get("/api/integrations/deliveries?limit=1", { token: auth.accessToken }));
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0].id, delivery.id);
      assert.equal(history.hasMore, true);
      assert.ok(history.nextCursor);
      const olderHistory = assertSuccess(await ctx.get(`/api/integrations/deliveries?limit=1&cursor=${encodeURIComponent(history.nextCursor)}`, { token: auth.accessToken }));
      assert.equal(olderHistory.items[0].id, olderDelivery.id);
      assert.equal(olderHistory.hasMore, false);
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
