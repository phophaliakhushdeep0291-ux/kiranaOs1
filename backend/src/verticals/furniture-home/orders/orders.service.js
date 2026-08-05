import db from "../../../db.js";
import { AppError } from "../../../middleware/error.js";
import { round2 } from "../../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";

/**
 * Furniture sales orders.
 *
 * Every other trade in the app sells across a counter: money and goods change
 * hands in one moment, and a bill records it. A furniture showroom quotes on
 * Monday, takes a third as an advance, has the piece made over three weeks,
 * delivers it and installs it a month later. For that whole stretch the money
 * and the goods are in different places, and there is nothing in a bill that can
 * say so.
 *
 * An order is therefore NOT a bill. It settles nothing and carries no tax
 * treatment; when the wardrobe finally goes out the shop rings an ordinary bill
 * and links it here by `billId`. What this holds is the promise — what was
 * agreed, what has been paid against it, and when it was said to arrive.
 */

/** Statuses where the shop still owes the customer something. */
export const OPEN_STATUSES = ["quote", "confirmed", "in_production", "ready"];

/**
 * Statuses that hold a piece off the showroom floor.
 *
 * A quote holds nothing — nobody has committed — and once delivered the piece
 * has physically gone. In between it is spoken for, and selling it to a second
 * customer is the mistake this exists to prevent.
 */
export const RESERVING_STATUSES = ["confirmed", "in_production", "ready"];

/**
 * What may follow what.
 *
 * Written out rather than inferred from an ordering, because the path is not a
 * straight line: a piece sold off the floor skips production entirely, and a
 * showroom that does not install stops at delivered. Any open order may be
 * cancelled; nothing may leave a terminal state.
 */
const TRANSITIONS = {
  quote: ["confirmed", "cancelled"],
  confirmed: ["in_production", "ready", "cancelled"],
  in_production: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: ["installed"],
  installed: [],
  cancelled: [],
};

const STATUS_LABELS = {
  quote: "Quotation",
  confirmed: "Confirmed",
  in_production: "Being made",
  ready: "Ready to deliver",
  delivered: "Delivered",
  installed: "Installed",
  cancelled: "Cancelled",
};

export function todayKey() {
  return formatDateInTimeZone(new Date());
}

function dayBounds(day, field) {
  try {
    return dateRangeForDateOnly(String(day).slice(0, 10));
  } catch {
    throw new AppError(`${field} must be a valid date (YYYY-MM-DD)`, 400);
  }
}

function trimOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function daysBetween(fromKey, toKey) {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * What the order comes to.
 *
 * Computed here rather than trusted from the client, because this is the figure
 * a customer will be billed on weeks later and an advance is taken against.
 */
export function totalsFor({ items = [], discount = 0, deliveryCharge = 0, installCharge = 0 } = {}) {
  const itemsTotal = round2(items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
  const grandTotal = round2(
    Math.max(0, itemsTotal - (Number(discount) || 0) + (Number(deliveryCharge) || 0) + (Number(installCharge) || 0)),
  );
  return { itemsTotal, grandTotal };
}

/**
 * The order as every caller reads it: stored columns plus the questions a
 * showroom actually asks — how much is still owed, is it late, what happens next.
 *
 * Exported so those derivations can be tested without a database, and so no
 * screen re-derives "is this overdue?" and gets it subtly wrong.
 */
export function serializeOrder(order) {
  if (!order) return order;

  const paidTotal = round2((order.payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
  const grandTotal = Number(order.grandTotal) || 0;
  const isOpen = OPEN_STATUSES.includes(order.status);
  const promisedKey = order.promisedOn ? formatDateInTimeZone(order.promisedOn) : null;
  const today = todayKey();
  const daysToPromised = promisedKey ? daysBetween(today, promisedKey) : null;

  return {
    ...order,
    quotedOnKey: order.quotedOn ? formatDateInTimeZone(order.quotedOn) : null,
    promisedOnKey: promisedKey,
    deliveredAtKey: order.deliveredAt ? formatDateInTimeZone(order.deliveredAt) : null,
    installedAtKey: order.installedAt ? formatDateInTimeZone(order.installedAt) : null,
    statusLabel: STATUS_LABELS[order.status] ?? order.status,

    paidTotal,
    balanceDue: round2(Math.max(0, grandTotal - paidTotal)),
    // Taking more than the order is worth is a refund waiting to happen, so it
    // is surfaced rather than silently clamped away by balanceDue.
    isOverpaid: paidTotal > grandTotal + 0.009,
    advancePercent: grandTotal > 0 ? Math.round((paidTotal / grandTotal) * 100) : 0,

    isOpen,
    /** Promised for a day that has passed, and still not out of the door. */
    isOverdue: isOpen && daysToPromised !== null && daysToPromised < 0,
    /** Promised today or tomorrow — what the delivery van is loaded from. */
    isDueSoon: isOpen && daysToPromised !== null && daysToPromised >= 0 && daysToPromised <= 1,
    daysToPromised,

    nextStatuses: TRANSITIONS[order.status] ?? [],
    canCancel: isOpen,
    /** Nothing left to collect — the piece can go out without a word about money. */
    isPaidUp: grandTotal > 0 && paidTotal >= grandTotal - 0.009,
  };
}

/**
 * Per-shop order number. Derived from the highest existing number rather than a
 * row count so a deleted order can never hand its number to a new one; the
 * unique index is the real guard and the caller retries on collision.
 */
export async function nextOrderNumber(client, shopId) {
  const last = await client.furnitureOrder.findFirst({
    where: { shopId },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  const previous = Number(String(last?.orderNumber ?? "").replace(/\D/g, "")) || 0;
  return `SO-${String(previous + 1).padStart(6, "0")}`;
}

function normalizeItems(items) {
  return items.map((item) => {
    const qty = Number(item.qty) || 0;
    const rate = round2(Number(item.rate) || 0);
    return {
      productId: item.productId ? String(item.productId) : null,
      name: String(item.name).trim(),
      variant: trimOrNull(item.variant),
      qty,
      rate,
      // Recomputed rather than trusted: the line total is what the order total is
      // built from, and a client that disagrees would quietly change the price.
      amount: round2(qty * rate),
      // Nothing on the floor to hold for a piece that does not exist yet.
      reserveStock: item.productId ? item.reserveStock !== false : false,
      notes: trimOrNull(item.notes),
    };
  });
}

/**
 * How much of each product is promised to someone.
 *
 * The showroom question this answers: three sofas on the floor, two already sold
 * to people waiting for delivery — so only one is actually for sale. Returns
 * Map<productId, qty>.
 */
export async function getReservations(shopId, { excludeOrderId = null } = {}) {
  const orders = await db.furnitureOrder.findMany({
    where: {
      shopId,
      deletedAt: null,
      status: { in: RESERVING_STATUSES },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: { items: { select: { productId: true, qty: true, reserveStock: true } } },
  });

  const held = new Map();
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.productId || !item.reserveStock) continue;
      held.set(item.productId, round2((held.get(item.productId) ?? 0) + (Number(item.qty) || 0)));
    }
  }
  return held;
}

export async function listOrders(shopId, { status, search, from, to, overdueOnly = false, includeDeleted = false } = {}) {
  const where = {
    shopId,
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search } },
            { customerPhone: { contains: normalizePhone(search) || search } },
            { orderNumber: { contains: search } },
            { billNumber: { contains: search } },
          ],
        }
      : {}),
  };

  // "open" is the question a showroom asks — what do we still owe anyone — and
  // spans four statuses, so it is offered alongside the literal ones.
  if (status === "open") where.status = { in: OPEN_STATUSES };
  else if (status && status !== "all") where.status = status;

  if (from || to) {
    const start = dayBounds(from || to, "from").start;
    const end = dayBounds(to || from, "to").end;
    if (end < start) throw new AppError("The end date cannot be before the start date", 400);
    where.quotedOn = { gte: start, lte: end };
  }

  const rows = await db.furnitureOrder.findMany({
    where,
    orderBy: [{ quotedOn: "desc" }, { createdAt: "desc" }],
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
    take: 500,
  });

  const orders = rows.map(serializeOrder);
  return overdueOnly ? orders.filter((order) => order.isOverdue) : orders;
}

export async function getOrder(shopId, id) {
  const order = await db.furnitureOrder.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
  });
  if (!order) throw new AppError("Order not found", 404);
  return serializeOrder(order);
}

