import crypto from "node:crypto";
import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { createAuditLog } from "../../audit/audit.service.js";
import { businessTypeFromSettings, parseShopSettings } from "../../../verticals/registry.js";
import { marketplaceSetupSchema, marketplaceEventSchema, marketplaceCommandSchema } from "./schemas.js";
import { RESTAURANT_MARKETPLACE_PROVIDERS, marketplaceInboxEnabled, marketplaceProvider, requireMarketplaceAdapter } from "./registry.js";

const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = (message, code = "MARKETPLACE_CONFLICT") => new AppError(message, 409, code);
const TERMINAL = new Set(["fulfilled", "cancelled", "rejected"]);
const COMMAND_STATUS = { accept: "accepted", reject: "rejected", ready: "ready" };

function publicConnection(row) {
  return {
    id: row.id, provider: row.provider, locationId: row.locationId,
    externalOutletId: row.externalOutletId, environment: row.environment,
    status: row.status, enabled: row.enabled, verifiedAt: row.verifiedAt,
    updatedAt: row.updatedAt,
  };
}

async function requiredAudit(client, entry) {
  const audit = await createAuditLog({ ...entry, client, module: "orders" });
  if (!audit) throw new AppError("Marketplace change could not be audited", 503, "MARKETPLACE_AUDIT_UNAVAILABLE");
}

async function restaurantLocation(client, shopId, locationId) {
  const shop = await client.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
  if (!shop || businessTypeFromSettings(parseShopSettings(shop.settingsJson)) !== "restaurant") {
    throw new AppError("Marketplace setup is available for restaurant shops only", 403, "MARKETPLACE_RESTAURANT_REQUIRED");
  }
  const location = await client.storeLocation.findFirst({ where: { id: locationId, shopId, active: true } });
  if (!location) throw new AppError("Choose an active location belonging to this shop", 404, "MARKETPLACE_LOCATION_NOT_FOUND");
  const lock = await client.shopMaintenanceLock.findFirst({ where: { shopId, expiresAt: { gt: new Date() } } });
  if (lock) throw new AppError("Shop is temporarily read-only for maintenance", 423, "SHOP_MAINTENANCE_LOCKED");
  return location;
}

/**
 * Adapter boundary. Production uses the closed registry. Test fixtures inject
 * a simulator here, never through a request, environment flag or public route.
 * No provider network method is called inside a database transaction.
 */
