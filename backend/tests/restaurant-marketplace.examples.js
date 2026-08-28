import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import db from "../src/db.js";
import { AppError } from "../src/middleware/error.js";
import { createRestaurantMarketplaceService } from "../src/modules/integrations/restaurant-marketplace/service.js";
import { marketplaceCommandSchema, marketplaceEventSchema, marketplaceSetupSchema } from "../src/modules/integrations/restaurant-marketplace/schemas.js";
import { RESTAURANT_MARKETPLACE_PROVIDERS, marketplaceInboxEnabled, withMarketplaceNavigation } from "../src/modules/integrations/restaurant-marketplace/registry.js";
import { getBootstrap } from "../src/modules/shops/shops.service.js";

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS marketplace: ${name}`); }
const rejects = (run, code) => assert.rejects(run, (error) => error.code === code);
const suffix = crypto.randomUUID().slice(0, 8);
const createShop = (name, businessType = "restaurant") => db.shop.create({ data: {
  name: `${name} ${suffix}`, ownerName: "Test owner", city: "Pune", address: "Test only",
  settingsJson: JSON.stringify({ businessProfile: { businessType } }),
} });
const shop = await createShop("Marketplace");
const other = await createShop("Other restaurant");
const retail = await createShop("Retail", "kirana");
const location = await db.storeLocation.create({ data: { shopId: shop.id, code: "MAIN", name: "Main" } });
const otherLocation = await db.storeLocation.create({ data: { shopId: other.id, code: "MAIN", name: "Other main" } });
const service = createRestaurantMarketplaceService();
let sends = 0;
const simulator = {
  version: "TEST-ONLY-1",
  // This is an INTERNAL simulator contract, not either provider's wire format.
  verifyOutlet: async (request) => ({ ...request, reference: "test-outlet-ownership-proof" }),
  authenticateAndNormalize: async ({ rawBody, headers }) => {
    if (headers.authorization !== "test-simulator-auth") throw new AppError("Unauthorized fixture", 401, "TEST_AUTH_FAILED");
    return JSON.parse(rawBody.toString("utf8"));
  },
  sendCommand: async ({ externalOrderId }) => { sends++; return { confirmed: true, externalOrderId }; },
};
const simulated = createRestaurantMarketplaceService({ adapterFor: () => simulator });
const setup = { locationId: location.id, externalOutletId: `outlet-${suffix}`, environment: "sandbox" };
const snapshot = () => ({ currency: "INR", lines: [{ lineId: "line-1", externalItemId: "dish-1", name: "Test meal", quantity: 2, unitPricePaise: 9000, lineTotalPaise: 18000 }], subtotalPaise: 18000, taxPaise: 900, chargesPaise: 0, discountPaise: 0, totalPaise: 18900, providerPayment: "platform_collected" });
const event = (orderId, overrides = {}) => ({ eventId: crypto.randomUUID(), externalOutletId: setup.externalOutletId, externalOrderId: orderId, environment: "sandbox", kind: "order.created", occurredAt: "2026-08-28T10:00:00Z", order: snapshot(), ...overrides });
const ingest = (value, target = simulated, headers = { authorization: "test-simulator-auth" }) => target.ingest({ provider: "zomato", rawBody: Buffer.from(JSON.stringify(value)), headers });
const queue = (orderId, action = "accept", extra = {}) => simulated.queueCommand({ shopId: shop.id, orderId, input: { requestKey: crypto.randomUUID(), action, ...(action === "accept" ? { preparationMinutes: 15 } : {}), ...extra } });
const dispatch = (command, target = simulated) => target.dispatchCommand({ shopId: shop.id, commandId: command.id });
// Exercise real transaction rollback with only the audit writer fault-injected.
const auditFailureService = (action) => createRestaurantMarketplaceService({ adapterFor: () => simulator,
  client: new Proxy(db, { get(target, property) {
    if (property !== "$transaction") return Reflect.get(target, property);
    return (run, options) => target.$transaction((tx) => run(new Proxy(tx, { get(inner, key) {
      if (key !== "auditLog") return Reflect.get(inner, key);
      return { create: (args) => {
        if (args.data.action === action) throw new Error("TEST audit unavailable");
        return inner.auditLog.create(args);
      } };
    } })), options);
  } }),
});
let connection;
let orderId;

try {
  await check("production adapters and restaurant inbox remain closed", async () => {
    assert.ok(RESTAURANT_MARKETPLACE_PROVIDERS.every((row) => !row.implemented && !row.fulfilmentReady));
    const forged = [{ provider: "zomato", status: "verified", enabled: true, environment: "live", verifiedAt: new Date(), verificationReference: "forged", adapterVersion: "forged" }];
    assert.equal(marketplaceInboxEnabled(forged), false);
    assert.deepEqual(withMarketplaceNavigation({ shop: { businessType: "restaurant" }, navigation: ["tables", "orders", "sales"] }, forged).navigation, ["tables", "sales"]);
    assert.deepEqual(withMarketplaceNavigation({ shop: { businessType: "kirana" }, navigation: ["orders"] }, []).navigation, ["orders"]);
    assert.ok(!(await getBootstrap(shop.id, "owner")).navigation.includes("orders"));
    await rejects(() => ingest(event("closed"), service), "MARKETPLACE_ADAPTER_REQUIRED");
  });

  await check("setup is strict, restaurant-only and tenant/location scoped", async () => {
    for (const field of ["shopId", "enabled", "status", "adapterVersion", "apiKey", "url"]) assert.equal(marketplaceSetupSchema.safeParse({ ...setup, [field]: "injected" }).success, false);
    await rejects(() => service.save({ shopId: shop.id, provider: "unknown", input: setup }), "MARKETPLACE_PROVIDER_UNSUPPORTED");
    await rejects(() => service.save({ shopId: shop.id, provider: "zomato", input: { ...setup, locationId: otherLocation.id } }), "MARKETPLACE_LOCATION_NOT_FOUND");
    await rejects(() => service.save({ shopId: retail.id, provider: "zomato", input: setup }), "MARKETPLACE_RESTAURANT_REQUIRED");
    connection = await service.save({ shopId: shop.id, provider: "zomato", input: setup });
    assert.equal(connection.status, "pending"); assert.equal(connection.enabled, false);
    assert.equal((await service.list(other.id)).connections.length, 0);
    assert.equal((await service.list(shop.id)).liveOrdersSupported, false);
    await rejects(() => service.verify({ shopId: other.id, connectionId: connection.id }), "MARKETPLACE_CONNECTION_NOT_FOUND");
    await rejects(() => service.verify({ shopId: shop.id, connectionId: connection.id }), "MARKETPLACE_ADAPTER_REQUIRED");
    await rejects(() => ingest(event("pending")), "MARKETPLACE_OUTLET_NOT_VERIFIED");
  });

  await check("verification proves the exact shop, branch, outlet and environment", async () => {
    for (const change of [{ externalOutletId: "another" }, { environment: "live" }, { shopId: other.id }, { locationId: otherLocation.id }, { reference: "" }]) {
      const bad = createRestaurantMarketplaceService({ adapterFor: () => ({ ...simulator, verifyOutlet: async (request) => ({ ...request, reference: "test", ...change }) }) });
      await rejects(() => bad.verify({ shopId: shop.id, connectionId: connection.id }), "MARKETPLACE_OUTLET_NOT_VERIFIED");
    }
    // Edit while the remote verification is in progress; its old proof is invalid.
    const racing = createRestaurantMarketplaceService({ adapterFor: () => ({ ...simulator, verifyOutlet: async (request) => {
      await service.save({ shopId: shop.id, provider: "zomato", input: { ...setup, externalOutletId: "edited-outlet" } });
      return simulator.verifyOutlet(request);
    } }) });
    await rejects(() => racing.verify({ shopId: shop.id, connectionId: connection.id }), "MARKETPLACE_VERIFICATION_CONFLICT");
    await service.save({ shopId: shop.id, provider: "zomato", input: setup });
    await simulated.verify({ shopId: shop.id, connectionId: connection.id });
    await rejects(() => service.save({ shopId: shop.id, provider: "zomato", input: setup }), "MARKETPLACE_UNMAPPING_REQUIRED");
    const second = await service.save({ shopId: other.id, provider: "zomato", input: { ...setup, locationId: otherLocation.id } });
    await rejects(() => simulated.verify({ shopId: other.id, connectionId: second.id }), "MARKETPLACE_OUTLET_ALREADY_BOUND");
    assert.equal((await service.list(shop.id)).inboxEnabled, false, "test verification cannot enable a production inbox");
  });

  await check("migration enforces globally unique verified outlet bindings only", async () => {
    // db push does not create partial indexes; apply this exact migration index.
    const migration = readFileSync(new URL("../prisma/migrations/20260828200000_restaurant_marketplace_foundation/migration.sql", import.meta.url), "utf8");
    const statement = migration.match(/CREATE UNIQUE INDEX "RestaurantMarketplaceConnection_verified_outlet_key"[\s\S]*?;/)?.[0];
    assert.ok(statement);
    await db.$executeRawUnsafe(statement.replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS"));
    await rejects(() => db.restaurantMarketplaceConnection.updateMany({ where: { shopId: other.id }, data: { status: "verified" } }), "P2002");
  });

  await check("authentication, verified outlet and environment are required before intake", async () => {
    await rejects(() => ingest(event("unauth"), simulated, {}), "TEST_AUTH_FAILED");
    await rejects(() => ingest(event("bad-outlet", { externalOutletId: "unknown" })), "MARKETPLACE_OUTLET_NOT_VERIFIED");
    await rejects(() => ingest(event("bad-env", { environment: "live" })), "MARKETPLACE_OUTLET_NOT_VERIFIED");
    assert.equal(marketplaceEventSchema.safeParse(event("injected", { shopId: other.id })).success, false);
    await rejects(() => simulated.ingest({ provider: "zomato", rawBody: Buffer.alloc(512 * 1024 + 1), headers: {} }), "MARKETPLACE_PAYLOAD_INVALID");
  });

  await check("money and quantities are validated before persistence", async () => {
    const cases = [
      { totalPaise: 18901 }, { subtotalPaise: 18001 }, { currency: "USD" }, { taxPaise: -1 },
      { lines: [{ ...snapshot().lines[0], quantity: 1.5 }] },
      { lines: [{ ...snapshot().lines[0], lineTotalPaise: 17000 }] },
      { lines: [snapshot().lines[0], snapshot().lines[0]], subtotalPaise: 36000, totalPaise: 36900 },
    ];
    for (const change of cases) assert.equal(marketplaceEventSchema.safeParse(event("invalid", { order: { ...snapshot(), ...change } })).success, false);
    assert.equal(marketplaceCommandSchema.safeParse({ requestKey: crypto.randomUUID(), action: "accept" }).success, false);
    assert.equal(marketplaceCommandSchema.safeParse({ requestKey: crypto.randomUUID(), action: "ready", rejectionReason: "irrelevant" }).success, false);
  });

  await check("repeated event and order deliveries create one immutable staged order", async () => {
    const first = event("order-1");
    const receipt = await ingest(first); orderId = receipt.orderId;
    assert.equal(receipt.result, "created");
    assert.equal((await ingest(first)).duplicate, true);
    assert.equal((await ingest({ ...first, eventId: "second-delivery" })).result, "unchanged");
    await rejects(() => ingest({ ...first, occurredAt: "2026-08-28T10:01:00Z" }), "MARKETPLACE_EVENT_CONFLICT");
    await rejects(() => ingest(event("order-1", { order: { ...snapshot(), instructions: "changed" } })), "MARKETPLACE_ORDER_CONFLICT");
    assert.equal(await db.restaurantMarketplaceOrder.count({ where: { connectionId: connection.id } }), 1);
    assert.equal((await db.restaurantMarketplaceOrder.findUnique({ where: { id: orderId } })).providerPayment, "platform_collected");
  });

  await check("commands require valid state, tenant, idempotency and provider acknowledgement", async () => {
    await rejects(() => queue(orderId, "ready"), "MARKETPLACE_INVALID_TRANSITION");
    await rejects(() => simulated.queueCommand({ shopId: other.id, orderId, input: { requestKey: crypto.randomUUID(), action: "accept", preparationMinutes: 15 } }), "MARKETPLACE_ORDER_NOT_FOUND");
    const command = await queue(orderId);
    const same = await simulated.queueCommand({ shopId: shop.id, orderId, input: JSON.parse(command.requestJson) });
    assert.equal(command.id, same.id);
    await rejects(() => simulated.queueCommand({ shopId: shop.id, orderId, input: { ...JSON.parse(command.requestJson), preparationMinutes: 25 } }), "MARKETPLACE_COMMAND_CONFLICT");
    await rejects(() => queue(orderId), "MARKETPLACE_COMMAND_PENDING");
    assert.equal((await db.restaurantMarketplaceOrder.findUnique({ where: { id: orderId } })).status, "new");
    assert.equal((await dispatch(command)).status, "delivered");
    assert.equal((await dispatch(command)).status, "delivered");
    assert.equal(sends, 1);
    assert.equal((await db.restaurantMarketplaceOrder.findUnique({ where: { id: orderId } })).status, "accepted");
    assert.equal((await dispatch(await queue(orderId, "ready"))).status, "delivered");
  });

  await check("cancellation cancels pending delivery; stale or conflicting statuses cannot reopen orders", async () => {
    const before = event("not-created", { kind: "order.cancelled", order: undefined });
    await rejects(() => ingest(before), "MARKETPLACE_ORDER_MISSING");
    const received = await ingest(event("cancel-me"));
    const command = await queue(received.orderId);
    assert.equal((await ingest(event("cancel-me", { kind: "order.cancelled", order: undefined, occurredAt: "2026-08-28T09:59:00Z" }))).result, "stale");
    await ingest(event("cancel-me", { kind: "order.cancelled", order: undefined, occurredAt: "2026-08-28T10:01:00Z" }));
    const count = sends;
    assert.equal((await dispatch(command)).status, "needs_review"); assert.equal(sends, count);
    await rejects(() => ingest(event("cancel-me", { kind: "order.fulfilled", order: undefined, occurredAt: "2026-08-28T10:02:00Z" })), "MARKETPLACE_TERMINAL_CONFLICT");
    await ingest(event("cancel-me"));
    assert.equal((await db.restaurantMarketplaceOrder.findUnique({ where: { id: received.orderId } })).status, "cancelled");
  });

  await check("provider timeouts and mismatched acknowledgements require review, never a blind resend", async () => {
    for (const mode of ["timeout", "wrong-order"]) {
      const received = await ingest(event(mode));
      const command = await queue(received.orderId);
      let calls = 0;
      const uncertain = createRestaurantMarketplaceService({ adapterFor: () => ({ ...simulator, sendCommand: async () => {
        calls++;
        if (mode === "timeout") throw new Error("SECRET must not be stored");
        return { confirmed: true, externalOrderId: "wrong-order-id" };
      } }) });
      assert.equal((await dispatch(command, uncertain)).status, "needs_review");
      assert.equal((await dispatch(command, uncertain)).status, "needs_review");
      assert.equal(calls, 1);
      await rejects(() => queue(received.orderId), "MARKETPLACE_COMMAND_PENDING");
      const stored = await db.restaurantMarketplaceCommand.findUnique({ where: { id: command.id } });
      assert.ok(!JSON.stringify(stored).includes("SECRET"));
      assert.equal((await db.restaurantMarketplaceOrder.findUnique({ where: { id: received.orderId } })).status, "new");
    }
  });

  await check("a cancellation arriving during provider acceptance wins over the acknowledgement", async () => {
    const received = await ingest(event("racing-order"));
    const command = await queue(received.orderId);
    const racing = createRestaurantMarketplaceService({ adapterFor: () => ({ ...simulator, sendCommand: async ({ externalOrderId }) => {
      await ingest(event(externalOrderId, { kind: "order.cancelled", order: undefined, occurredAt: "2026-08-28T10:02:00Z" }));
      return { confirmed: true, externalOrderId };
    } }) });
    assert.equal((await dispatch(command, racing)).status, "needs_review");
    assert.equal((await db.restaurantMarketplaceOrder.findUnique({ where: { id: received.orderId } })).status, "cancelled");
  });

  await check("paused intake and shop maintenance block new orders", async () => {
    await db.restaurantMarketplaceConnection.update({ where: { id: connection.id }, data: { enabled: false } });
    await rejects(() => ingest(event("paused")), "MARKETPLACE_INTAKE_PAUSED");
    await db.restaurantMarketplaceConnection.update({ where: { id: connection.id }, data: { enabled: true } });
    await db.shopMaintenanceLock.create({ data: { shopId: shop.id, tokenHash: "test", reason: "test", expiresAt: new Date(Date.now() + 60000) } });
    await rejects(() => ingest(event("maintenance")), "SHOP_MAINTENANCE_LOCKED");
    await db.shopMaintenanceLock.delete({ where: { shopId: shop.id } });
  });

  await check("audit failure rolls back setup, intake, verification and command claims", async () => {
    const newSetup = { ...setup, externalOutletId: "audit-outlet" };
    await rejects(() => auditFailureService("ORDER_MARKETPLACE_SETUP_SAVED").save({ shopId: shop.id, provider: "swiggy", input: newSetup }), "MARKETPLACE_AUDIT_UNAVAILABLE");
    assert.equal(await db.restaurantMarketplaceConnection.count({ where: { shopId: shop.id, provider: "swiggy" } }), 0);
    const unverified = await simulated.save({ shopId: shop.id, provider: "swiggy", input: newSetup });
    await rejects(() => auditFailureService("ORDER_MARKETPLACE_OUTLET_VERIFIED").verify({ shopId: shop.id, connectionId: unverified.id }), "MARKETPLACE_AUDIT_UNAVAILABLE");
    assert.equal((await db.restaurantMarketplaceConnection.findUnique({ where: { id: unverified.id } })).status, "pending");
    const input = event("audit-failed-order");
    await rejects(() => ingest(input, auditFailureService("ORDER_MARKETPLACE_EVENT_RECEIVED")), "MARKETPLACE_AUDIT_UNAVAILABLE");
    assert.equal(await db.restaurantMarketplaceOrder.count({ where: { connectionId: connection.id, externalOrderId: input.externalOrderId } }), 0);
    assert.equal(await db.restaurantMarketplaceEvent.count({ where: { connectionId: connection.id, eventId: input.eventId } }), 0);
    const received = await ingest(input);
    await rejects(() => auditFailureService("ORDER_MARKETPLACE_COMMAND_QUEUED").queueCommand({ shopId: shop.id, orderId: received.orderId, input: { requestKey: crypto.randomUUID(), action: "accept", preparationMinutes: 15 } }), "MARKETPLACE_AUDIT_UNAVAILABLE");
    assert.equal(await db.restaurantMarketplaceCommand.count({ where: { orderId: received.orderId } }), 0);
    const command = await queue(received.orderId);
    const count = sends;
    await rejects(() => dispatch(command, auditFailureService("ORDER_MARKETPLACE_COMMAND_CLAIMED")), "MARKETPLACE_AUDIT_UNAVAILABLE");
    assert.equal(sends, count);
    assert.equal((await db.restaurantMarketplaceCommand.findUnique({ where: { id: command.id } })).status, "pending");
    // If the provider accepts but our acknowledgement transaction fails, the
    // durable claim must remain sending. A retry cannot issue a second accept.
    await rejects(() => dispatch(command, auditFailureService("ORDER_MARKETPLACE_COMMAND_ACKNOWLEDGED")), "MARKETPLACE_AUDIT_UNAVAILABLE");
    assert.equal((await dispatch(command)).status, "sending");
    assert.equal(sends, count + 1);
  });

  await check("a second dispatcher cannot resend a command while the first awaits the provider", async () => {
    const received = await ingest(event("concurrent-dispatch"));
    const command = await queue(received.orderId);
    let release;
    let announce;
    const started = new Promise((resolve) => { announce = resolve; });
    const waiting = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const slow = createRestaurantMarketplaceService({ adapterFor: () => ({ ...simulator, sendCommand: async ({ externalOrderId }) => {
      calls++; announce(); await waiting; return { confirmed: true, externalOrderId };
    } }) });
    const first = dispatch(command, slow);
    await started;
    try { assert.equal((await dispatch(command, slow)).status, "sending"); }
    finally { release(); }
    assert.equal((await first).status, "delivered"); assert.equal(calls, 1);
  });

  await check("staged marketplace activity cannot create cash, bills, customer orders or kitchen tickets", async () => {
    assert.equal(await db.bill.count({ where: { shopId: shop.id } }), 0);
    assert.equal(await db.customerOrder.count({ where: { shopId: shop.id } }), 0);
    assert.equal(await db.kitchenTicket.count({ where: { shopId: shop.id } }), 0);
    assert.ok(await db.auditLog.count({ where: { shopId: shop.id, action: "ORDER_MARKETPLACE_EVENT_RECEIVED" } }) > 0);
    const publicData = JSON.stringify(await service.list(shop.id));
    assert.ok(!publicData.includes("test-outlet-ownership-proof"));
    assert.equal((await service.list(shop.id)).inboxEnabled, false);
  });
} finally {
  await db.$disconnect();
}
console.log(`${checks} restaurant marketplace scenario groups passed (internal simulator only).`);
