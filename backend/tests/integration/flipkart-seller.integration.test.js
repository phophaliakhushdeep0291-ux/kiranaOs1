import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createProduct, createTenant, login } from "./factories.js";
import { env } from "../../src/config/env.js";
import { resetFlipkartTokenCacheForTests } from "../../src/modules/integrations/flipkart-seller.service.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("Flipkart Seller integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  const realFetch = globalThis.fetch;
  const originalEnv = {
    FLIPKART_SELLER_API_ENABLED: env.FLIPKART_SELLER_API_ENABLED,
    FLIPKART_APP_ID: env.FLIPKART_APP_ID,
    FLIPKART_APP_SECRET: env.FLIPKART_APP_SECRET,
    FLIPKART_SHOP_ID: env.FLIPKART_SHOP_ID,
    FLIPKART_LOCATION_MAP_JSON: env.FLIPKART_LOCATION_MAP_JSON,
    FLIPKART_API_BASE_URL: env.FLIPKART_API_BASE_URL,
  };

  after(async () => {
    globalThis.fetch = realFetch;
    Object.assign(env, originalEnv);
    resetFlipkartTokenCacheForTests();
    await ctx.close();
  });
  beforeEach(async () => {
    globalThis.fetch = realFetch;
    Object.assign(env, originalEnv);
    resetFlipkartTokenCacheForTests();
    await resetDatabase(ctx.db);
  });

  describe("Flipkart Seller marketplace ingestion", () => {
    test("is tenant-bound, idempotent, audited, location-safe, and advances provider status", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "pro" });
      const other = await createTenant(ctx.db, { planCode: "pro" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const otherAuth = await login(ctx, other.ownerMobile, other.ownerPassword);
      const location = await ctx.db.storeLocation.create({
        data: { shopId: tenant.shop.id, code: "MAIN", name: "Main warehouse", isPrimary: true, active: true },
      });
      const product = await createProduct(ctx.db, tenant.shop.id, { name: "Marketplace tea", defaultPricePerRateUnit: 125 });
      await ctx.db.product.update({ where: { id: product.id }, data: { sku: "TEA-500" } });

      Object.assign(env, {
        FLIPKART_SELLER_API_ENABLED: true,
        FLIPKART_APP_ID: "seller-app-id",
        FLIPKART_APP_SECRET: "seller-app-secret",
        FLIPKART_SHOP_ID: tenant.shop.id,
        FLIPKART_LOCATION_MAP_JSON: JSON.stringify({ "FK-WH-1": "MAIN" }),
        FLIPKART_API_BASE_URL: "https://api.flipkart.net",
      });

      let providerStatus = "APPROVED";
      let tokenRequests = 0;
      let sellerRequests = 0;
      globalThis.fetch = async (url, options = {}) => {
        const parsed = new URL(String(url));
        if (parsed.origin !== "https://api.flipkart.net") return realFetch(url, options);
        if (parsed.pathname === "/oauth-service/oauth/token") {
          tokenRequests += 1;
          return Response.json({ access_token: "flipkart-token", expires_in: 3600 });
        }
        sellerRequests += 1;
        assert.equal(options.headers.authorization, "Bearer flipkart-token");
        if (parsed.pathname === "/sellers/v3/shipments/filter/") {
          const body = JSON.parse(options.body);
          const shouldReturn = providerStatus === "APPROVED"
            ? body.filter.type === "preDispatch"
            : body.filter.type === "postDispatch" && body.filter.shipmentTypes?.includes("NORMAL");
          return Response.json({
            hasMore: false,
            shipments: shouldReturn ? [{
              shipmentId: "SHP-1",
              locationId: "FK-WH-1",
              orderItems: [{
                orderId: "OD-1",
                orderItemId: "OI-1",
                sku: "TEA-500",
                quantity: 2,
                status: providerStatus,
                priceComponents: { sellingPrice: 125, customerPrice: 120, totalPrice: 240 },
              }],
            }] : [],
          });
        }
        if (parsed.pathname === "/sellers/v3/shipments/SHP-1") {
          return Response.json({ shipments: [{
            shipmentId: "SHP-1",
            locationId: "FK-WH-1",
            deliveryAddress: {
              firstName: "Asha",
              lastName: "Buyer",
              contactNumber: "+91 98765-43210",
              addressLine1: "12 Market Road",
              city: "Jodhpur",
              stateName: "Rajasthan",
              pincode: "342001",
            },
          }] });
        }
        throw new Error(`Unexpected Flipkart request: ${parsed.pathname}`);
      };

      const status = assertSuccess(await ctx.get("/api/integrations/flipkart/status", { token: auth.accessToken }));
      assert.equal(status.configured, true);
      assert.equal(status.orderSyncConfigured, true);
      assert.equal(status.mappedLocations, 1);

      const hidden = assertSuccess(await ctx.get("/api/integrations/flipkart/status", { token: otherAuth.accessToken }));
      assert.equal(hidden.enabled, false);
      assert.equal(hidden.configured, false);
      assert.equal(hidden.mappedLocations, 0);

      const input = { from: "2026-08-01", to: "2026-08-20", maxShipments: 100 };
      const withoutPin = assertFailure(await ctx.post("/api/integrations/flipkart/orders/sync", input, { token: auth.accessToken }), 403);
      assert.ok(withoutPin.code);
      const wrongTenant = assertFailure(await ctx.post("/api/integrations/flipkart/orders/sync", input, {
        token: otherAuth.accessToken,
        ownerPin: other.ownerPin,
      }), 404);
      assert.equal(wrongTenant.code, "FLIPKART_CONNECTOR_NOT_FOUND");

      const first = assertSuccess(await ctx.post("/api/integrations/flipkart/orders/sync", input, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.deepEqual({ created: first.created, updated: first.updated, unchanged: first.unchanged, skipped: first.skipped }, {
        created: 1, updated: 0, unchanged: 0, skipped: 0,
      });
      let order = await ctx.db.customerOrder.findFirstOrThrow({ where: { shopId: tenant.shop.id, externalOrderId: "SHP-1" } });
      assert.equal(order.locationId, location.id);
      assert.equal(order.sourceChannel, "marketplace");
      assert.equal(order.idempotencyKey, "flipkart:shipment:SHP-1");
      assert.equal(order.customerName, "Asha Buyer");
      assert.equal(order.customerMobile, "+919876543210");
      assert.equal(order.status, "new");
      assert.equal(order.paymentStatus, "unpaid", "provider order presence must not be invented as payment proof");
      assert.equal(order.estimatedTotal, 240);
      assert.equal(JSON.parse(order.itemsJson)[0].price, 120);

      providerStatus = "DELIVERED";
      const advanced = assertSuccess(await ctx.post("/api/integrations/flipkart/orders/sync", input, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.equal(advanced.updated, 1);
      order = await ctx.db.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(order.status, "fulfilled");
      assert.equal(order.fulfillmentStatus, "fulfilled");
      assert.ok(order.fulfilledAt);

      const retry = assertSuccess(await ctx.post("/api/integrations/flipkart/orders/sync", input, {
        token: auth.accessToken,
        ownerPin: tenant.ownerPin,
      }));
      assert.equal(retry.unchanged, 1);
      assert.equal(await ctx.db.customerOrder.count({ where: { shopId: tenant.shop.id, externalOrderId: "SHP-1" } }), 1);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, entityId: order.id } }), 2);
      assert.equal(tokenRequests, 1, "a valid OAuth token should be reused within its TTL");
      assert.ok(sellerRequests >= 3);

      const oversizedRange = await ctx.post("/api/integrations/flipkart/orders/sync", {
        from: "2026-06-01", to: "2026-08-20", maxShipments: 100,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin });
      assert.equal(oversizedRange.status, 400, JSON.stringify(oversizedRange.body));
    });

    test("skips an entire shipment when its branch or SKU cannot be proven", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "pro" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      await ctx.db.storeLocation.create({ data: { shopId: tenant.shop.id, code: "MAIN", name: "Main", isPrimary: true } });
      Object.assign(env, {
        FLIPKART_SELLER_API_ENABLED: true,
        FLIPKART_APP_ID: "seller-app-id",
        FLIPKART_APP_SECRET: "seller-app-secret",
        FLIPKART_SHOP_ID: tenant.shop.id,
        FLIPKART_LOCATION_MAP_JSON: JSON.stringify({ "FK-WH-1": "MAIN" }),
        FLIPKART_API_BASE_URL: "https://api.flipkart.net",
      });
      globalThis.fetch = async (url, options = {}) => {
        const parsed = new URL(String(url));
        if (parsed.origin !== "https://api.flipkart.net") return realFetch(url, options);
        if (parsed.pathname === "/oauth-service/oauth/token") return Response.json({ access_token: "token", expires_in: 3600 });
        if (parsed.pathname === "/sellers/v3/shipments/filter/") {
          const body = JSON.parse(options.body);
          return Response.json({ hasMore: false, shipments: body.filter.type === "preDispatch" ? [{
            shipmentId: "SHP-MISSING-SKU",
            locationId: "FK-WH-1",
            orderItems: [{ orderId: "OD-2", orderItemId: "OI-2", sku: "UNKNOWN-SKU", quantity: 1, status: "APPROVED", priceComponents: { totalPrice: 50 } }],
          }] : [] });
        }
        if (parsed.pathname === "/sellers/v3/shipments/SHP-MISSING-SKU") return Response.json({ shipments: [{ shipmentId: "SHP-MISSING-SKU", locationId: "FK-WH-1" }] });
        throw new Error(`Unexpected Flipkart request: ${parsed.pathname}`);
      };

      const result = assertSuccess(await ctx.post("/api/integrations/flipkart/orders/sync", {
        from: "2026-08-01", to: "2026-08-20", maxShipments: 100,
      }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
      assert.equal(result.created, 0);
      assert.equal(result.skipped, 1);
      assert.equal(result.issues[0].code, "SKU_UNMAPPED");
      assert.deepEqual(result.issues[0].missingSkus, ["UNKNOWN-SKU"]);
      assert.equal(await ctx.db.customerOrder.count({ where: { shopId: tenant.shop.id } }), 0);
    });
  });
}
