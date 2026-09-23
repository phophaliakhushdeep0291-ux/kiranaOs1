import { createHash } from "node:crypto";
import { createAuditLog } from "../../../modules/audit/audit.service.js";
import { requireDeliveryBill } from "./order-delivery.js";
import { applyFurnitureReceiptsToBill, postFurnitureReceipt, requireFurnitureAccounting } from "./order-finance.js";
import db from "../../../db.js";
import { isWriteConflict, serializableTransaction } from "../../../lib/transactions.js";
import { AppError } from "../../../middleware/error.js";
import { round2, toPaise } from "../../../utils/money.js";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../../../utils/dates.js";
import { getLocationQuantitiesByProduct, resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";

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
 * treatment; when the wardrobe finally goes out, invoice creation, advance
 * application and delivery can commit together through order-invoice.js.
 * A matching existing sale can also be linked by `billId`. This holds what was
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

function orderLocationWhere(locationId, includeLegacy = true) {
  return locationId ? { AND: [{ OR: [{ locationId }, ...(includeLegacy ? [{ locationId: null }] : [])] }] } : {};
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

  const paidTotal = round2((order.payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0) + (order.creditCollected ?? 0));
  const grandTotal = Number(order.grandTotal) || 0;
  const isOpen = OPEN_STATUSES.includes(order.status);
  const promisedKey = order.promisedOn ? formatDateInTimeZone(order.promisedOn) : null;
  const today = todayKey();
  const daysToPromised = promisedKey ? daysBetween(today, promisedKey) : null;

  return {
    ...order,
    payments: (order.payments ?? []).map((payment) => ({ ...payment,
      refundableAmount: payment.amount > 0 ? round2(payment.amount + (order.payments ?? [])
        .filter((adjustment) => adjustment.reversesPaymentId === payment.id).reduce((sum, adjustment) => sum + adjustment.amount, 0)) : 0,
    })),
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
    canCancel: isOpen && paidTotal === 0 && !order.billId,
    canDelete: !order.billId && !(order.payments ?? []).length && !["delivered", "installed"].includes(order.status),
    canReceivePayment: isOpen && !order.billId && paidTotal < grandTotal,
    needsDeliveryReview: ["delivered", "installed"].includes(order.status) && !order.billId,
    /** Nothing left to collect — the piece can go out without a word about money. */
    isPaidUp: grandTotal > 0 && paidTotal >= grandTotal - 0.009,
  };
}

// A customer's general khata payment belongs to an order only after an
// explicit allocation. Never infer it from a customer-wide balance or name.
async function ordersWithCollections(orders, client = db) {
  if (!orders.length) return [];
  const ids = orders.map((order) => order.billId).filter(Boolean);
  if (!ids.length) return orders.map(serializeOrder);
  const shopId = orders[0].shopId;
  const [bills, collections, returns] = await Promise.all([
    client.bill.findMany({ where: { shopId, id: { in: ids } }, select: { id: true, status: true, deletedAt: true, creditAmount: true } }),
    client.udharLedger.groupBy({ by: ["billId"], where: { shopId, billId: { in: ids }, type: "payment", reversedAt: null }, _sum: { amount: true } }),
    client.bill.findMany({ where: { shopId, returnOfBillId: { in: ids }, status: "active", deletedAt: null }, select: { returnOfBillId: true } }),
  ]);
  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const collected = new Map(collections.map((row) => [row.billId, round2(row._sum.amount ?? 0)]));
  const returned = new Set(returns.map((row) => row.returnOfBillId));
  return orders.map((order) => {
    const bill = billById.get(order.billId);
    return serializeOrder({ ...order, creditCollected: collected.get(order.billId) ?? 0,
      needsInvoiceReview: Boolean(order.billId && (!bill || bill.status !== "active" || bill.deletedAt || returned.has(order.billId))),
    });
  });
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
export async function getReservations(shopId, { excludeOrderId = null, locationId = null, includeLegacy = true } = {}, client = db) {
  const orders = await client.furnitureOrder.findMany({
    where: {
      shopId,
      ...orderLocationWhere(locationId, includeLegacy),
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

async function withOrderTransaction(operation) {
  try {
    return await serializableTransaction(operation);
  } catch (error) {
    if (!isWriteConflict(error)) throw error;
    throw new AppError("Stock changed while saving. Check the order and try again.", 409, "ORDER_STOCK_CHANGED");
  }
}

export async function assertOrderStock(client, shopId, items, status, excludeOrderId = null, locationId = null) {
  const ids = [...new Set(items.map((item) => item.productId).filter(Boolean))];
  if (!ids.length) return;
  const products = await client.product.findMany({
    where: { id: { in: ids }, shopId, deletedAt: null },
    select: { id: true, name: true, stockBaseQty: true },
  });
  if (products.length !== ids.length) throw new AppError("One of the items is no longer in your catalogue", 404, "ORDER_ITEM_MISSING");
  if (!RESERVING_STATUSES.includes(status)) return;
  const location = await resolveOperationalLocation(shopId, locationId, client);
  const quantities = await getLocationQuantitiesByProduct(client, shopId, location, products);
  const held = await getReservations(shopId, { excludeOrderId, locationId: location.id, includeLegacy: location.isPrimary }, client);
  const wanted = new Map();
  for (const item of items) {
    if (item.productId && item.reserveStock) wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + Number(item.qty));
  }
  for (const product of products) {
    const available = Math.max(0, Number(quantities.get(product.id) ?? 0) - (held.get(product.id) ?? 0));
    if ((wanted.get(product.id) ?? 0) > available) {
      throw new AppError(`"${product.name}" has only ${round2(available)} available for this order. Check its stock and other reserved orders.`, 409, "ORDER_NOT_AVAILABLE");
    }
  }
}

export async function listOrders(shopId, { status, search, from, to, overdueOnly = false, includeDeleted = false, locationId = null, includeLegacy = true } = {}) {
  const where = {
    shopId,
    ...orderLocationWhere(locationId, includeLegacy),
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search } },
            { customerPhone: { contains: normalizePhone(search) || search } },
            { orderNumber: { contains: search } },
            { billNumber: { contains: search } },
            { items: { some: { name: { contains: search } } } },
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
  });

  const orders = await ordersWithCollections(rows);
  return overdueOnly ? orders.filter((order) => order.isOverdue) : orders;
}

export async function getOrder(shopId, id) {
  const order = await db.furnitureOrder.findFirst({
    where: { id, shopId, deletedAt: null },
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
  });
  if (!order) throw new AppError("Order not found", 404);
  return (await ordersWithCollections([order]))[0];
}

async function collectionContext(tx, shopId, id) {
  const order = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true, payments: true } });
  if (!order?.billId || !["delivered", "installed"].includes(order.status)) throw new AppError("Link the delivery bill before reconciling credit collections", 409, "ORDER_BILL_REQUIRED");
  const bill = await tx.bill.findFirst({ where: { id: order.billId, shopId, status: "active", deletedAt: null } });
  if (!bill?.customerId || await tx.bill.findFirst({ where: { shopId, returnOfBillId: order.billId, status: "active", deletedAt: null } })) throw new AppError("Review the linked sale and returns before allocating credit payments", 409, "ORDER_PAYMENT_REVIEW");
  return { order, bill };
}

