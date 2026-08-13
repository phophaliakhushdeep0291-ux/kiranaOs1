import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { dispatchIntegrationDeliveries, stageIntegrationEvent } from "../integrations/integrations.service.js";

const ORDER_STATUSES = ["new", "accepted", "ready", "fulfilled", "rejected", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "refunded"];
const FULFILLMENT_STATUS_BY_ORDER_STATUS = {
  new: "unfulfilled",
  accepted: "preparing",
  ready: "ready",
  fulfilled: "fulfilled",
  rejected: "cancelled",
  cancelled: "cancelled",
};
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

function orderStateSnapshot(order) {
  return {
    id: order.id,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentStatus: order.paymentStatus,
    billId: order.billId ?? null,
    locationId: order.locationId ?? null,
    acceptedAt: order.acceptedAt ?? null,
    readyAt: order.readyAt ?? null,
    fulfilledAt: order.fulfilledAt ?? null,
    rejectedAt: order.rejectedAt ?? null,
    cancelledAt: order.cancelledAt ?? null,
  };
}

async function writeRequiredOrderAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Order change was not saved because its audit record could not be stored",
      503,
      "ORDER_AUDIT_UNAVAILABLE",
    );
  }
  return audit;
}

/**
 * The owner's "Orders Received" inbox — customer orders submitted from the public QR page.
 * Shop-scoped; newest first; cursor-paginated (the list used to silently truncate at 200).
 * Returns the count of still-new orders for the nav badge and a nextCursor when more exist.
 */
export async function listCustomerOrders(shopId, { status, sourceChannel, paymentStatus, cursor, limit, locationId } = {}) {
  const where = { shopId, ...(locationId ? { locationId } : {}) };
  if (status && status !== "all") where.status = status;
  if (sourceChannel && sourceChannel !== "all") where.sourceChannel = sourceChannel;
  if (paymentStatus && paymentStatus !== "all") where.paymentStatus = paymentStatus;
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

export async function updateCustomerOrderStatus(shopId, orderId, { status, paymentStatus, billId, locationId, actor = {} } = {}) {
  if (status && !ORDER_STATUSES.includes(status)) throw new AppError("Invalid order status", 400);
  if (paymentStatus && !PAYMENT_STATUSES.includes(paymentStatus)) throw new AppError("Invalid payment status", 400);
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.customerOrder.findFirst({ where: { id: orderId, shopId, ...(locationId ? { locationId } : {}) } });
    if (!existing) throw new AppError("Order not found", 404);
    if (status && status !== existing.status && !ALLOWED_TRANSITIONS[existing.status]?.has(status)) {
      const error = new AppError(`Order cannot move from ${existing.status} to ${status}`, 409, "INVALID_ORDER_TRANSITION");
      error.publicData = { currentStatus: existing.status, requestedStatus: status };
      throw error;
    }
    if (billId) {
      const bill = await tx.bill.findFirst({
        where: {
          id: billId,
          shopId,
          status: "active",
          deletedAt: null,
          billType: { notIn: ["estimate", "sale_return"] },
          ...(existing.locationId ? { locationId: existing.locationId } : {}),
        },
        select: { id: true },
      });
      if (!bill) throw new AppError("Linked bill must be an active sale from this order's store", 409, "ORDER_BILL_LOCATION_MISMATCH");
      const alreadyLinked = await tx.customerOrder.findFirst({
        where: { shopId, billId, NOT: { id: orderId } },
        select: { id: true },
      });
      if (alreadyLinked) throw new AppError("This bill is already linked to another customer order", 409, "ORDER_BILL_ALREADY_LINKED");
    }

    const nextStatus = status ?? existing.status;
    const nextPaymentStatus = paymentStatus ?? existing.paymentStatus;
    const nextBillId = billId === undefined ? existing.billId : (billId || null);
    const noStateChange = nextStatus === existing.status
      && nextPaymentStatus === existing.paymentStatus
      && nextBillId === existing.billId;
    if (noStateChange) return { order: existing, deliveries: [] };

    const now = new Date();
    const updateData = {
      ...(status ? { status, fulfillmentStatus: FULFILLMENT_STATUS_BY_ORDER_STATUS[status] } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(billId !== undefined ? { billId: billId || null } : {}),
      ...(status === "accepted" && !existing.acceptedAt ? { acceptedAt: now } : {}),
      ...(status === "ready" && !existing.readyAt ? { readyAt: now } : {}),
      ...(status === "fulfilled" && !existing.fulfilledAt ? { fulfilledAt: now } : {}),
      ...(status === "rejected" && !existing.rejectedAt ? { rejectedAt: now } : {}),
      ...(status === "cancelled" && !existing.cancelledAt ? { cancelledAt: now } : {}),
    };
    const claimed = await tx.customerOrder.updateMany({
      where: { id: orderId, shopId, updatedAt: existing.updatedAt },
      data: updateData,
    });
    if (claimed.count !== 1) {
      throw new AppError("Order changed on another device. Refresh and try again.", 409, "CONCURRENT_ORDER_UPDATE");
    }
    const updated = await tx.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    const changedFields = [
      ...(nextStatus !== existing.status ? ["status", "fulfillmentStatus"] : []),
      ...(nextPaymentStatus !== existing.paymentStatus ? ["paymentStatus"] : []),
      ...(nextBillId !== existing.billId ? ["billId"] : []),
    ];
    await writeRequiredOrderAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      action: "CUSTOMER_ORDER_STATUS_UPDATED",
      entityType: "CustomerOrder",
      entityId: updated.id,
      before: orderStateSnapshot(existing),
      after: orderStateSnapshot(updated),
      metadata: { changedFields, locationId: updated.locationId },
      req: actor.req ?? null,
    }, tx);
    const deliveries = await stageIntegrationEvent(shopId, "customer_order.updated", {
      id: updated.id,
      locationId: updated.locationId,
      fulfillmentType: updated.fulfillmentType,
      status: updated.status,
      sourceChannel: updated.sourceChannel,
      paymentStatus: updated.paymentStatus,
      fulfillmentStatus: updated.fulfillmentStatus,
      billId: updated.billId,
      updatedAt: updated.updatedAt,
    }, { client: tx });
    return { order: updated, deliveries };
  }, { isolationLevel: "Serializable" });

  await dispatchIntegrationDeliveries(result.deliveries);
  return shapeOrder(result.order);
}