export async function createOrder(shopId, data, { userId = null } = {}) {
  const items = normalizeItems(data.items ?? []);
  const { itemsTotal, grandTotal } = totalsFor({ ...data, items });

  const create = async () =>
    db.furnitureOrder.create({
      data: {
        shopId,
        orderNumber: await nextOrderNumber(db, shopId),
        customerId: data.customerId || null,
        customerName: String(data.customerName).trim(),
        customerPhone: normalizePhone(data.customerPhone),
        deliveryAddress: String(data.deliveryAddress ?? "").trim(),
        status: data.status || "quote",
        itemsTotal,
        discount: round2(Number(data.discount) || 0),
        deliveryCharge: round2(Number(data.deliveryCharge) || 0),
        installCharge: round2(Number(data.installCharge) || 0),
        grandTotal,
        quotedOn: data.quotedOn ? dayBounds(data.quotedOn, "quotedOn").start : new Date(),
        promisedOn: data.promisedOn ? dayBounds(data.promisedOn, "promisedOn").start : null,
        isCustom: Boolean(data.isCustom),
        notes: trimOrNull(data.notes),
        createdByUserId: userId,
        items: { create: items },
      },
      include: { items: true, payments: true },
    });

  // Two counters quoting at the same instant can pick the same number; the
  // unique index catches it and the retry takes the next one.
  try {
    return serializeOrder(await create());
  } catch (err) {
    if (err?.code === "P2002") return serializeOrder(await create());
    throw err;
  }
}

export async function updateOrder(shopId, id, data) {
  const existing = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true } });
  if (!existing) throw new AppError("Order not found", 404);
  if (!OPEN_STATUSES.includes(existing.status)) {
    throw new AppError(
      `A ${STATUS_LABELS[existing.status]?.toLowerCase() ?? existing.status} order can no longer be edited`,
      409,
      "ORDER_CLOSED",
    );
  }

  const items = data.items ? normalizeItems(data.items) : existing.items;
  const { itemsTotal, grandTotal } = totalsFor({
    items,
    discount: data.discount ?? existing.discount,
    deliveryCharge: data.deliveryCharge ?? existing.deliveryCharge,
    installCharge: data.installCharge ?? existing.installCharge,
  });

  const updated = await db.furnitureOrder.update({
    where: { id: existing.id },
    data: {
      ...(data.customerId !== undefined ? { customerId: data.customerId || null } : {}),
      ...(data.customerName !== undefined ? { customerName: String(data.customerName).trim() } : {}),
      ...(data.customerPhone !== undefined ? { customerPhone: normalizePhone(data.customerPhone) } : {}),
      ...(data.deliveryAddress !== undefined ? { deliveryAddress: String(data.deliveryAddress ?? "").trim() } : {}),
      ...(data.discount !== undefined ? { discount: round2(Number(data.discount) || 0) } : {}),
      ...(data.deliveryCharge !== undefined ? { deliveryCharge: round2(Number(data.deliveryCharge) || 0) } : {}),
      ...(data.installCharge !== undefined ? { installCharge: round2(Number(data.installCharge) || 0) } : {}),
      ...(data.promisedOn !== undefined
        ? { promisedOn: data.promisedOn ? dayBounds(data.promisedOn, "promisedOn").start : null }
        : {}),
      ...(data.isCustom !== undefined ? { isCustom: Boolean(data.isCustom) } : {}),
      ...(data.notes !== undefined ? { notes: trimOrNull(data.notes) } : {}),
      ...(data.items ? { items: { deleteMany: {}, create: items } } : {}),
      itemsTotal,
      grandTotal,
    },
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
  });
  return serializeOrder(updated);
}

/**
 * Moves the order along.
 *
 * Only the transitions in TRANSITIONS are allowed, so an order cannot be
 * delivered before it is ready or reopened after it is installed. Delivery and
 * installation stamp their own dates, because "when did this actually go out?"
 * is the question a customer disputes months later.
 */
export async function setOrderStatus(shopId, id, status, { billId = null, billNumber = null, note } = {}) {
  const order = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { payments: true } });
  if (!order) throw new AppError("Order not found", 404);

  const allowed = TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(status)) {
    throw new AppError(
      allowed.length === 0
        ? `A ${STATUS_LABELS[order.status]?.toLowerCase() ?? order.status} order cannot be changed any further`
        : `A ${STATUS_LABELS[order.status]?.toLowerCase() ?? order.status} order can only move to ${allowed.map((s) => STATUS_LABELS[s]?.toLowerCase() ?? s).join(" or ")}`,
      409,
      "ORDER_BAD_TRANSITION",
    );
  }

  const updated = await db.furnitureOrder.update({
    where: { id: order.id },
    data: {
      status,
      ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
      ...(status === "installed" ? { installedAt: new Date() } : {}),
      ...(billId ? { billId } : {}),
      ...(billNumber ? { billNumber: String(billNumber).trim() } : {}),
      ...(note ? { notes: [order.notes, String(note).trim()].filter(Boolean).join("\n") } : {}),
    },
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
  });
  return serializeOrder(updated);
}