export async function listCollections(shopId, id) {
  const { order, bill } = await collectionContext(db, shopId, id);
  const rows = await db.udharLedger.findMany({ where: { shopId, customerId: bill.customerId, type: "payment", reversedAt: null,
    locationId: bill.locationId, OR: [{ billId: null }, { billId: bill.id }],
  }, orderBy: [{ businessDate: "desc" }, { id: "desc" }] });
  return { order: (await ordersWithCollections([order]))[0], payments: rows.map((row) => ({
    id: row.id, amount: row.amount, mode: row.mode, businessDate: row.businessDate, linked: row.billId === bill.id,
  })) };
}

export async function linkCollection(shopId, id, ledgerId, data, context = {}) {
  return withOrderTransaction(async (tx) => {
    const { order, bill } = await collectionContext(tx, shopId, id);
    const payment = await tx.udharLedger.findFirst({ where: { id: ledgerId, shopId, customerId: bill.customerId, locationId: bill.locationId, type: "payment", reversedAt: null } });
    if (!payment) throw new AppError("Received payment not found for this customer and branch", 404);
    if (payment.billId === bill.id) return (await ordersWithCollections([order], tx))[0];
    if (payment.billId) throw new AppError("This collection is already allocated to another bill", 409, "ORDER_COLLECTION_ALLOCATED");
    const current = (await ordersWithCollections([order], tx))[0];
    if (toPaise(current.paidTotal) !== toPaise(data.expectedPaidTotal)) throw new AppError("The order balance changed. Refresh before linking this collection", 409, "ORDER_PAYMENT_CHANGED");
    if (toPaise(payment.amount) <= 0 || toPaise(payment.amount) > toPaise(current.balanceDue)
      || toPaise((current.creditCollected ?? 0) + payment.amount) > toPaise(bill.creditAmount)) {
      throw new AppError("This receipt exceeds the bill's remaining credit. Reconcile a receipt for the exact amount first.", 409, "ORDER_COLLECTION_EXCEEDS_BALANCE");
    }
    await tx.udharLedger.update({ where: { id: payment.id }, data: { billId: bill.id, billNo: bill.billNo } });
    await requiredOrderAudit(tx, order, "FURNITURE_ORDER_COLLECTION_LINKED", context,
      { ledgerId, billId: bill.id, amount: payment.amount, reason: data.reason });
    return (await ordersWithCollections([order], tx))[0];
  });
}

