import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { dispatchIntegrationDeliveries, stageIntegrationEvent } from "./integrations.service.js";

const SEARCH_PAGE_SIZE = 20;
const DETAIL_BATCH_SIZE = 25;
const MAX_PROVIDER_PAGES = 250;
const MAX_REPORTED_ISSUES = 100;

const SEARCH_FILTERS = Object.freeze([
  { type: "preDispatch", states: ["APPROVED", "PACKING_IN_PROGRESS", "PACKED", "FORM_FAILED", "READY_TO_DISPATCH"] },
  // Flipkart currently requires post-dispatch SELF and NORMAL shipments to be
  // requested separately.
  { type: "postDispatch", states: ["SHIPPED", "DELIVERED", "PICKUP_COMPLETE"], shipmentTypes: ["NORMAL"] },
  { type: "postDispatch", states: ["SHIPPED", "DELIVERED", "PICKUP_COMPLETE"], shipmentTypes: ["SELF"] },
  // cancellationType is mandatory for the cancelled search, so cover all three
  // documented sources instead of silently missing one kind of cancellation.
  { type: "cancelled", states: ["CANCELLED"], cancellationType: "marketplaceCancellation" },
  { type: "cancelled", states: ["CANCELLED"], cancellationType: "sellerCancellation" },
  { type: "cancelled", states: ["CANCELLED"], cancellationType: "buyerCancellation" },
]);

const PROVIDER_STATUS_RANK = Object.freeze({
  APPROVED: 0,
  FORM_FAILED: 0,
  PACKING_IN_PROGRESS: 1,
  PACKED: 1,
  READY_TO_DISPATCH: 2,
  PICKUP_COMPLETE: 2,
  SHIPPED: 2,
  DELIVERED: 3,
  CANCELLED: 4,
});

let tokenCache = null;

