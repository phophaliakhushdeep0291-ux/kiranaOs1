import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { listProducts } from "../products/products.service.js";
import { priceCatalogProducts } from "../pricing/pricing.service.js";
import { unavailableProductIds } from "../../shared/catalog-availability.js";
import { prepareStorefrontOrderLines, resolveStorefrontOrderContext, shapeStorefrontCatalog } from "../../shared/storefront-modes.js";
import { parseShopSettings } from "../shops/businessProfiles.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import { toBaseQty } from "../../utils/units.js";
import { createAuditLog } from "../audit/audit.service.js";
import { dispatchIntegrationDeliveries, stageIntegrationEvent } from "../integrations/integrations.service.js";

/**
 * Public, unauthenticated read of a shop's catalog for the QR customer self-order page.
 *
 * Privacy model (owner opt-in): a shop is only exposed here if its owner has turned on
 * "Customer QR ordering" (persisted at settingsJson.customerOrdering.enabled). Even then we
 * return ONLY storefront-safe fields — name, unit, selling price, MRP, image, category — and
 * never cost, margin, minimum price, stock, GST internals, or any customer data. Each request
 * is strictly scoped to the requested shopId, so this is deliberate single-shop exposure, not a
 * cross-tenant read.
 */

export function isCustomerOrderingEnabled(settingsJson) {
  if (!settingsJson) return false;
  try {
    const parsed = JSON.parse(settingsJson);
    return parsed?.customerOrdering?.enabled === true;
  } catch {
    return false;
  }
}

export function toCustomerSafeProduct(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? null,
    unit: p.displayUnit || p.rateUnit || p.unit || "piece",
    price: Number(p.storefrontPrice ?? p.defaultPricePerRateUnit ?? 0),
    mrp: p.mrp != null ? Number(p.mrp) : null,
    imageUrl: p.imageUrl ?? null,
  };
}

/**
 * Everything a shop is willing to show a stranger, before any one trade decides
 * how to present it.
 *
 * Split out because both reads need it and they must agree: the rule that
 * decides what a guest may SEE has to be the same one that decides what they may
 * ORDER, or a menu will happily accept a dish the till then refuses.
 */
async function loadStorefrontCandidates(shopId, locationId, quantitiesByProductId) {
  const products = await listProducts(shopId, { locationId });
  const priced = await priceCatalogProducts(shopId, products, locationId, quantitiesByProductId);
  // An outfit promised to someone for today is not on the rack, so customers must
  // not see it at all — same as a sold-out product. It reappears by itself the day
  // the booking window ends or the moment it is marked returned.
  const bookedOut = await unavailableProductIds(shopId, priced);
  return priced
    .filter((p) => p.status !== "inactive" && p.isActive !== false)
    .filter((p) => !bookedOut.has(p.id));
}

export async function getPublicCatalog(shopId, requestedLocationId = null, { tableCode = null } = {}) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  // One 404 for both "no such shop" and "ordering disabled" so we never leak which shop ids
  // exist or whether a real shop has the feature turned off.
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }

  const location = await resolveOperationalLocation(shopId, requestedLocationId);
  const [candidates, locations] = await Promise.all([
    loadStorefrontCandidates(shopId, location.id),
    db.storeLocation.findMany({
      where: { shopId, active: true },
      orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true, address: true, city: true, phone: true, isPrimary: true },
    }),
  ]);

  // A trade may serve a different public page from the same shop record — a
  // restaurant shows a menu, not a delivery catalogue. Asked through the shared
  // registry so this file never names a trade; null means "nobody claimed it",
  // which is the ordinary shelf storefront below.
  const settings = parseShopSettings(shop.settingsJson);
  const storefront = await shapeStorefrontCatalog({
    shopId, shop, settings, locationId: location.id, products: candidates, request: { tableCode },
  });

  const safe = storefront?.products
    // Only the default shelf storefront hides zero-stock items. A trade that
    // claimed the storefront has already applied its own rule, which for a
    // kitchen is the 86 list and its recipes — not a plate count nobody keeps.
    ?? candidates.filter((p) => Number(p.stockBaseQty ?? 0) > 0).map(toCustomerSafeProduct);

  return {
    shop: { id: shop.id, name: shop.name, city: shop.city ?? null },
    location: locations.find((row) => row.id === location.id),
    locations,
    products: safe,
    ...(storefront
      ? {
        storefront: {
          mode: storefront.mode,
          table: storefront.table ?? null,
          tableRequested: storefront.tableRequested === true,
          guestOrdersEnabled: storefront.guestOrdersEnabled !== false,
          branding: storefront.branding ?? null,
          menu: storefront.menu ?? null,
        },
      }
      : {}),
  };
}