export async function listOrderPayments(shopId, { from, to, locationId = null, includeLegacy = true } = {}) {
  const start = from ? dayBounds(from, "from").start : undefined;
  const end = to ? dayBounds(to, "to").end : undefined;
  if (start && end && end < start) throw new AppError("The end date cannot precede the start date", 400);
  const orders = await db.furnitureOrder.findMany({ where: { shopId, ...orderLocationWhere(locationId, includeLegacy) },
    select: { id: true, orderNumber: true, customerName: true, customerPhone: true } });
  if (!orders.length) return [];
  const byId = new Map(orders.map((order) => [order.id, order]));
  const rows = await db.financialLedger.findMany({ where: { shopId, sourceType: "furniture_order", sourceId: { in: [...byId.keys()] },
    entryType: { in: ["furniture_cash", "furniture_upi", "furniture_bank", "furniture_other"] },
    businessDate: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) },
  }, orderBy: [{ businessDate: "asc" }, { id: "asc" }] });
  return rows.map((row) => { const evidence = JSON.parse(row.evidenceJson); return {
    ...byId.get(row.sourceId), id: row.id, orderId: row.sourceId, amount: Number(row.amountPaise) / 100,
    paymentMode: row.paymentMode, businessDate: row.businessDate, event: evidence.event,
    reference: evidence.reason ?? evidence.reference ?? evidence.billNumber ?? null,
  }; });
}