function text(value, max = 400) {
  return String(value ?? "").trim().slice(0, max);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function credentialConfigured() {
  return Boolean(env.FLIPKART_SELLER_API_ENABLED && env.FLIPKART_APP_ID && env.FLIPKART_APP_SECRET && env.FLIPKART_SHOP_ID);
}

function isBoundShop(shopId) {
  return credentialConfigured() && String(env.FLIPKART_SHOP_ID) === String(shopId);
}

export function parseFlipkartLocationMap(value = env.FLIPKART_LOCATION_MAP_JSON) {
  let parsed;
  try { parsed = JSON.parse(value || "{}"); } catch {
    throw new AppError("Flipkart location mapping is not valid JSON", 503, "FLIPKART_LOCATION_MAP_INVALID");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new AppError("Flipkart location mapping must be an object", 503, "FLIPKART_LOCATION_MAP_INVALID");
  }
  const entries = Object.entries(parsed).map(([externalId, locationCode]) => [text(externalId, 120), text(locationCode, 80)]);
  if (!entries.length || entries.some(([externalId, locationCode]) => !externalId || !locationCode)) {
    throw new AppError("Flipkart location mapping must contain valid external IDs and store codes", 503, "FLIPKART_LOCATION_MAP_INVALID");
  }
  return new Map(entries);
}

function assertShopBinding(shopId, { requireLocations = false } = {}) {
  if (!env.FLIPKART_SELLER_API_ENABLED) {
    throw new AppError("Flipkart Seller API is not enabled", 503, "FLIPKART_NOT_CONFIGURED");
  }
  // A process-level credential set belongs to one tenant. Return a flat 404 to
  // every other tenant so the endpoint cannot reveal that another shop has a
  // seller account connected.
  if (!env.FLIPKART_SHOP_ID || String(env.FLIPKART_SHOP_ID) !== String(shopId)) {
    throw new AppError("Flipkart connector not found", 404, "FLIPKART_CONNECTOR_NOT_FOUND");
  }
  if (!env.FLIPKART_APP_ID || !env.FLIPKART_APP_SECRET) {
    throw new AppError("Flipkart Seller API credentials are not configured", 503, "FLIPKART_NOT_CONFIGURED");
  }
  return requireLocations ? parseFlipkartLocationMap() : null;
}

async function resolveLocationMap(shopId) {
  const configuredMap = assertShopBinding(shopId, { requireLocations: true });
  const codes = [...new Set(configuredMap.values())];
  const locations = await db.storeLocation.findMany({
    where: { shopId, active: true, code: { in: codes } },
    select: { id: true, code: true, name: true },
  });
  const byCode = new Map(locations.map((location) => [location.code, location]));
  const unresolvedCodes = codes.filter((code) => !byCode.has(code));
  if (unresolvedCodes.length) {
    throw new AppError(
      "One or more Flipkart warehouses map to a missing or inactive store location",
      503,
      "FLIPKART_LOCATION_TARGET_MISSING",
    );
  }
  return new Map([...configuredMap].map(([externalId, code]) => [externalId, byCode.get(code)]));
}

export async function flipkartStatus(shopId) {
  if (!isBoundShop(shopId)) {
    return {
      enabled: false,
      configured: false,
      boundToCurrentShop: false,
      mode: "self_access",
      officialDocuments: false,
      orderSyncConfigured: false,
      mappedLocations: 0,
    };
  }

  let mappedLocations = 0;
  let orderSyncConfigured = false;
  try {
    const locationMap = await resolveLocationMap(shopId);
    mappedLocations = new Set([...locationMap.values()].map((location) => location.id)).size;
    orderSyncConfigured = locationMap.size > 0;
  } catch {
    // Status is a diagnostic read, not an operation. Report incomplete setup
    // without turning the whole settings page into a 503.
  }
  return {
    enabled: true,
    configured: true,
    boundToCurrentShop: true,
    mode: "self_access",
    officialDocuments: true,
    orderSyncConfigured,
    mappedLocations,
  };
}

async function accessToken() {
  if (!credentialConfigured()) throw new AppError("Flipkart Seller API credentials are not configured", 503, "FLIPKART_NOT_CONFIGURED");
  if (tokenCache?.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const credentials = Buffer.from(`${env.FLIPKART_APP_ID}:${env.FLIPKART_APP_SECRET}`).toString("base64");
  const url = new URL("/oauth-service/oauth/token", env.FLIPKART_API_BASE_URL);
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("scope", "Seller_Api");
  let response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(env.FLIPKART_API_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(`Could not reach Flipkart authentication: ${error.message}`, 502, "FLIPKART_AUTH_UNREACHABLE");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new AppError(body.error_description || "Flipkart authentication failed", 502, "FLIPKART_AUTH_FAILED");
  }
  tokenCache = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000,
  };
  return tokenCache.value;
}

function providerUrl(pathOrUrl, { pagination = false } = {}) {
  const base = new URL(env.FLIPKART_API_BASE_URL);
  const url = new URL(pathOrUrl, base);
  if (url.origin !== base.origin) {
    throw new AppError("Flipkart returned an unsafe pagination URL", 502, "FLIPKART_PAGINATION_URL_INVALID");
  }
  if (pagination && !url.pathname.startsWith("/sellers/v3/shipments/filter/")) {
    throw new AppError("Flipkart returned an unexpected pagination URL", 502, "FLIPKART_PAGINATION_URL_INVALID");
  }
  return url;
}

async function flipkartJsonRequest(pathOrUrl, { method = "GET", body, pagination = false } = {}) {
  const url = providerUrl(pathOrUrl, { pagination });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken();
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(env.FLIPKART_API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError(`Could not reach Flipkart: ${error.message}`, 502, "FLIPKART_API_UNREACHABLE");
    }
    if (response.status === 401 && attempt === 0) {
      tokenCache = null;
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AppError(`Flipkart rejected the request (${response.status})`, 502, "FLIPKART_API_REJECTED");
    }
    if (!payload || typeof payload !== "object") {
      throw new AppError("Flipkart returned an invalid JSON response", 502, "FLIPKART_RESPONSE_INVALID");
    }
    return payload;
  }
  throw new AppError("Flipkart authentication failed", 502, "FLIPKART_AUTH_FAILED");
}

export function buildFlipkartSearchBody(filter, { from, to }) {
  return {
    filter: {
      ...filter,
      orderDate: {
        from: `${from}T00:00:00.000+05:30`,
        to: `${to}T23:59:59.999+05:30`,
      },
    },
    pagination: { pageSize: SEARCH_PAGE_SIZE },
    sort: { field: "orderDate", order: "asc" },
  };
}

function responseShipments(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.shipments)) return payload.shipments;
  if (Array.isArray(payload.shipmentDetails)) return payload.shipmentDetails;
  return null;
}

