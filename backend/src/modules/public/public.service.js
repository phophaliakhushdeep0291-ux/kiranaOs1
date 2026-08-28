import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { listProducts } from "../products/products.service.js";
import { priceCatalogProducts } from "../pricing/pricing.service.js";
import { unavailableProductIds } from "../../shared/catalog-availability.js";
import { prepareStorefrontOrderLines, resolveStorefrontCancellationPolicy, resolveStorefrontOrderContext, resolveStorefrontTerminal, shapeStorefrontCatalog } from "../../shared/storefront-modes.js";
import { parseShopSettings } from "../shops/businessProfiles.js";
import { resolveOperationalLocation } from "../stores/location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { dispatchIntegrationDeliveries, stageIntegrationEvent } from "../integrations/integrations.service.js";
import { activeOrderLines, cancelledOrderLines, parseCancellationSelection, applyCancellationSelection } from "../../shared/customer-order-lines.js";

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

export async function getPublicTerminal(shopId, terminalCode) {
  const terminal = await resolveStorefrontTerminal({
    shopId: String(shopId ?? "").trim(),
    terminalCode: String(terminalCode ?? "").trim(),
  });
  if (!terminal) throw new AppError("Terminal not found", 404, "KIOSK_TERMINAL_NOT_FOUND");
  return terminal;
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
 * STOCK NEVER GATES THE STOREFRONT.
 *
 * A customer order is a REQUEST, not a sale. It creates a CustomerOrder in the
 * owner's inbox and moves no stock at all — the shopkeeper accepts it, and stock
 * only moves later when they actually bill it at the counter. Refusing here
 * refuses a request on the strength of a number, and it is the wrong number:
 * kirana stock counts drift constantly, which is exactly why the counter itself
 * permits overselling rather than blocking a real sale (allowStockShortfall in
 * bills.service.js). The QR page was stricter than the till that fills it —
 * backwards, since the till is the one that actually moves stock.
 *
 * The failure was silent and total: it hid the product from the catalogue, or
 * dropped the line, or answered a 409 the guest could do nothing about. A shop
 * lost the order and never learnt it had one. Whether a customer wanting the
 * thing is worth a trip to the wholesaler is the shopkeeper's call, and they can
 * only make it if the order reaches them.
 *
 * A trade may still hide something from its own storefront — a restaurant's 86
 * switch, an outfit already promised to a wedding. Those are decisions someone
 * made, not a count that drifted, and they stay.
 */

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

  // Everything the shop sells, minus only what a trade deliberately withheld
  // (loadStorefrontCandidates drops inactive and booked-out products). Stock is
  // not consulted — see the note above.
  const safe = storefront?.products ?? candidates.map(toCustomerSafeProduct);

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
          cancellationWindowMinutes: storefront.cancellationWindowMinutes ?? 0,
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

function parseOrderLines(order, cancelled = false) {
  try {
    const parsed = cancelled ? cancelledOrderLines(order) : activeOrderLines(order);
    return parsed.map((l) => ({
      lineId: l.lineId,
      cancelledQty: l.cancelledQty ?? 0,
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      price: l.price,
      unit: l.unit,
      note: l.note ?? null,
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
    select: { id: true, billId: true, status: true, paymentStatus: true, fulfillmentStatus: true, fulfillmentType: true, promisedSlot: true, itemCount: true, estimatedTotal: true, itemsJson: true, tableId: true, tableName: true, createdAt: true, updatedAt: true, location: { select: { id: true, name: true, address: true, city: true, phone: true } } },
  });
  if (!order) throw new AppError("We couldn't find that order.", 404);
  const linkedBill = order.billId ? await db.bill.findFirst({ where: { id: order.billId, shopId }, select: { status: true, deletedAt: true, paidAmount: true, creditAmount: true } }) : null;
  const paymentStatus = resolveOrderPaymentStatus(order, linkedBill);
  const table = order.tableId ? await db.restaurantTable.findFirst({
    where: { id: order.tableId, shopId, active: true, deletedAt: null },
    select: { code: true },
  }) : null;
  const settings = parseShopSettings(shop.settingsJson);
  const cancelPolicy = await resolveStorefrontCancellationPolicy({ shopId, shop, settings });
  const cancelMinutes = Number(cancelPolicy?.windowMinutes ?? 0);
  const cancelAllowedUntil = cancelMinutes > 0
    ? new Date(order.createdAt.getTime() + cancelMinutes * 60_000)
    : null;
  return {
    orderId: order.id,
    status: order.status,
    paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    stage: ORDER_STAGE[order.status] ?? order.status,
    fulfillmentType: order.fulfillmentType,
    promisedSlot: order.promisedSlot,
    tableId: order.tableId ?? null,
    tableCode: table?.code ?? null,
    tableName: order.tableName ?? null,
    location: order.location,
    itemCount: order.itemCount,
    estimatedTotal: order.estimatedTotal,
    items: parseOrderLines(order),
    cancelledItems: parseOrderLines(order, true),
    shopName: shop.name,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    cancellation: {
      windowMinutes: cancelMinutes,
      allowedUntil: cancelAllowedUntil,
      allowed: order.status === "new" && !order.billId && paymentStatus === "unpaid" && cancelAllowedUntil !== null && Date.now() < cancelAllowedUntil.getTime(),
      itemSelectionAllowed: true,
    },
  };
}

/**
 * Cancel an untouched guest order inside the restaurant's configured window.
 * The deadline and current status are checked again in the atomic update so a
 * waiter accepting the ticket at the same moment always wins deterministically.
 */
export async function cancelPublicOrder(shopId, orderId, options = {}) {
  const selection = parseCancellationSelection(options.selection === undefined ? {} : options.selection);
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }
  const settings = parseShopSettings(shop.settingsJson);
  const cancelPolicy = await resolveStorefrontCancellationPolicy({ shopId, shop, settings });
  const minutes = Number(cancelPolicy?.windowMinutes ?? 0);
  if (minutes <= 0) throw new AppError("This restaurant does not allow online cancellation.", 409, "ORDER_CANCELLATION_DISABLED");

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.customerOrder.findFirst({ where: { id: String(orderId ?? ""), shopId } });
    if (!existing) throw new AppError("We couldn't find that order.", 404);
    if (existing.status === "cancelled" && !selection.items) return { deliveries: [] };
    const change = applyCancellationSelection(existing, selection);
    // A replay of already-cancelled quantities is read-only, including after
    // acceptance or expiry. No additional quantity can be removed here.
    if (selection.items && !change.changed) return { deliveries: [] };
    if (existing.status !== "new") {
      throw new AppError("The kitchen has already started this order. Please speak to the restaurant.", 409, "ORDER_ALREADY_ACCEPTED");
    }
    if (existing.billId || existing.paymentStatus !== "unpaid") {
      throw new AppError("This order has a payment or bill attached. Please ask staff to adjust it and arrange any refund.", 409, "ORDER_PAYMENT_LOCKED");
    }
    const now = new Date();
    if (now.getTime() >= existing.createdAt.getTime() + minutes * 60_000) {
      throw new AppError(`The ${minutes}-minute cancellation window has ended. Please speak to the restaurant.`, 409, "ORDER_CANCELLATION_WINDOW_ENDED");
    }
    const fullyCancelled = change.itemCount === 0;
    const claimed = await tx.customerOrder.updateMany({
      where: { id: existing.id, shopId, status: "new", updatedAt: existing.updatedAt,
        createdAt: { gt: new Date(now.getTime() - minutes * 60_000) }, billId: null, paymentStatus: "unpaid" },
      data: { itemsJson: JSON.stringify(change.snapshots), itemCount: change.itemCount, estimatedTotal: change.estimatedTotal,
        updatedAt: new Date(Math.max(now.getTime(), existing.updatedAt.getTime() + 1)),
        ...(fullyCancelled ? { status: "cancelled", fulfillmentStatus: "cancelled", cancelledAt: now } : {}) },
    });
    if (claimed.count !== 1) throw new AppError("The order changed before it could be cancelled. Refresh and check its status.", 409, "CONCURRENT_ORDER_UPDATE");
    const updated = await tx.customerOrder.findUniqueOrThrow({ where: { id: existing.id } });
    await writeRequiredPublicOrderAudit({
      shopId, userId: null, deviceId: null,
      action: fullyCancelled ? "CUSTOMER_ORDER_CANCELLED_BY_GUEST" : "CUSTOMER_ORDER_ITEMS_CANCELLED_BY_GUEST",
      entityType: "CustomerOrder", entityId: updated.id,
      before: { status: existing.status, items: activeOrderLines(existing), estimatedTotal: existing.estimatedTotal },
      after: { status: updated.status, items: activeOrderLines(updated), estimatedTotal: updated.estimatedTotal },
      metadata: { cancellationWindowMinutes: minutes, selection: selection.items ?? "all" }, req: options.actor?.req ?? null,
    }, tx);
    const deliveries = await stageIntegrationEvent(shopId, "customer_order.updated", {
      id: updated.id, locationId: updated.locationId, fulfillmentType: updated.fulfillmentType,
      status: updated.status, sourceChannel: updated.sourceChannel,
      paymentStatus: updated.paymentStatus, fulfillmentStatus: updated.fulfillmentStatus,
      billId: updated.billId, updatedAt: updated.updatedAt,
      itemCount: updated.itemCount, estimatedTotal: updated.estimatedTotal,
    }, { client: tx });
    return { deliveries };
  }, { isolationLevel: "Serializable" }).catch((error) => {
    if (error?.code === "P2034") throw new AppError("The order changed. Refresh it before trying again.", 409, "CONCURRENT_ORDER_UPDATE");
    throw error;
  });
  await dispatchIntegrationDeliveries(result.deliveries);
  return getPublicOrderStatus(shopId, orderId);
}