export async function createOrder(shopId, data, { userId = null, locationId = null } = {}) {
  locationId = (await resolveOperationalLocation(shopId, locationId)).id;
  const items = normalizeItems(data.items ?? []);
  const { itemsTotal, grandTotal } = totalsFor({ ...data, items });

  const create = () => withOrderTransaction(async (tx) => {
    await assertOrderStock(tx, shopId, items, data.status || "quote", null, locationId);
    return tx.furnitureOrder.create({
      data: {
        shopId,
        locationId,
        orderNumber: await nextOrderNumber(tx, shopId),
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
  return withOrderTransaction(async (tx) => {
  const existing = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true, payments: true } });
  if (!existing) throw new AppError("Order not found", 404);
  if (!OPEN_STATUSES.includes(existing.status)) {
    throw new AppError(
      `A ${STATUS_LABELS[existing.status]?.toLowerCase() ?? existing.status} order can no longer be edited`,
      409,
      "ORDER_CLOSED",
    );
  }

  const items = data.items ? normalizeItems(data.items) : existing.items;
  await assertOrderStock(tx, shopId, items, existing.status, id, existing.locationId);
  const { itemsTotal, grandTotal } = totalsFor({
    items,
    discount: data.discount ?? existing.discount,
    deliveryCharge: data.deliveryCharge ?? existing.deliveryCharge,
    installCharge: data.installCharge ?? existing.installCharge,
  });

  const paid = serializeOrder(existing).paidTotal;
  if (toPaise(grandTotal) < toPaise(paid)) throw new AppError("The order cannot be reduced below the money already received. Reconcile the payment first.", 409, "ORDER_PAYMENT_REVIEW");
  if (paid > 0 && ["customerId", "customerName", "customerPhone"].some((key) => data[key] !== undefined && String(data[key] ?? "") !== String(existing[key] ?? ""))) {
    throw new AppError("An order with received payments cannot be moved to a different customer.", 409, "ORDER_PAYMENT_REVIEW");
  }
  const updated = await tx.furnitureOrder.update({
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
  });
}

/**
 * Moves the order along.
 *
 * Only the transitions in TRANSITIONS are allowed, so an order cannot be
 * delivered before it is ready or reopened after it is installed. Delivery and
 * installation stamp their own dates, because "when did this actually go out?"
 * is the question a customer disputes months later.
 */
export async function requiredOrderAudit(tx, order, action, context = {}, metadata = {}) {
  const audit = await createAuditLog({ client: tx, shopId: order.shopId, userId: context.userId ?? null, req: context.req ?? null,
    module: "orders", action, entityType: "FurnitureOrder", entityId: order.id,
    after: { status: order.status, billId: order.billId, grandTotal: order.grandTotal }, metadata });
  if (!audit) throw new AppError("The order was not changed because its audit could not be saved", 503, "ORDER_AUDIT_FAILED");
}

export async function setOrderStatus(shopId, id, status, { billId = null, billNumber = null, note, ...context } = {}) {
  return withOrderTransaction((tx) => setOrderStatusInTransaction(tx, shopId, id, status, { billId, billNumber, note, ...context }));
}

// Reused by invoice creation so the bill, stock, advance application and delivery
// are one commit. HTTP callers cannot supply this transaction client.
export async function setOrderStatusInTransaction(tx, shopId, id, status, { billId = null, billNumber = null, note, ...context } = {}) {
    const order = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { payments: true, items: true } });
    if (!order) throw new AppError("Order not found", 404);
    if (order.status === status) {
      if ((billId && order.billId !== billId) || (billNumber && order.billNumber !== billNumber)) throw new AppError("This order was already completed with different bill details.", 409, "ORDER_BILL_MISMATCH");
      return (await ordersWithCollections([order], tx))[0];
    }
    const allowed = TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(status)) throw new AppError("This order cannot move to that status.", 409, "ORDER_BAD_TRANSITION");
    if (status === "cancelled" && (toPaise(serializeOrder(order).paidTotal) !== 0 || order.billId)) {
      throw new AppError("This order has received payments or a linked sale. Reconcile its refund or sale before cancellation; cancellation does not return money.", 409, "ORDER_PAYMENT_REVIEW");
    }
    if (status === "confirmed") await assertOrderStock(tx, shopId, order.items, status, id, order.locationId);
    let bill = null;
    if (["delivered", "installed"].includes(status)) bill = await requireDeliveryBill(tx, order, { billId, billNumber });
    else if (billId || billNumber) throw new AppError("Link the sale bill when confirming delivery.", 409, "ORDER_BILL_TRANSITION");
    if (status === "delivered") await applyFurnitureReceiptsToBill(tx, order, bill);
    const updated = await tx.furnitureOrder.update({
      where: { id: order.id },
      data: { status,
        ...(status === "delivered" ? { deliveredAt: new Date() } : {}),
        ...(status === "installed" ? { installedAt: new Date() } : {}),
        ...(bill ? { billId: bill.id, billNumber: bill.billNo } : {}),
        ...(note ? { notes: [order.notes, String(note).trim()].filter(Boolean).join("\n") } : {}),
      }, include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
    });
    await requiredOrderAudit(tx, updated, status === "cancelled" ? "FURNITURE_ORDER_CANCELLED" : "FURNITURE_ORDER_STATUS_CHANGED", context, { previousStatus: order.status, note });
    return (await ordersWithCollections([updated], tx))[0];
}

export async function cancelOrder(shopId, id, { reason, ...context } = {}) {
  return setOrderStatus(shopId, id, "cancelled", { ...context, note: reason ? `Cancelled: ${String(reason).trim()}` : "Cancelled" });
}

// A receipt identity survives a lost response. Its contents cannot be changed
// on retry; the receipt, balance decision and mandatory audit commit together.
export async function addPayment(shopId, id, data, context = {}) {
  if (!String(data.clientRequestId ?? "").trim()) throw new AppError("Reload the payment form before saving this receipt.", 400, "ORDER_PAYMENT_ID_REQUIRED");
  const paymentId = `fop_${createHash("sha256").update(`${shopId}:${id}:${data.clientRequestId}`).digest("hex")}`;
  const amount = round2(Number(data.amount));
  const mode = data.mode || "cash";
  if (!Number.isFinite(amount) || toPaise(amount) <= 0 || !["cash", "upi", "bank", "card", "other"].includes(mode)) throw new AppError("Enter a valid payment amount and method", 400);
  const paidOn = data.paidOn ? dayBounds(data.paidOn, "paidOn").start : new Date();
  if (formatDateInTimeZone(paidOn) > todayKey()) throw new AppError("A received payment cannot have a future date", 400);
  return withOrderTransaction(async (tx) => {
    const order = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { payments: true, items: true } });
    if (!order) throw new AppError("Order not found", 404);
    const existing = order.payments.find((p) => p.id === paymentId);
    if (existing) {
      if (toPaise(existing.amount) !== toPaise(amount) || existing.mode !== mode || existing.reference !== trimOrNull(data.reference) || existing.notes !== trimOrNull(data.notes)
        || (data.paidOn && formatDateInTimeZone(existing.paidOn) !== formatDateInTimeZone(paidOn))) throw new AppError("This receipt was already saved with different details.", 409, "ORDER_PAYMENT_REPLAY_MISMATCH");
      return serializeOrder(order);
    }
    if (!OPEN_STATUSES.includes(order.status) || order.billId) throw new AppError("Use the linked sale's payment or refund workflow for a closed order. Reconcile older deliveries without a bill first.", 409, "ORDER_PAYMENT_REVIEW");
    await requireFurnitureAccounting(tx, order);
    const current = serializeOrder(order);
    if (data.expectedPaidTotal !== undefined && toPaise(data.expectedPaidTotal) !== toPaise(current.paidTotal)) throw new AppError("Another payment was recorded. Refresh the order before collecting again.", 409, "ORDER_PAYMENT_CHANGED");
    if (toPaise(amount) > toPaise(current.balanceDue)) throw new AppError("The payment exceeds this order's remaining balance.", 409, "ORDER_PAYMENT_EXCEEDS_BALANCE");
    const payment = await tx.furnitureOrderPayment.create({ data: { id: paymentId, orderId: order.id, amount, mode, paidOn,
      reference: trimOrNull(data.reference), notes: trimOrNull(data.notes), createdByUserId: context.userId ?? null } });
    await postFurnitureReceipt(tx, order, payment);
    await requiredOrderAudit(tx, order, "FURNITURE_ORDER_PAYMENT_ADDED", context, { paymentId, amount, mode, paidOn: paidOn.toISOString() });
    return serializeOrder({ ...order, payments: [...order.payments, payment] });
  });
}