async function searchShipments(input) {
  const byId = new Map();
  let truncated = false;

  searchLoop:
  for (const [filterIndex, filter] of SEARCH_FILTERS.entries()) {
    let payload = await flipkartJsonRequest("/sellers/v3/shipments/filter/", {
      method: "POST",
      body: buildFlipkartSearchBody(filter, input),
    });
    let pages = 0;
    while (true) {
      pages += 1;
      if (pages > MAX_PROVIDER_PAGES) {
        throw new AppError("Flipkart pagination exceeded the safety limit", 502, "FLIPKART_PAGINATION_LIMIT");
      }
      const shipments = responseShipments(payload);
      if (!shipments) throw new AppError("Flipkart shipment response is invalid", 502, "FLIPKART_RESPONSE_INVALID");
      for (const [index, shipment] of shipments.entries()) {
        const shipmentId = text(shipment?.shipmentId, 100);
        if (!shipmentId) throw new AppError("Flipkart returned a shipment without an ID", 502, "FLIPKART_RESPONSE_INVALID");
        byId.set(shipmentId, shipment);
        if (byId.size >= input.maxShipments) {
          truncated = Boolean(payload.hasMore) || index < shipments.length - 1 || filterIndex < SEARCH_FILTERS.length - 1;
          break searchLoop;
        }
      }
      if (!payload.hasMore) break;
      if (!payload.nextPageUrl) throw new AppError("Flipkart pagination response is incomplete", 502, "FLIPKART_RESPONSE_INVALID");
      payload = await flipkartJsonRequest(payload.nextPageUrl, { pagination: true });
    }
  }

  return { shipments: [...byId.values()], truncated };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function shipmentDetails(shipmentIds) {
  const byId = new Map();
  for (const batch of chunks(shipmentIds, DETAIL_BATCH_SIZE)) {
    const safeIds = batch.map((id) => encodeURIComponent(id)).join(",");
    const payload = await flipkartJsonRequest(`/sellers/v3/shipments/${safeIds}`);
    const details = responseShipments(payload);
    if (!details) throw new AppError("Flipkart shipment-detail response is invalid", 502, "FLIPKART_RESPONSE_INVALID");
    for (const detail of details) {
      const shipmentId = text(detail?.shipmentId, 100);
      if (shipmentId) byId.set(shipmentId, detail);
    }
  }
  return byId;
}

function shipmentItems(shipment) {
  const direct = Array.isArray(shipment?.orderItems) ? shipment.orderItems : [];
  const nested = Array.isArray(shipment?.subShipments)
    ? shipment.subShipments.flatMap((subShipment) => Array.isArray(subShipment?.orderItems) ? subShipment.orderItems : [])
    : [];
  return direct.length ? direct : nested;
}

function highestProviderStatus(shipment) {
  const statuses = [shipment?.status, ...shipmentItems(shipment).map((item) => item?.status)]
    .map((status) => text(status, 40).toUpperCase())
    .filter(Boolean);
  return statuses.sort((a, b) => (PROVIDER_STATUS_RANK[b] ?? -1) - (PROVIDER_STATUS_RANK[a] ?? -1))[0] || "APPROVED";
}

export function mapFlipkartOrderStatus(providerStatus) {
  const status = text(providerStatus, 40).toUpperCase();
  if (status === "CANCELLED") return "cancelled";
  if (status === "DELIVERED") return "fulfilled";
  if (["READY_TO_DISPATCH", "PICKUP_COMPLETE", "SHIPPED"].includes(status)) return "ready";
  if (["PACKING_IN_PROGRESS", "PACKED"].includes(status)) return "accepted";
  return "new";
}

function fulfillmentStatus(orderStatus) {
  return {
    new: "unfulfilled",
    accepted: "preparing",
    ready: "ready",
    fulfilled: "fulfilled",
    cancelled: "cancelled",
  }[orderStatus] || "unfulfilled";
}

function statusDates(status, now = new Date()) {
  return {
    ...(status === "accepted" ? { acceptedAt: now } : {}),
    ...(status === "ready" ? { acceptedAt: now, readyAt: now } : {}),
    ...(status === "fulfilled" ? { acceptedAt: now, readyAt: now, fulfilledAt: now } : {}),
    ...(status === "cancelled" ? { cancelledAt: now } : {}),
  };
}

function missingStatusDates(existing, status, now = new Date()) {
  return Object.fromEntries(
    Object.entries(statusDates(status, now)).filter(([field]) => !existing?.[field]),
  );
}

function advanceOrderStatus(current, provider) {
  if (["rejected", "cancelled"].includes(current)) return current;
  if (current === "fulfilled") return current;
  if (provider === "cancelled") return "cancelled";
  const rank = { new: 0, accepted: 1, ready: 2, fulfilled: 3 };
  return (rank[provider] ?? 0) > (rank[current] ?? 0) ? provider : current;
}

function deliveryIdentity(detail = {}) {
  const address = detail.deliveryAddress || detail.billingAddress || {};
  const buyer = detail.buyerDetails || {};
  const name = text([address.firstName, address.lastName].filter(Boolean).join(" ") || [buyer.firstName, buyer.lastName].filter(Boolean).join(" "), 120) || "Flipkart buyer";
  const mobile = text(address.contactNumber || detail.billingAddress?.contactNumber || buyer.contactNumber, 30).replace(/[^+\d]/g, "").slice(0, 15);
  const addressText = [address.addressLine1, address.addressLine2, address.landmark, address.city, address.stateName || address.state, address.pincode]
    .map((part) => text(part, 120))
    .filter(Boolean)
    .join(", ")
    .slice(0, 400);
  return { name, mobile, address: addressText || null };
}

function providerUnitPrice(item, quantity) {
  const price = item?.priceComponents || {};
  const totalPrice = price.totalPrice === null || price.totalPrice === undefined || price.totalPrice === "" ? Number.NaN : Number(price.totalPrice);
  if (Number.isFinite(totalPrice) && totalPrice >= 0) return round2(totalPrice / quantity);
  for (const candidate of [price.customerPrice, price.sellingPrice]) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return round2(value);
  }
  return null;
}