export async function cancelOrder(shopId, id, { reason } = {}) {
  return setOrderStatus(shopId, id, "cancelled", {
    note: reason ? `Cancelled: ${String(reason).trim()}` : "Cancelled",
  });
}

/**
 * Records an advance.
 *
 * Refused on a cancelled order — money taken against something the shop is no
 * longer making is a refund, not an advance, and recording it here would hide
 * that. Allowed on a delivered order, because the balance is very often
 * collected on the doorstep.
 */
export async function addPayment(shopId, id, data, { userId = null } = {}) {
  const order = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!order) throw new AppError("Order not found", 404);
  if (order.status === "cancelled") {
    throw new AppError("A cancelled order cannot take a payment", 409, "ORDER_CANCELLED");
  }

  await db.furnitureOrderPayment.create({
    data: {
      orderId: order.id,
      amount: round2(Number(data.amount) || 0),
      mode: data.mode || "cash",
      paidOn: data.paidOn ? dayBounds(data.paidOn, "paidOn").start : new Date(),
      reference: trimOrNull(data.reference),
      notes: trimOrNull(data.notes),
      createdByUserId: userId,
    },
  });
  return getOrder(shopId, id);
}

export async function removePayment(shopId, id, paymentId) {
  const order = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!order) throw new AppError("Order not found", 404);

  const payment = await db.furnitureOrderPayment.findFirst({ where: { id: paymentId, orderId: order.id } });
  if (!payment) throw new AppError("Payment not found on this order", 404);

  await db.furnitureOrderPayment.delete({ where: { id: payment.id } });
  return getOrder(shopId, id);
}

export async function softDeleteOrder(shopId, id) {
  const order = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!order) throw new AppError("Order not found", 404);
  const deleted = await db.furnitureOrder.update({
    where: { id: order.id },
    data: { deletedAt: new Date() },
    include: { items: true, payments: true },
  });
  return serializeOrder(deleted);
}

export async function restoreOrder(shopId, id) {
  const order = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!order) throw new AppError("Deleted order not found in recycle bin", 404);
  const restored = await db.furnitureOrder.update({
    where: { id: order.id },
    data: { deletedAt: null },
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
  });
  return serializeOrder(restored);
}

/** Every order a product is promised on — "who is waiting for this sofa?" */
export async function getOrdersForProduct(shopId, productId) {
  const rows = await db.furnitureOrder.findMany({
    where: { shopId, deletedAt: null, status: { in: RESERVING_STATUSES }, items: { some: { productId } } },
    include: { items: true, payments: true },
    orderBy: { promisedOn: "asc" },
    take: 100,
  });
  return rows.map(serializeOrder);
}

/** Counter-side headline numbers: what is owed, what is late, what is on the floor for someone else. */
export async function getOrderSummary(shopId) {
  const orders = await listOrders(shopId, {});
  const open = orders.filter((order) => order.isOpen);
  const reservations = await getReservations(shopId);

  return {
    today: todayKey(),
    openOrders: open.length,
    quotes: orders.filter((order) => order.status === "quote").length,
    inProduction: orders.filter((order) => order.status === "in_production").length,
    readyToDeliver: orders.filter((order) => order.status === "ready").length,
    overdue: open.filter((order) => order.isOverdue).length,
    dueSoon: open.filter((order) => order.isDueSoon).length,
    /** Money taken against work not yet delivered — the shop is holding it, not earning it. */
    advancesHeld: round2(open.reduce((sum, order) => sum + order.paidTotal, 0)),
    /** Still to collect across every open order. */
    pendingCollection: round2(open.reduce((sum, order) => sum + order.balanceDue, 0)),
    orderBookValue: round2(open.reduce((sum, order) => sum + (Number(order.grandTotal) || 0), 0)),
    reservedProducts: reservations.size,
  };
}