export async function removePayment(shopId, id, paymentId) {
  const order = await db.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!order) throw new AppError("Order not found", 404);
  const payment = await db.furnitureOrderPayment.findFirst({ where: { id: paymentId, orderId: order.id } });
  if (!payment) throw new AppError("Payment not found on this order", 404);
  throw new AppError("Received payments are permanent history. Reconcile a refund or correction instead of deleting the receipt.", 409, "ORDER_PAYMENT_IMMUTABLE");
}

// Refunds and method corrections append new rows. Both require the original
// receipt, a reason, a stable request identity and a current balance snapshot.
export async function adjustPayment(shopId, id, paymentId, data, context = {}) {
  const adjustmentId = `foa_${createHash("sha256").update(`${shopId}:${id}:${data.clientRequestId}`).digest("hex")}`;
  return withOrderTransaction(async (tx) => {
    const order = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { items: true, payments: true } });
    if (!order) throw new AppError("Order not found", 404);
    const original = order.payments.find((payment) => payment.id === paymentId && payment.amount > 0);
    if (!original) throw new AppError("Receipt not found on this order", 404);
    const amount = round2(data.amount);
    const reason = data.reason.trim();
    const reference = trimOrNull(data.reference);
    const saved = order.payments.find((payment) => payment.id === adjustmentId);
    if (saved) {
      const replacement = order.payments.find((payment) => payment.id === `${adjustmentId}_replacement`);
      if (saved.reversesPaymentId !== paymentId || saved.kind !== data.kind || toPaise(saved.amount) !== -toPaise(amount)
        || saved.reason !== reason || (data.kind === "correction" && (replacement?.mode !== data.mode || replacement?.reference !== reference))) {
        throw new AppError("This adjustment was already recorded with different details.", 409, "ORDER_PAYMENT_REPLAY_MISMATCH");
      }
      return serializeOrder(order);
    }
    if (!OPEN_STATUSES.includes(order.status) || order.billId) throw new AppError("Use the linked bill's refund workflow after delivery.", 409, "ORDER_PAYMENT_REVIEW");
    await requireFurnitureAccounting(tx, order);
    const current = serializeOrder(order);
    if (toPaise(current.paidTotal) !== toPaise(data.expectedPaidTotal)) throw new AppError("The order balance changed. Refresh before adjusting this receipt.", 409, "ORDER_PAYMENT_CHANGED");
    const refundable = current.payments.find((payment) => payment.id === paymentId).refundableAmount;
    if (!Number.isFinite(amount) || toPaise(amount) <= 0 || toPaise(amount) > toPaise(refundable)) throw new AppError("The adjustment exceeds the remaining receipt amount.", 409, "ORDER_REFUND_EXCEEDS_RECEIPT");
    if (data.kind === "correction" && toPaise(amount) !== toPaise(refundable)) throw new AppError("Correct the entire remaining receipt amount.", 409, "ORDER_CORRECTION_AMOUNT");
    const paidOn = new Date();
    const adjustment = await tx.furnitureOrderPayment.create({ data: {
      id: adjustmentId, orderId: id, kind: data.kind, reversesPaymentId: paymentId, reason,
      amount: -amount, mode: original.mode, paidOn, reference: original.reference, createdByUserId: context.userId ?? null,
    } });
    await postFurnitureReceipt(tx, order, adjustment);
    const payments = [...order.payments, adjustment];
    if (data.kind === "correction") {
      const replacement = await tx.furnitureOrderPayment.create({ data: {
        id: `${adjustmentId}_replacement`, orderId: id, kind: "receipt", reason,
        amount, mode: data.mode, paidOn, reference, createdByUserId: context.userId ?? null,
      } });
      await postFurnitureReceipt(tx, order, replacement);
      payments.push(replacement);
    }
    await requiredOrderAudit(tx, order, data.kind === "refund" ? "FURNITURE_ORDER_PAYMENT_REFUNDED" : "FURNITURE_ORDER_PAYMENT_CORRECTED", context,
      { originalPaymentId: paymentId, adjustmentId, amount, reason, originalMode: original.mode, replacementMode: data.mode });
    return serializeOrder({ ...order, payments });
  });
}