export async function submitPublicOrderFeedback(shopId, orderId, body = {}, options = {}) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) throw new AppError("We couldn't find that order.", 404);
  const rating = Number(body.rating);
  const comment = String(body.comment ?? "").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError("Choose a rating from 1 to 5.", 400);
  if (comment.length > 500) throw new AppError("Feedback must be 500 characters or fewer.", 400);

  const existing = await db.customerOrder.findFirst({ where: { id: String(orderId ?? ""), shopId } });
  if (!existing) throw new AppError("We couldn't find that order.", 404);
  if (existing.status !== "fulfilled") throw new AppError("Feedback opens after the order is served.", 409, "ORDER_NOT_FULFILLED");
  if (existing.feedbackAt) {
    return { rating: existing.feedbackRating, comment: existing.feedbackComment, submittedAt: existing.feedbackAt, duplicate: true };
  }

  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    const claimed = await tx.customerOrder.updateMany({
      where: { id: existing.id, shopId, status: "fulfilled", feedbackAt: null },
      data: { feedbackRating: rating, feedbackComment: comment || null, feedbackAt: now },
    });
    if (claimed.count !== 1) {
      const current = await tx.customerOrder.findUniqueOrThrow({ where: { id: existing.id } });
      return { current, deliveries: [] };
    }
    const current = await tx.customerOrder.findUniqueOrThrow({ where: { id: existing.id } });
    await writeRequiredPublicOrderAudit({
      shopId, userId: null, deviceId: null, action: "CUSTOMER_ORDER_FEEDBACK_SUBMITTED",
      entityType: "CustomerOrder", entityId: existing.id, before: null,
      after: { rating, hasComment: Boolean(comment) }, metadata: null, req: options.actor?.req ?? null,
    }, tx);
    const deliveries = await stageIntegrationEvent(shopId, "customer_order.feedback", {
      id: existing.id, rating, hasComment: Boolean(comment), submittedAt: now,
    }, { client: tx });
    return { current, deliveries };
  }, { isolationLevel: "Serializable" });
  await dispatchIntegrationDeliveries(result.deliveries);
  return { rating: result.current.feedbackRating, comment: result.current.feedbackComment, submittedAt: result.current.feedbackAt, duplicate: result.deliveries.length === 0 };
}

