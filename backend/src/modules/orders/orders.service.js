import db from "../../db.js";
import { AppError } from "../../middleware/error.js";

const ORDER_STATUSES = ["new", "accepted", "fulfilled", "rejected"];

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
export async function listCustomerOrders(shopId, { status, cursor, limit } = {}) {
  const where = { shopId };
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
    db.customerOrder.count({ where: { shopId, status: "new" } }),
  ]);

  const hasMore = rows.length > take;
  const orders = hasMore ? rows.slice(0, take) : rows;
  return {
    orders: orders.map(shapeOrder),
    newCount,
    nextCursor: hasMore && orders.length > 0 ? orders[orders.length - 1].id : null,
  };
}

export async function updateCustomerOrderStatus(shopId, orderId, { status, billId } = {}) {
  if (status && !ORDER_STATUSES.includes(status)) throw new AppError("Invalid order status", 400);
  const existing = await db.customerOrder.findFirst({ where: { id: orderId, shopId } });
  if (!existing) throw new AppError("Order not found", 404);

  const updated = await db.customerOrder.update({
    where: { id: orderId },
    data: {
      ...(status ? { status } : {}),
      ...(billId !== undefined ? { billId: billId || null } : {}),
    },
  });
  return shapeOrder(updated);
}