export async function softDeleteOrder(shopId, id, context = {}) {
  return withOrderTransaction(async (tx) => {
    const order = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: null }, include: { payments: true, items: true } });
    if (!order) throw new AppError("Order not found", 404);
    if (!serializeOrder(order).canDelete) throw new AppError("An order with payment, invoice or delivery history cannot be deleted.", 409, "ORDER_HISTORY_PROTECTED");
    const deleted = await tx.furnitureOrder.update({ where: { id: order.id }, data: { deletedAt: new Date() }, include: { items: true, payments: true } });
    await requiredOrderAudit(tx, deleted, "FURNITURE_ORDER_DELETED", context);
    return serializeOrder(deleted);
  });
}

export async function restoreOrder(shopId, id) {
  return withOrderTransaction(async (tx) => {
  const order = await tx.furnitureOrder.findFirst({ where: { id, shopId, deletedAt: { not: null } }, include: { items: true } });
  if (!order) throw new AppError("Deleted order not found in recycle bin", 404);
  await assertOrderStock(tx, shopId, order.items, order.status, id, order.locationId);
  const restored = await tx.furnitureOrder.update({
    where: { id: order.id },
    data: { deletedAt: null },
    include: { items: true, payments: { orderBy: { paidOn: "asc" } } },
  });
  return serializeOrder(restored);
  });
}

/** Every order a product is promised on — "who is waiting for this sofa?" */
export async function getOrdersForProduct(shopId, productId, { locationId = null, includeLegacy = true } = {}) {
  const rows = await db.furnitureOrder.findMany({
    where: { shopId, ...orderLocationWhere(locationId, includeLegacy), deletedAt: null, status: { in: RESERVING_STATUSES }, items: { some: { productId } } },
    include: { items: true, payments: true },
    orderBy: { promisedOn: "asc" },
  });
  return ordersWithCollections(rows);
}

/** Counter-side headline numbers: what is owed, what is late, what is on the floor for someone else. */
export async function getOrderSummary(shopId, { locationId = null, includeLegacy = true } = {}) {
  const orders = await listOrders(shopId, { locationId, includeLegacy });
  const open = orders.filter((order) => order.isOpen);
  const reservations = await getReservations(shopId, { locationId, includeLegacy });

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
    /** Delivery does not erase an unpaid balance. */
    pendingCollection: round2(orders.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + order.balanceDue, 0)),
    orderBookValue: round2(open.reduce((sum, order) => sum + (Number(order.grandTotal) || 0), 0)),
    reservedProducts: reservations.size,
  };
}
