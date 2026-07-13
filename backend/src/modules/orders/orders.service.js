import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

const ORDER_STATUSES = ["new", "accepted", "ready", "fulfilled", "rejected", "cancelled"];
const ALLOWED_TRANSITIONS = {
  new: new Set(["accepted", "rejected", "cancelled"]),
  accepted: new Set(["ready", "fulfilled", "rejected", "cancelled"]),
  ready: new Set(["fulfilled", "cancelled"]),
  fulfilled: new Set(),
  rejected: new Set(),
  cancelled: new Set(),
};

function parseItems(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shapeOrder(order) {
  const { itemsJson, ...rest } = order;
  return { ...rest, items: parseItems(itemsJson) };
}

/**
 * The owner's "Orders Received" inbox — customer orders submitted from the public QR page.
 * Shop-scoped; newest first; cursor-paginated (the list used to silently truncate at 200).
 * Returns the count of still-new orders for the nav badge and a nextCursor when more exist.
 */
export async function listCustomerOrders(shopId, { status, cursor, limit, locationId } = {}) {
  const where = { shopId, ...(locationId ? { locationId } : {}) };
  if (status && status !== "all") where.status = status;
  const take = Math.min(Math.max(Number(limit) || 200, 1), 200);

  const [rows, newCount] = await Promise.all([
    db.customerOrder.findMany({
      where,
      // id is the tiebreaker so the cursor is stable across equal createdAt values.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: String(cursor) }, skip: 1 } : {}),
    }),
    db.customerOrder.count({ where: { shopId, ...(locationId ? { locationId } : {}), status: "new" } }),
  ]);

  const hasMore = rows.length > take;
  const orders = hasMore ? rows.slice(0, take) : rows;
  return {
    orders: orders.map(shapeOrder),
    newCount,
    nextCursor: hasMore && orders.length > 0 ? orders[orders.length - 1].id : null,
  };
}

export async function updateCustomerOrderStatus(shopId, orderId, { status, billId, locationId } = {}) {
  if (status && !ORDER_STATUSES.includes(status)) throw new AppError("Invalid order status", 400);
  const existing = await db.customerOrder.findFirst({ where: { id: orderId, shopId, ...(locationId ? { locationId } : {}) } });
  if (!existing) throw new AppError("Order not found", 404);
  if (status && status !== existing.status && !ALLOWED_TRANSITIONS[existing.status]?.has(status)) {
    const error = new AppError(`Order cannot move from ${existing.status} to ${status}`, 409, "INVALID_ORDER_TRANSITION");
    error.publicData = { currentStatus: existing.status, requestedStatus: status };
    throw error;
  }
  if (billId) {
    const bill = await db.bill.findFirst({ where: { id: billId, shopId, ...(existing.locationId ? { locationId: existing.locationId } : {}) }, select: { id: true } });
    if (!bill) throw new AppError("Linked bill does not belong to this order's store", 409, "ORDER_BILL_LOCATION_MISMATCH");
  }
  const now = new Date();

  const updated = await db.customerOrder.update({
    where: { id: orderId },
    data: {
      ...(status ? { status } : {}),
      ...(billId !== undefined ? { billId: billId || null } : {}),
      ...(status === "accepted" && !existing.acceptedAt ? { acceptedAt: now } : {}),
      ...(status === "ready" && !existing.readyAt ? { readyAt: now } : {}),
      ...(status === "fulfilled" && !existing.fulfilledAt ? { fulfilledAt: now } : {}),
      ...(status === "rejected" && !existing.rejectedAt ? { rejectedAt: now } : {}),
      ...(status === "cancelled" && !existing.cancelledAt ? { cancelledAt: now } : {}),
    },
  });
  return shapeOrder(updated);
}
