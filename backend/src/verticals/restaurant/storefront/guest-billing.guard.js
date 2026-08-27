import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";
import { AppError } from "../../../middleware/error.js";

// Not a request field: only this guard can establish a trusted snapshot.
export const guestSnapshot = Symbol("validated guest order snapshot");
const refusal = (message) => ({ code: "GUEST_ORDER_BILL_MISMATCH", message, status: 409 });
const optionsKey = (rows = []) => rows.map((row) => `${row.optionId}:${row.quantity ?? 1}`).sort().join("|");

registerSaleGuard(async ({ shopId, tx, items, location }) => {
  for (const item of items) delete item[guestSnapshot];
  const ids = [...new Set(items.map((item) => item.guestOrderId).filter(Boolean))];
  if (!ids.length) return null;
  const orders = await tx.customerOrder.findMany({ where: { shopId, id: { in: ids }, fulfillmentType: "dine_in" } });
  if (orders.length !== ids.length) return refusal("A guest order does not belong to this restaurant.");
  if (new Set(orders.map((order) => order.tableId)).size !== 1) return refusal("Guest orders from different tables cannot share a bill.");
  for (const order of orders) {
    const previousBill = order.billId ? await tx.bill.findFirst({ where: { id: order.billId, shopId }, select: { status: true } }) : null;
    if ((order.billId && previousBill?.status !== "cancelled") || !["accepted", "ready", "fulfilled"].includes(order.status) || (order.locationId && order.locationId !== location.id)) {
      return refusal("A guest order is cancelled, already billed, or belongs to another store.");
    }
    const snapshots = JSON.parse(order.itemsJson);
    const lines = items.filter((item) => item.guestOrderId === order.id);
    if (lines.length !== snapshots.length) return refusal("Include every guest order line before settling the table.");
    for (const [index, snapshot] of snapshots.entries()) {
      const matched = lines.filter((item) => item.guestOrderLineId === `${order.id}-${index}`);
      const item = matched[0];
      if (matched.length !== 1 || item.productId !== snapshot.productId || Number(item.quantity) !== Number(snapshot.qty)
        || (item.sellingUnitCode ?? "") !== (snapshot.variation?.unitCode ?? "") || optionsKey(item.addons) !== optionsKey(snapshot.addons)) {
        return refusal("The bill does not match the guest's order. Restore the original lines before settling.");
      }
      // Submitted prices cannot establish this quote; the saved server order can.
      item[guestSnapshot] = snapshot;
      const addonTotal = (snapshot.addons ?? []).reduce((sum, addon) => sum + addon.price * (addon.quantity ?? 1), 0);
      item.baseRatePerRateUnit = Number(snapshot.basePrice ?? snapshot.variation?.price ?? (snapshot.price - addonTotal));
      item.ratePerRateUnit = Number(snapshot.price);
    }
  }
  return { onConfirmed: async ({ tx: client, bill, actor }) => {
    for (const order of orders) {
      const paymentStatus = Number(bill.creditAmount) > 0 ? (Number(bill.paidAmount) > 0 ? "partially_paid" : "unpaid") : "paid";
      const claimed = await client.customerOrder.updateMany({ where: { id: order.id, shopId, billId: order.billId, status: { in: ["accepted", "ready", "fulfilled"] } },
        data: { billId: bill.id, paymentStatus } });
      if (claimed.count !== 1) throw new AppError("Guest order changed before settlement. Refresh and retry.", 409, "GUEST_ORDER_ALREADY_BILLED");
      const audit = await createAuditLog({ client, shopId, userId: actor?.userId ?? null, action: "GUEST_ORDER_BILLED", entityType: "CustomerOrder", entityId: order.id,
        before: { billId: order.billId, paymentStatus: order.paymentStatus }, after: { billId: bill.id, paymentStatus }, metadata: { tableId: order.tableId } });
      if (!audit) throw new AppError("Guest settlement could not be audited", 503, "ORDER_AUDIT_UNAVAILABLE");
    }
  } };
});