export async function createPublicGuestRequest(shopId, tableId, body = {}, options = {}) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) throw new AppError("This restaurant is not available.", 404);
  const settings = parseShopSettings(shop.settingsJson);
  const policy = await resolveStorefrontCancellationPolicy({ shopId, shop, settings });
  if (!policy) throw new AppError("This restaurant is not available.", 404);
  const type = body.type === "bill" ? "bill" : body.type === "waiter" ? "waiter" : null;
  if (!type) throw new AppError("Choose waiter or bill.", 400);
  const reason = String(body.reason ?? "").trim().slice(0, 200) || null;
  const splitMode = type === "bill" && ["none", "evenly", "by-item"].includes(body.splitMode) ? body.splitMode : null;
  const table = await db.restaurantTable.findFirst({ where: { id: String(tableId ?? ""), shopId, active: true, deletedAt: null, selfOrderEnabled: true } });
  if (!table) throw new AppError("We couldn't find that table.", 404);
  const orderId = String(body.orderId ?? "").trim() || null;
  if (orderId) {
    const order = await db.customerOrder.findFirst({ where: { id: orderId, shopId, tableId: table.id } });
    if (!order) throw new AppError("We couldn't match that order to this table.", 404);
  }
  const recent = await db.restaurantGuestRequest.findFirst({
    where: { shopId, tableId: table.id, type, status: { in: ["pending", "acknowledged"] }, requestedAt: { gte: new Date(Date.now() - 45_000) } },
    orderBy: { requestedAt: "desc" },
  });
  if (recent) return { ...recent, duplicate: true };
  const created = await db.$transaction(async (tx) => {
    const request = await tx.restaurantGuestRequest.create({ data: {
      shopId, tableId: table.id, tableCode: table.code, tableName: table.name,
      orderId, type, reason, splitMode,
    } });
    await writeRequiredPublicOrderAudit({
      shopId, userId: null, deviceId: null,
      action: type === "bill" ? "GUEST_BILL_REQUESTED" : "GUEST_WAITER_REQUESTED",
      entityType: "RestaurantGuestRequest", entityId: request.id,
      after: { tableId: table.id, tableName: table.name, type },
      req: options.actor?.req ?? null,
    }, tx);
    return request;
  });
  return { ...created, duplicate: false };
}

