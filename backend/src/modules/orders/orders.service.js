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
 * Shop-scoped; newest first. Returns the count of still-new orders for the nav badge.
 */
export async function listCustomerOrders(shopId, { status } = {}) {
  const where = { shopId };
  if (status && status !== "all") where.status = status;

  const [orders, newCount] = await Promise.all([
    db.customerOrder.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 }),
    db.customerOrder.count({ where: { shopId, status: "new" } }),
  ]);

  return { orders: orders.map(shapeOrder), newCount };
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