async function catalogMatches(shopId, shipments) {
  const skus = [...new Set(shipments.flatMap((shipment) => shipmentItems(shipment).map((item) => text(item?.sku, 120))).filter(Boolean))];
  if (!skus.length) return new Map();
  const [products, units] = await Promise.all([
    db.product.findMany({
      where: { shopId, deletedAt: null, sku: { in: skus } },
      select: { id: true, sku: true, name: true, displayUnit: true, rateUnit: true },
    }),
    db.productSellingUnit.findMany({
      where: { shopId, isActive: true, sku: { in: skus }, product: { deletedAt: null } },
      select: { id: true, sku: true, name: true, unitCode: true, product: { select: { id: true, name: true, displayUnit: true, rateUnit: true } } },
    }),
  ]);
  const candidates = new Map(skus.map((sku) => [sku, []]));
  for (const product of products) candidates.get(product.sku)?.push({ product, sellingUnit: null });
  for (const unit of units) candidates.get(unit.sku)?.push({ product: unit.product, sellingUnit: unit });
  return candidates;
}

function prepareShipment({ shipment, detail, locationMap, catalog }) {
  const shipmentId = text(shipment.shipmentId, 100);
  const providerLocationId = text(shipment.locationId || detail?.locationId, 120);
  const location = locationMap.get(providerLocationId);
  if (!location) {
    return { issue: { shipmentId, code: "LOCATION_UNMAPPED", locationId: providerLocationId || null } };
  }

  const rawItems = shipmentItems(shipment);
  if (!rawItems.length) return { issue: { shipmentId, code: "ITEMS_MISSING" } };
  const lines = [];
  const missingSkus = new Set();
  const ambiguousSkus = new Set();
  const invalidSkus = new Set();
  for (const item of rawItems) {
    const sku = text(item?.sku, 120);
    const quantity = Number(item?.quantity);
    const matches = catalog.get(sku) || [];
    if (!sku || matches.length === 0) { missingSkus.add(sku || "(blank)"); continue; }
    if (matches.length !== 1) { ambiguousSkus.add(sku); continue; }
    if (!Number.isFinite(quantity) || quantity <= 0) { invalidSkus.add(sku); continue; }
    const price = providerUnitPrice(item, quantity);
    if (price === null) { invalidSkus.add(sku); continue; }
    const match = matches[0];
    lines.push({
      productId: match.product.id,
      ...(match.sellingUnit ? { sellingUnitId: match.sellingUnit.id } : {}),
      name: match.sellingUnit ? `${match.product.name} · ${match.sellingUnit.name}` : match.product.name,
      unit: match.sellingUnit?.name || match.product.rateUnit || match.product.displayUnit || "piece",
      price,
      qty: round2(quantity),
      externalSku: sku,
      externalOrderItemId: text(item?.orderItemId, 120) || null,
    });
  }
  if (missingSkus.size || ambiguousSkus.size || invalidSkus.size) {
    return {
      issue: {
        shipmentId,
        code: missingSkus.size ? "SKU_UNMAPPED" : ambiguousSkus.size ? "SKU_AMBIGUOUS" : "ITEM_INVALID",
        missingSkus: [...missingSkus],
        ambiguousSkus: [...ambiguousSkus],
        invalidSkus: [...invalidSkus],
      },
    };
  }

  const providerStatus = highestProviderStatus(shipment);
  const orderStatus = mapFlipkartOrderStatus(providerStatus);
  const identity = deliveryIdentity(detail);
  const orderIds = [...new Set(rawItems.map((item) => text(item?.orderId, 100)).filter(Boolean))];
  const estimatedTotal = round2(lines.reduce((sum, line) => sum + line.price * line.qty, 0));
  return {
    order: {
      shipmentId,
      location,
      providerStatus,
      orderStatus,
      identity,
      lines,
      itemCount: lines.length,
      estimatedTotal,
      note: text(`Flipkart shipment ${shipmentId} · Provider status ${providerStatus}${orderIds.length ? ` · Order ${orderIds.join(", ")}` : ""}`, 400),
    },
  };
}

async function writeRequiredMarketplaceAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError("Marketplace order was not saved because its audit record could not be stored", 503, "MARKETPLACE_AUDIT_UNAVAILABLE");
  }
  return audit;
}

function auditSnapshot(order) {
  return order ? {
    id: order.id,
    locationId: order.locationId,
    externalOrderId: order.externalOrderId,
    sourceChannel: order.sourceChannel,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: order.paymentStatus,
    itemCount: order.itemCount,
    estimatedTotal: order.estimatedTotal,
  } : null;
}

async function saveMarketplaceOrder(shopId, prepared, actor) {
  const idempotencyKey = `flipkart:shipment:${prepared.shipmentId}`;
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.customerOrder.findFirst({ where: { shopId, idempotencyKey } });
    if (existing && (existing.sourceChannel !== "marketplace" || existing.externalOrderId !== prepared.shipmentId)) {
      throw new AppError("Marketplace idempotency key belongs to a different order", 409, "FLIPKART_IDEMPOTENCY_CONFLICT");
    }
    const now = new Date();
    const nextStatus = existing ? advanceOrderStatus(existing.status, prepared.orderStatus) : prepared.orderStatus;
    const common = {
      locationId: prepared.location.id,
      customerName: prepared.identity.name,
      customerMobile: prepared.identity.mobile,
      customerAddress: prepared.identity.address,
      itemsJson: JSON.stringify(prepared.lines),
      itemCount: prepared.itemCount,
      estimatedTotal: prepared.estimatedTotal,
      note: prepared.note,
      fulfillmentType: "delivery",
      sourceChannel: "marketplace",
      externalOrderId: prepared.shipmentId,
      fulfillmentStatus: fulfillmentStatus(nextStatus),
      status: nextStatus,
    };

    let saved;
    let action;
    if (!existing) {
      saved = await tx.customerOrder.create({
        data: {
          shopId,
          ...common,
          paymentStatus: "unpaid",
          idempotencyKey,
          ...statusDates(nextStatus, now),
        },
      });
      action = "created";
    } else {
      // Once a bill exists, its item snapshot is the accounting record. Keep the
      // imported order's lines stable and only advance provider fulfilment state.
      const updateData = existing.billId
        ? {
            note: prepared.note,
            status: nextStatus,
            fulfillmentStatus: fulfillmentStatus(nextStatus),
            ...missingStatusDates(existing, nextStatus, now),
          }
        : { ...common, ...missingStatusDates(existing, nextStatus, now) };
      const changed = Object.entries(updateData).some(([key, value]) => {
        const existingValue = existing[key];
        if (value instanceof Date) return !existingValue;
        return existingValue !== value;
      });
      if (!changed) return { kind: "unchanged", order: existing, deliveries: [] };
      const claimed = await tx.customerOrder.updateMany({
        where: { id: existing.id, shopId, updatedAt: existing.updatedAt },
        data: updateData,
      });
      if (claimed.count !== 1) {
        throw new AppError("Marketplace order changed during sync", 409, "FLIPKART_ORDER_CONCURRENT_UPDATE");
      }
      saved = await tx.customerOrder.findUniqueOrThrow({ where: { id: existing.id } });
      action = "updated";
    }

    await writeRequiredMarketplaceAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: action === "created" ? "CUSTOMER_ORDER_MARKETPLACE_IMPORTED" : "CUSTOMER_ORDER_MARKETPLACE_SYNCED",
      entityType: "CustomerOrder",
      entityId: saved.id,
      before: auditSnapshot(existing),
      after: auditSnapshot(saved),
      metadata: {
        provider: "flipkart",
        providerStatus: prepared.providerStatus,
        shipmentId: prepared.shipmentId,
      },
      req: actor.req ?? null,
    }, tx);
    const deliveries = await stageIntegrationEvent(shopId, action === "created" ? "customer_order.created" : "customer_order.updated", {
      id: saved.id,
      locationId: saved.locationId,
      fulfillmentType: saved.fulfillmentType,
      status: saved.status,
      sourceChannel: saved.sourceChannel,
      paymentStatus: saved.paymentStatus,
      fulfillmentStatus: saved.fulfillmentStatus,
      itemCount: saved.itemCount,
      estimatedTotal: saved.estimatedTotal,
      externalOrderId: saved.externalOrderId,
    }, { client: tx });
    return { kind: action, order: saved, deliveries };
  }, { isolationLevel: "Serializable" });

  await dispatchIntegrationDeliveries(result.deliveries);
  return result.kind;
}