const MAX_ORDER_LINES = 100;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Customer-facing stage for each internal status, so the tracker reads like a real online order.
const ORDER_STAGE = { new: "received", accepted: "preparing", ready: "ready", fulfilled: "ready", rejected: "declined", cancelled: "declined" };

function parseOrderLines(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((l) => ({
      name: l.name,
      qty: l.qty,
      price: l.price,
      unit: l.unit,
      variation: l.variation ?? null,
      addons: Array.isArray(l.addons) ? l.addons : [],
    }));
  } catch {
    return [];
  }
}

/**
 * Public order-status lookup for the customer's own tracker. The orderId is an unguessable cuid
 * that only the customer who placed it holds, so echoing back its status is safe — and we return
 * only order-shaped fields (status, lines, totals), never other customers' data. Same owner-opt-in
 * 404 gate as the catalog so a disabled/unknown shop leaks nothing.
 */
export async function getPublicOrderStatus(shopId, orderId) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }
  const order = await db.customerOrder.findFirst({
    where: { id: String(orderId ?? ""), shopId },
    select: { id: true, status: true, paymentStatus: true, fulfillmentStatus: true, fulfillmentType: true, promisedSlot: true, itemCount: true, estimatedTotal: true, itemsJson: true, tableName: true, createdAt: true, updatedAt: true, location: { select: { id: true, name: true, address: true, city: true, phone: true } } },
  });
  if (!order) throw new AppError("We couldn't find that order.", 404);
  return {
    orderId: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    stage: ORDER_STAGE[order.status] ?? order.status,
    fulfillmentType: order.fulfillmentType,
    promisedSlot: order.promisedSlot,
    tableName: order.tableName ?? null,
    location: order.location,
    itemCount: order.itemCount,
    estimatedTotal: order.estimatedTotal,
    items: parseOrderLines(order.itemsJson),
    shopName: shop.name,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function cleanOrderIdempotencyKey(value) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  return key.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120) || null;
}

function shapeOrderSubmitResponse(order, shopName, duplicate = false) {
  return {
    orderId: order.id,
    itemCount: order.itemCount,
    estimatedTotal: order.estimatedTotal,
    shopName,
    locationId: order.locationId ?? null,
    fulfillmentType: order.fulfillmentType ?? "delivery",
    // Echoed back so the confirmation reads "on its way to T5" rather than a
    // delivery promise the guest is not waiting for.
    tableName: order.tableName ?? null,
    status: order.status ?? "new",
    duplicate,
  };
}

async function writeRequiredPublicOrderAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Order was not accepted because its audit record could not be stored",
      503,
      "ORDER_AUDIT_UNAVAILABLE",
    );
  }
  return audit;
}

/**
 * A customer submits an order from the public QR page. We re-price every line from the shop's own
 * catalog (never trust client-sent prices) and store it in the owner's "Orders Received" inbox.
 * Only open when the owner has enabled customer ordering — same 404 gate as the catalog.
 */