export function createRestaurantMarketplaceService({ client = db, adapterFor = requireMarketplaceAdapter } = {}) {
  async function list(shopId) {
    const shop = await client.shop.findUnique({ where: { id: shopId }, select: { settingsJson: true } });
    const restaurant = shop && businessTypeFromSettings(parseShopSettings(shop.settingsJson)) === "restaurant";
    if (!restaurant) throw new AppError("Marketplace setup is available for restaurant shops only", 403, "MARKETPLACE_RESTAURANT_REQUIRED");
    const [connections, locations] = await Promise.all([
      client.restaurantMarketplaceConnection.findMany({ where: { shopId }, orderBy: [{ provider: "asc" }, { createdAt: "asc" }] }),
      client.storeLocation.findMany({ where: { shopId, active: true }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    ]);
    return { providers: RESTAURANT_MARKETPLACE_PROVIDERS, connections: connections.map(publicConnection), locations,
      inboxEnabled: marketplaceInboxEnabled(connections), liveOrdersSupported: false };
  }

  async function save({ shopId, provider, input, actor = {} }) {
    marketplaceProvider(provider);
    const values = marketplaceSetupSchema.parse(input);
    return client.$transaction(async (tx) => {
      await restaurantLocation(tx, shopId, values.locationId);
      const where = { shopId_provider_locationId: { shopId, provider, locationId: values.locationId } };
      const existing = await tx.restaurantMarketplaceConnection.findUnique({ where });
      if (existing?.status === "verified") throw conflict("A verified outlet cannot be rebound from the setup form; coordinate its unmapping with the provider", "MARKETPLACE_UNMAPPING_REQUIRED");
      const data = { ...values, enabled: false, status: "pending", adapterVersion: null, verificationReference: null, verifiedAt: null, updatedByUserId: actor.userId ?? null };
      const saved = await tx.restaurantMarketplaceConnection.upsert({ where,
        create: { ...data, shopId, provider, createdByUserId: actor.userId ?? null }, update: data });
      await requiredAudit(tx, { shopId, userId: actor.userId, action: "ORDER_MARKETPLACE_SETUP_SAVED", entityType: "RestaurantMarketplaceConnection", entityId: saved.id,
        before: existing ? publicConnection(existing) : undefined, after: publicConnection(saved), req: actor.req });
      return publicConnection(saved);
    }, { isolationLevel: "Serializable" });
  }

  async function verify({ shopId, connectionId, actor = {} }) {
    const row = await client.restaurantMarketplaceConnection.findFirst({ where: { id: connectionId, shopId } });
    if (!row) throw new AppError("Marketplace connection not found", 404, "MARKETPLACE_CONNECTION_NOT_FOUND");
    const adapter = adapterFor(row.provider);
    // The adapter must prove this exact outlet AND environment through the
    // provider. A successful generic credential request is not enough.
    await restaurantLocation(client, shopId, row.locationId);
    const evidence = await adapter.verifyOutlet({ shopId, locationId: row.locationId, connectionId: row.id, externalOutletId: row.externalOutletId, environment: row.environment });
    if (!adapter.version || evidence?.externalOutletId !== row.externalOutletId || evidence?.environment !== row.environment
      || evidence?.shopId !== shopId || evidence?.locationId !== row.locationId
      || typeof evidence?.reference !== "string" || !evidence.reference.trim() || evidence.reference.length > 240) {
      throw conflict("Provider did not verify this exact outlet and environment", "MARKETPLACE_OUTLET_NOT_VERIFIED");
    }
    try {
      return await client.$transaction(async (tx) => {
        await restaurantLocation(tx, shopId, row.locationId);
        const existingBinding = await tx.restaurantMarketplaceConnection.findFirst({ where: {
          provider: row.provider, environment: row.environment, externalOutletId: row.externalOutletId,
          status: "verified", NOT: { id: row.id },
        } });
        if (existingBinding) throw conflict("This provider outlet is already bound", "MARKETPLACE_OUTLET_ALREADY_BOUND");
        const updated = await tx.restaurantMarketplaceConnection.updateMany({
          where: { id: row.id, shopId, updatedAt: row.updatedAt, externalOutletId: row.externalOutletId, environment: row.environment, locationId: row.locationId },
          data: { status: "verified", enabled: true, adapterVersion: adapter.version, verificationReference: evidence.reference, verifiedAt: new Date(), updatedByUserId: actor.userId ?? null },
        });
        if (updated.count !== 1) throw conflict("Marketplace setup changed during verification", "MARKETPLACE_VERIFICATION_CONFLICT");
        const saved = await tx.restaurantMarketplaceConnection.findUniqueOrThrow({ where: { id: row.id } });
        await requiredAudit(tx, { shopId, userId: actor.userId, action: "ORDER_MARKETPLACE_OUTLET_VERIFIED", entityType: "RestaurantMarketplaceConnection", entityId: row.id, after: publicConnection(saved), req: actor.req });
        return publicConnection(saved);
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error.code === "P2002") throw conflict("This provider outlet is already bound", "MARKETPLACE_OUTLET_ALREADY_BOUND");
      throw error;
    }
  }

  async function ingest({ provider, rawBody, headers }) {
    const adapter = adapterFor(provider);
    if (!Buffer.isBuffer(rawBody) || rawBody.length > 512 * 1024) throw new AppError("Invalid marketplace payload", 400, "MARKETPLACE_PAYLOAD_INVALID");
    // Authentication and provider-field mapping happen BEFORE parsing the
    // internal schema. No event-supplied shop id is ever trusted or accepted.
    const event = marketplaceEventSchema.parse(await adapter.authenticateAndNormalize({ rawBody, headers }));
    const payloadHash = hash(event);
    return client.$transaction(async (tx) => {
      const connection = await tx.restaurantMarketplaceConnection.findFirst({ where: {
        provider, externalOutletId: event.externalOutletId, environment: event.environment, status: "verified",
      } });
      if (!connection || !connection.verifiedAt || !connection.verificationReference || connection.adapterVersion !== adapter.version) {
        throw new AppError("Provider outlet is not verified for this adapter", 403, "MARKETPLACE_OUTLET_NOT_VERIFIED");
      }
      await restaurantLocation(tx, connection.shopId, connection.locationId);
      const receipt = await tx.restaurantMarketplaceEvent.findUnique({ where: { connectionId_eventId: { connectionId: connection.id, eventId: event.eventId } } });
      if (receipt) {
        if (receipt.payloadHash !== payloadHash) throw conflict("Provider event id was reused with different content", "MARKETPLACE_EVENT_CONFLICT");
        return { duplicate: true, result: receipt.result };
      }
      const where = { connectionId_externalOrderId: { connectionId: connection.id, externalOrderId: event.externalOrderId } };
      let order = await tx.restaurantMarketplaceOrder.findUnique({ where });
      let result = "unchanged";
      if (event.kind === "order.created") {
        if (order && order.contentHash !== hash(event.order)) throw conflict("Provider order snapshot changed; explicit reconciliation is required", "MARKETPLACE_ORDER_CONFLICT");
        if (!order) {
          if (!connection.enabled) throw conflict("Marketplace outlet intake is paused", "MARKETPLACE_INTAKE_PAUSED");
          order = await tx.restaurantMarketplaceOrder.create({ data: {
            shopId: connection.shopId, connectionId: connection.id, externalOrderId: event.externalOrderId,
            snapshotJson: JSON.stringify(event.order), contentHash: hash(event.order), totalPaise: event.order.totalPaise,
            providerPayment: event.order.providerPayment, lastProviderEventAt: new Date(event.occurredAt),
          } });
          result = "created";
        }
      } else {
        // No silent acknowledgement of status-before-create: provider retries
        // after the missing order arrives, instead of losing a cancellation.
        if (!order) throw conflict("Order must be relayed before its status update", "MARKETPLACE_ORDER_MISSING");
        const next = event.kind === "order.cancelled" ? "cancelled" : "fulfilled";
        if (TERMINAL.has(order.status) && order.status !== next) throw conflict("Conflicting terminal marketplace status requires review", "MARKETPLACE_TERMINAL_CONFLICT");
        if (new Date(event.occurredAt) < order.lastProviderEventAt) result = "stale";
        else if (order.status !== next) {
          order = await tx.restaurantMarketplaceOrder.update({ where: { id: order.id }, data: { status: next, lastProviderEventAt: new Date(event.occurredAt) } });
          // Pending actions must not be sent after a provider cancellation.
          await tx.restaurantMarketplaceCommand.updateMany({ where: { orderId: order.id, status: "pending" }, data: { status: "needs_review", lastErrorCode: "PROVIDER_ORDER_TERMINAL" } });
          result = "updated";
        }
      }
      await tx.restaurantMarketplaceEvent.create({ data: {
        shopId: connection.shopId, connectionId: connection.id, eventId: event.eventId, externalOrderId: event.externalOrderId,
        kind: event.kind, payloadHash, result, occurredAt: new Date(event.occurredAt),
      } });
      await requiredAudit(tx, { shopId: connection.shopId, action: "ORDER_MARKETPLACE_EVENT_RECEIVED", entityType: "RestaurantMarketplaceOrder", entityId: order.id,
        metadata: { provider, eventId: event.eventId, kind: event.kind, result } });
      // No stock, KOT, payment, bill or customer mutations occur at intake.
      return { duplicate: false, result, orderId: order.id };
    }, { isolationLevel: "Serializable" });
  }

  async function queueCommand({ shopId, orderId, input, actor = {} }) {
    const command = marketplaceCommandSchema.parse(input);
    return client.$transaction(async (tx) => {
      const order = await tx.restaurantMarketplaceOrder.findFirst({ where: { id: orderId, shopId }, include: { connection: true } });
      if (!order) throw new AppError("Marketplace order not found", 404, "MARKETPLACE_ORDER_NOT_FOUND");
      await restaurantLocation(tx, shopId, order.connection.locationId);
      const adapter = adapterFor(order.connection.provider);
      if (order.connection.status !== "verified" || !order.connection.verifiedAt || !order.connection.verificationReference || order.connection.adapterVersion !== adapter.version) throw conflict("Verify the current provider adapter before sending commands", "MARKETPLACE_OUTLET_NOT_VERIFIED");
      const existing = await tx.restaurantMarketplaceCommand.findUnique({ where: { orderId_requestKey: { orderId, requestKey: command.requestKey } } });
      if (existing) {
        if (existing.requestJson !== JSON.stringify(command)) throw conflict("Command key was reused for a different action", "MARKETPLACE_COMMAND_CONFLICT");
        return existing;
      }
      if ((command.action === "ready" && order.status !== "accepted") || (command.action !== "ready" && order.status !== "new")) {
        throw conflict("Order is not in the state required for this action", "MARKETPLACE_INVALID_TRANSITION");
      }
      const pending = await tx.restaurantMarketplaceCommand.findFirst({ where: { orderId, status: { in: ["pending", "sending", "needs_review"] } } });
      if (pending) throw conflict("Resolve the previous provider action before starting another", "MARKETPLACE_COMMAND_PENDING");
      const saved = await tx.restaurantMarketplaceCommand.create({ data: { shopId, connectionId: order.connectionId, orderId, requestKey: command.requestKey, action: command.action, requestJson: JSON.stringify(command) } });
      await requiredAudit(tx, { shopId, userId: actor.userId, action: "ORDER_MARKETPLACE_COMMAND_QUEUED", entityType: "RestaurantMarketplaceCommand", entityId: saved.id, metadata: { action: command.action }, req: actor.req });
      return saved;
    }, { isolationLevel: "Serializable" });
  }

  async function dispatchCommand({ shopId, commandId }) {
    // Read the current order and claim delivery in one transaction. Two workers
    // cannot send the same command, and a pre-existing cancellation wins.
    const claim = await client.$transaction(async (tx) => {
      const row = await tx.restaurantMarketplaceCommand.findFirst({ where: { id: commandId, shopId }, include: { connection: true, order: true } });
      if (!row) throw new AppError("Marketplace command not found", 404, "MARKETPLACE_COMMAND_NOT_FOUND");
      if (row.status !== "pending") return { status: row.status };
      const adapter = adapterFor(row.connection.provider);
      if (row.connection.status !== "verified" || !row.connection.verifiedAt || !row.connection.verificationReference || row.connection.adapterVersion !== adapter.version) throw conflict("Provider adapter requires verification", "MARKETPLACE_OUTLET_NOT_VERIFIED");
      await restaurantLocation(tx, shopId, row.connection.locationId);
      if ((row.action === "ready" && row.order.status !== "accepted") || (row.action !== "ready" && row.order.status !== "new")) {
        await tx.restaurantMarketplaceCommand.update({ where: { id: row.id }, data: { status: "needs_review", lastErrorCode: "PROVIDER_STATUS_RACE" } });
        return { status: "needs_review" };
      }
      const claimed = await tx.restaurantMarketplaceCommand.updateMany({ where: { id: row.id, shopId, status: "pending" }, data: { status: "sending", attemptCount: { increment: 1 } } });
      if (claimed.count !== 1) return { status: "sending" };
      await requiredAudit(tx, { shopId, action: "ORDER_MARKETPLACE_COMMAND_CLAIMED", entityType: "RestaurantMarketplaceCommand", entityId: row.id });
      return { row };
    }, { isolationLevel: "Serializable" });
    if (!claim.row) return { status: claim.status };
    const row = claim.row;
    const adapter = adapterFor(row.connection.provider);
    let acknowledgement;
    try {
      acknowledgement = await adapter.sendCommand({ externalOutletId: row.connection.externalOutletId, externalOrderId: row.order.externalOrderId, environment: row.connection.environment, ...JSON.parse(row.requestJson) });
    } catch {
      // A timeout may mean the provider accepted it. Never blind-retry an
      // irreversible action without its provider's idempotency/reconcile rules.
      await client.restaurantMarketplaceCommand.update({ where: { id: row.id }, data: { status: "needs_review", lastErrorCode: "PROVIDER_OUTCOME_UNKNOWN" } });
      return { status: "needs_review" };
    }
    if (acknowledgement?.confirmed !== true || acknowledgement.externalOrderId !== row.order.externalOrderId) {
      await client.restaurantMarketplaceCommand.update({ where: { id: row.id }, data: { status: "needs_review", lastErrorCode: "PROVIDER_ACK_INVALID" } });
      return { status: "needs_review" };
    }
    return client.$transaction(async (tx) => {
      const current = await tx.restaurantMarketplaceOrder.findUniqueOrThrow({ where: { id: row.orderId } });
      const nextStatus = COMMAND_STATUS[row.action];
      const terminalConflict = TERMINAL.has(current.status) && current.status !== nextStatus;
      await tx.restaurantMarketplaceCommand.update({ where: { id: row.id }, data: { status: terminalConflict ? "needs_review" : "delivered", deliveredAt: new Date(), lastErrorCode: terminalConflict ? "PROVIDER_STATUS_RACE" : null } });
      if (!terminalConflict) await tx.restaurantMarketplaceOrder.update({ where: { id: row.orderId }, data: { status: nextStatus } });
      await requiredAudit(tx, { shopId, action: "ORDER_MARKETPLACE_COMMAND_ACKNOWLEDGED", entityType: "RestaurantMarketplaceCommand", entityId: row.id, metadata: { action: row.action, terminalConflict } });
      return { status: terminalConflict ? "needs_review" : "delivered" };
    }, { isolationLevel: "Serializable" });
  }

  return { list, save, verify, ingest, queueCommand, dispatchCommand };
}

export const restaurantMarketplaceService = createRestaurantMarketplaceService();