/**
 * Whether a guest order has actually been paid for.
 *
 * An order is settled through a Bill, so its own `paymentStatus` column only
 * speaks for orders that never reached one. Once linked, the bill is the
 * authority — and a deleted or voided bill means nothing was collected, not
 * that the meal was free. Shared by the order tracker and the table bill below
 * because two copies of this rule would eventually disagree about money.
 */
function resolveOrderPaymentStatus(order, linkedBill) {
  if (!order.billId) return order.paymentStatus;
  if (!linkedBill || linkedBill.deletedAt || linkedBill.status !== "active") return "unpaid";
  if (Number(linkedBill.creditAmount) > 0) return Number(linkedBill.paidAmount) > 0 ? "partially_paid" : "unpaid";
  return "paid";
}

/**
 * What a table owes right now, across every round it has ordered.
 *
 * A dine-in table orders more than once and settles once. Each round is its own
 * CustomerOrder, so anything reading a single order back — which is all the
 * public API could do until now — shows the guest one round and lets them
 * believe that is the bill. They are then handed a larger number at the
 * counter, which is an argument the restaurant cannot win and did not cause.
 *
 * Rounds that were cancelled or rejected are left off: nobody cooked that food.
 * So are rounds already paid for, because a table turns over several times an
 * evening and the next party must not inherit the last one's bill.
 *
 * Read-only, and keyed on the table id the QR sticker already carries — the
 * same credential the waiter and bill requests on this router accept.
 */
export async function getPublicTableBill(shopId, tableId) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This restaurant is not available.", 404);
  }
  // Deliberately not filtered on selfOrderEnabled: an owner switching QR
  // ordering off mid-service must not also hide the bill for food already eaten.
  const table = await db.restaurantTable.findFirst({
    where: { id: String(tableId ?? ""), shopId, active: true, deletedAt: null },
    select: { id: true, code: true, name: true },
  });
  if (!table) throw new AppError("We couldn't find that table.", 404);

  const rounds = await db.customerOrder.findMany({
    where: { shopId, tableId: table.id, status: { notIn: ["cancelled", "rejected"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, billId: true, status: true, paymentStatus: true, itemsJson: true, estimatedTotal: true, createdAt: true, updatedAt: true },
  });

  // One query for every linked bill rather than one per round: a long table
  // session is a dozen rounds, and this is read on every bill request.
  const billIds = [...new Set(rounds.map((round) => round.billId).filter(Boolean))];
  const linked = billIds.length > 0
    ? await db.bill.findMany({ where: { shopId, id: { in: billIds } }, select: { id: true, status: true, deletedAt: true, paidAmount: true, creditAmount: true } })
    : [];
  const billById = new Map(linked.map((bill) => [bill.id, bill]));

  const open = rounds.filter((round) => resolveOrderPaymentStatus(round, billById.get(round.billId)) !== "paid");
  const items = open.flatMap((round) => parseOrderLines(round));

  return {
    tableId: table.id,
    tableCode: table.code,
    tableName: table.name,
    orderIds: open.map((round) => round.id),
    items,
    itemCount: items.reduce((sum, line) => sum + (Number(line.qty) || 0), 0),
    estimatedTotal: open.reduce((sum, round) => sum + Number(round.estimatedTotal ?? 0), 0),
    // Nothing outstanding is a real answer, not a 404: the table has settled.
    settled: open.length === 0,
    openedAt: open[0]?.createdAt ?? null,
    updatedAt: open.reduce((latest, round) => (latest === null || round.updatedAt > latest ? round.updatedAt : latest), null),
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

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new AppError("Add at least one item to your order.", 400);
  if (rawItems.length > MAX_ORDER_LINES) throw new AppError("Too many items in one order.", 400);
  const maxItemQuantity = Number(storefrontOrder?.maxItemQuantity ?? 0);
  if (Number.isFinite(maxItemQuantity) && maxItemQuantity > 0 && rawItems.some((item) => {
    const quantity = Number(item?.qty ?? item?.quantity ?? 0);
    return !Number.isFinite(quantity) || quantity > maxItemQuantity;
  })) {
    throw new AppError(`Choose no more than ${maxItemQuantity} of one item per order.`, 400, "ORDER_QUANTITY_LIMIT");
  }

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
    // The trade that owns this storefront already decided what is orderable —
    // for a kitchen, the 86 list and the recipe's ingredients. The shelf
    // storefront withholds nothing on stock; see the note at the top of the file.
    if (orderableIds && !orderableIds.has(productId)) continue;
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