export async function createPublicOrder(shopId, body = {}, options = {}) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }

  const idempotencyKey = cleanOrderIdempotencyKey(options.idempotencyKey ?? body.idempotencyKey);
  if (idempotencyKey) {
    const existing = await db.customerOrder.findFirst({
      where: { shopId, idempotencyKey },
      select: { id: true, locationId: true, fulfillmentType: true, status: true, itemCount: true, estimatedTotal: true, tableId: true, tableName: true, createdAt: true },
    });
    if (existing) return shapeOrderSubmitResponse(existing, shop.name, true);
  }

  // A trade may record something of its own on an order placed from its
  // storefront — a restaurant records which table it came from. Asked through
  // the shared registry so this file never names a trade.
  const settings = parseShopSettings(shop.settingsJson);
  const storefrontOrder = await resolveStorefrontOrderContext({ shopId, shop, settings, body });
  if (storefrontOrder?.blocked) {
    throw new AppError(storefrontOrder.reason ?? "This shop is not taking orders from this page.", 403);
  }

  const customerName = String(body.customerName ?? "").trim();
  const customerMobile = String(body.customerMobile ?? "").trim();
  const customerAddress = String(body.customerAddress ?? "").trim();
  const note = String(body.note ?? "").trim();
  const fulfillmentType = storefrontOrder?.fulfillmentType
    ?? (body.fulfillmentType === "pickup" ? "pickup" : "delivery");
  const promisedSlot = String(body.promisedSlot ?? "").trim().slice(0, 120) || null;
  const location = await resolveOperationalLocation(shopId, body.locationId || null);

  // A guest sitting at a table has already identified themselves by being in the
  // room, and the table is where the food goes. Demanding a name and a mobile
  // number before they can order a dosa is how a QR menu gets abandoned at the
  // second field — so for a seated order both are optional, and the table's name
  // stands in for one the guest did not give.
  const seatedAtTable = Boolean(storefrontOrder?.tableId);
  const orderedName = customerName || (seatedAtTable ? String(storefrontOrder.tableName ?? "Table") : "");
  if (!seatedAtTable && customerName.length < 2) throw new AppError("Please enter your name.", 400);
  if (customerMobile || !seatedAtTable) {
    if (!/^[6-9]\d{9}$/.test(customerMobile.replace(/[\s-]/g, ""))) {
      throw new AppError("Please enter a valid 10-digit mobile number.", 400);
    }
  }
  const addressRequired = storefrontOrder?.requiresAddress !== false && fulfillmentType === "delivery";
  if (addressRequired && customerAddress.length < 5) {
    throw new AppError("Please enter a delivery address.", 400);
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new AppError("Add at least one item to your order.", 400);
  if (rawItems.length > MAX_ORDER_LINES) throw new AppError("Too many items in one order.", 400);

  // Authoritative catalog re-price: the customer only sends productId + qty.
  const normalizedItems = new Map();
  for (const item of rawItems) {
    const productId = String(item.productId ?? "");
    const qty = round2(item.qty ?? item.quantity ?? 0);
    if (productId && qty > 0) normalizedItems.set(productId, round2((normalizedItems.get(productId) ?? 0) + qty));
  }
  const quantitiesByProductId = Object.fromEntries(normalizedItems);
  // A customer's phone may still be showing a catalogue cached before the outfit
  // was booked out, so the order path re-checks rather than trusting what they saw.
  const candidates = await loadStorefrontCandidates(shopId, location.id, quantitiesByProductId);
  const byId = new Map(candidates.map((p) => [p.id, p]));
  // Re-asked here, not carried over from the catalogue read: what the guest may
  // order has to be decided by the same rule that decided what they could see,
  // or a menu will cheerfully accept a dish the till then refuses.
  const storefront = await shapeStorefrontCatalog({
    shopId, shop, settings, locationId: location.id, products: candidates,
    request: { tableCode: body.tableCode ?? null },
  });
  const orderableIds = storefront ? new Set(storefront.products.map((p) => p.id)) : null;

  const preparedLines = await prepareStorefrontOrderLines({
    shopId, shop, settings, rawItems, products: candidates, orderableIds,
  });
  const lines = preparedLines ?? [];
  for (const [productId, qty] of preparedLines ? [] : normalizedItems) {
    const product = byId.get(productId);
    if (!product || qty <= 0) continue;
    if (orderableIds) {
      // The trade that owns this storefront already decided. For a kitchen that
      // is the 86 list and the recipe's ingredients — asking about the dish's
      // own stock here would refuse every dish a restaurant does not count.
      if (!orderableIds.has(productId)) continue;
    } else {
      if (Number(product.stockBaseQty ?? 0) <= 0) continue;
      const requestedBaseQty = toBaseQty(qty, product.rateUnit || product.baseUnit, product.baseUnit);
      if (requestedBaseQty > Number(product.stockBaseQty ?? 0) + 0.000001) {
        throw new AppError(`${product.name} has only ${product.stockBaseQty} ${product.baseUnit} available at this store.`, 409, "ORDER_QUANTITY_UNAVAILABLE");
      }
    }
    const safe = toCustomerSafeProduct(product);
    lines.push({ productId: safe.id, name: safe.name, unit: safe.unit, price: safe.price, qty });
  }
  if (lines.length === 0) throw new AppError("None of the selected items are available.", 400);

  const itemCount = lines.length;
  const estimatedTotal = round2(lines.reduce((sum, l) => sum + l.qty * l.price, 0));

  try {
    const result = await db.$transaction(async (tx) => {
      const order = await tx.customerOrder.create({
        data: {
          shopId,
          locationId: location.id,
          customerName: orderedName.slice(0, 120),
          customerMobile: customerMobile.replace(/[\s-]/g, "").slice(0, 15),
          customerAddress: customerAddress ? customerAddress.slice(0, 400) : null,
          note: note ? note.slice(0, 400) : null,
          fulfillmentType,
          // Both the id and the name: the id is how the floor screen finds the
          // table, the name is what the kitchen ticket prints and must survive the
          // table being renamed or taken off the floor plan mid-service.
          tableId: storefrontOrder?.tableId ?? null,
          tableName: storefrontOrder?.tableName ?? null,
          guestCount: storefrontOrder?.guestCount ?? null,
          promisedSlot,
          sourceChannel: "customer_portal",
          paymentStatus: "unpaid",
          fulfillmentStatus: "unfulfilled",
          itemsJson: JSON.stringify(lines),
          itemCount,
          estimatedTotal,
          status: "new",
          idempotencyKey,
        },
        select: { id: true, locationId: true, fulfillmentType: true, status: true, itemCount: true, estimatedTotal: true, tableId: true, tableName: true, createdAt: true },
      });
      await writeRequiredPublicOrderAudit({
        shopId,
        userId: null,
        deviceId: null,
        action: "CUSTOMER_ORDER_CREATED",
        entityType: "CustomerOrder",
        entityId: order.id,
        before: null,
        after: {
          id: order.id,
          locationId: order.locationId,
          fulfillmentType: order.fulfillmentType,
          status: order.status,
          itemCount: order.itemCount,
          estimatedTotal: order.estimatedTotal,
          tableId: order.tableId ?? null,
        },
        metadata: { sourceChannel: "customer_portal", idempotencyKey: idempotencyKey ?? null },
        req: options.actor?.req ?? null,
      }, tx);
      const deliveries = await stageIntegrationEvent(shopId, "customer_order.created", {
        id: order.id,
        locationId: order.locationId,
        fulfillmentType: order.fulfillmentType,
        status: order.status,
        itemCount: order.itemCount,
        estimatedTotal: order.estimatedTotal,
      }, { client: tx });
      return { order, deliveries };
    }, { isolationLevel: "Serializable" });

    await dispatchIntegrationDeliveries(result.deliveries);
    return shapeOrderSubmitResponse(result.order, shop.name);
  } catch (error) {
    if (idempotencyKey && error?.code === "P2002") {
      const existing = await db.customerOrder.findFirst({
        where: { shopId, idempotencyKey },
        select: { id: true, locationId: true, fulfillmentType: true, status: true, itemCount: true, estimatedTotal: true, tableId: true, tableName: true, createdAt: true },
      });
      if (existing) return shapeOrderSubmitResponse(existing, shop.name, true);
    }
    throw error;
  }
}