export async function syncFlipkartOrders(shopId, input, actor = {}) {
  const locationMap = await resolveLocationMap(shopId);
  const search = await searchShipments(input);
  const ids = search.shipments.map((shipment) => text(shipment.shipmentId, 100));
  const details = ids.length ? await shipmentDetails(ids) : new Map();
  const catalog = await catalogMatches(shopId, search.shipments);
  const result = {
    fetched: search.shipments.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    truncated: search.truncated,
    issues: [],
    omittedIssueCount: 0,
  };

  for (const shipment of search.shipments) {
    const shipmentId = text(shipment.shipmentId, 100);
    const prepared = prepareShipment({ shipment, detail: details.get(shipmentId), locationMap, catalog });
    if (prepared.issue) {
      result.skipped += 1;
      if (result.issues.length < MAX_REPORTED_ISSUES) result.issues.push(prepared.issue);
      else result.omittedIssueCount += 1;
      continue;
    }
    const kind = await saveMarketplaceOrder(shopId, prepared.order, actor);
    result[kind] += 1;
  }
  return result;
}

export async function downloadFlipkartDocument(shopId, shipmentId, kind) {
  assertShopBinding(shopId);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(shipmentId)) {
    throw new AppError("Invalid Flipkart shipment ID", 400, "FLIPKART_SHIPMENT_ID_INVALID");
  }
  const path = kind === "invoice"
    ? `/sellers/v3/shipments/${shipmentId}/invoices`
    : `/sellers/v3/shipments/${shipmentId}/labelOnly/pdf`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await accessToken();
    let response;
    try {
      response = await fetch(providerUrl(path), {
        method: kind === "label" ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}`, accept: "application/pdf" },
        signal: AbortSignal.timeout(env.FLIPKART_API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError(`Could not reach Flipkart: ${error.message}`, 502, "FLIPKART_API_UNREACHABLE");
    }
    if (response.status === 401 && attempt === 0) {
      tokenCache = null;
      continue;
    }
    if (!response.ok) throw new AppError(`Flipkart rejected the document request (${response.status})`, 502, "FLIPKART_DOCUMENT_REJECTED");
    const type = response.headers.get("content-type") || "";
    if (!type.toLowerCase().includes("application/pdf")) {
      throw new AppError("Flipkart did not return a PDF", 502, "FLIPKART_DOCUMENT_INVALID");
    }
    return Buffer.from(await response.arrayBuffer());
  }
  throw new AppError("Flipkart authentication failed", 502, "FLIPKART_AUTH_FAILED");
}

export function resetFlipkartTokenCacheForTests() {
  if (env.NODE_ENV === "production") return;
  tokenCache = null;
}
