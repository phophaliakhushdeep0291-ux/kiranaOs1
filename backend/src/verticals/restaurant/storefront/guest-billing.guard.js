import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { createAuditLog } from "../../../modules/audit/audit.service.js";
import { AppError } from "../../../middleware/error.js";

// Not a request field: only this guard can establish a trusted snapshot.
export const guestSnapshot = Symbol("validated guest order snapshot");
const refusal = (message) => ({ code: "GUEST_ORDER_BILL_MISMATCH", message, status: 409 });
const optionsKey = (rows = []) => rows.map((row) => `${row.optionId}:${row.quantity ?? 1}`).sort().join("|");

function snapshotIdentityKey(item) {
  return JSON.stringify([
    item.productId,
    Number(item.quantity ?? item.qty),
    optionsKey(item.addons),
  ]);
}

const normalizedUnit = (value) => String(value ?? "").trim().toLowerCase();

function lineMatchesSnapshot(item, snapshot) {
  if (snapshotIdentityKey(item) !== snapshotIdentityKey(snapshot)) return false;

  // Public menu portions carry a stable variation code and must match it
  // exactly. A normal/default menu item deliberately has no variation code;
  // the POS can still serialize its ordinary inventory selling-unit code (for
  // example `piece-1-piece`). In that case compare the human unit saved in the
  // trusted order snapshot with the bill's entered unit. Treating the POS-only
  // selling-unit code as a menu variation made an otherwise exact legacy Dal
  // Fry line impossible to recover.
  const snapshotVariation = normalizedUnit(snapshot.variation?.unitCode);
  if (snapshotVariation) {
    return normalizedUnit(item.sellingUnitCode ?? item.variation?.unitCode) === snapshotVariation;
  }

  const snapshotUnit = normalizedUnit(snapshot.unit);
  const submittedUnits = [item.enteredUnit, item.sellingUnitLabel, item.unit]
    .map(normalizedUnit)
    .filter(Boolean);
  // Some older tills persisted the internal inventory code (for example
  // `piece-1-piece`) as enteredUnit while retaining the human selling-unit
  // label (`piece`) alongside it. The public order snapshot only knows that
  // human unit. Accept any submitted human representation, but never the
  // internal sellingUnitCode by itself; product, quantity and add-ons have
  // already matched above, so this remains a narrow, fail-closed recovery.
  return Boolean(snapshotUnit && submittedUnits.includes(snapshotUnit));
}

registerSaleGuard(async ({ shopId, tx, items, location }) => {
  for (const item of items) delete item[guestSnapshot];
  if (items.some((item) => Boolean(item.guestOrderId) !== Boolean(item.guestOrderLineId))) {
    return refusal("A guest order line is missing its order reference. Restore the original line before settling.");
  }
  const ids = [...new Set(items.map((item) => item.guestOrderId).filter(Boolean))];
  if (!ids.length) return null;
  const orders = await tx.customerOrder.findMany({ where: { shopId, id: { in: ids }, fulfillmentType: "dine_in" } });
  if (orders.length !== ids.length) return refusal("A guest order does not belong to this restaurant.");
  if (new Set(orders.map((order) => order.tableId)).size !== 1) return refusal("Guest orders from different tables cannot share a bill.");

  // Older tills could preserve one line's guest identity while dropping it from
  // another line in the same accepted QR order. Recover only when the unlinked
  // bill rows form an exact, unambiguous match for every missing server snapshot.
  // The order id on at least one intact row is the trust anchor; a bill with no
  // guest references at all never enters this compatibility path.
  const missingByKey = new Map();
  const snapshotsByOrder = new Map();
  for (const order of orders) {
    const previousBill = order.billId ? await tx.bill.findFirst({ where: { id: order.billId, shopId }, select: { status: true } }) : null;
    if ((order.billId && previousBill?.status !== "cancelled") || !["accepted", "ready", "fulfilled"].includes(order.status) || (order.locationId && order.locationId !== location.id)) {
      return refusal("A guest order is cancelled, already billed, or belongs to another store.");
    }
    const snapshots = JSON.parse(order.itemsJson);
    if (!Array.isArray(snapshots)) return refusal("The saved guest order is incomplete. Refresh it before settling.");
    snapshotsByOrder.set(order.id, snapshots);
    const lines = items.filter((item) => item.guestOrderId === order.id);
    for (const [index, snapshot] of snapshots.entries()) {
      const matched = lines.filter((item) => item.guestOrderLineId === `${order.id}-${index}`);
      if (matched.length > 1 || (matched.length === 1 && !lineMatchesSnapshot(matched[0], snapshot))) {
        return refusal("The bill does not match the guest's order. Restore the original lines before settling.");
      }
      if (matched.length === 0) {
        const key = snapshotIdentityKey(snapshot);
        const missing = missingByKey.get(key) ?? [];
        missing.push({ orderId: order.id, lineId: `${order.id}-${index}`, snapshot });
        missingByKey.set(key, missing);
      }
    }
    if (lines.some((line) => !snapshots.some((_snapshot, index) => line.guestOrderLineId === `${order.id}-${index}`))) {
      return refusal("The bill does not match the guest's order. Restore the original lines before settling.");
    }
  }

  let recoveredLineCount = 0;
  const unlinked = items.filter((item) => !item.guestOrderId && !item.guestOrderLineId);
  for (const [key, missing] of missingByKey) {
    const candidates = unlinked.filter((item) =>
      snapshotIdentityKey(item) === key && missing.some((expected) => lineMatchesSnapshot(item, expected.snapshot)),
    );
    if (candidates.length !== missing.length) {
      return refusal("Include every guest order line before settling the table.");
    }
    for (const [index, expected] of missing.entries()) {
      candidates[index].guestOrderId = expected.orderId;
      candidates[index].guestOrderLineId = expected.lineId;
      recoveredLineCount += 1;
    }
  }

  // Re-run the complete canonical validation after recovery, then establish the
  // server-owned price snapshot. This keeps the compatibility path fail-closed.
  for (const order of orders) {
    const snapshots = snapshotsByOrder.get(order.id);
    const lines = items.filter((item) => item.guestOrderId === order.id);
    if (lines.length !== snapshots.length) return refusal("Include every guest order line before settling the table.");
    for (const [index, snapshot] of snapshots.entries()) {
      const matched = lines.filter((item) => item.guestOrderLineId === `${order.id}-${index}`);
      const item = matched[0];
      if (matched.length !== 1 || !lineMatchesSnapshot(item, snapshot)) {
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
        before: { billId: order.billId, paymentStatus: order.paymentStatus }, after: { billId: bill.id, paymentStatus }, metadata: { tableId: order.tableId, recoveredGuestLineLinks: recoveredLineCount } });
      if (!audit) throw new AppError("Guest settlement could not be audited", 503, "ORDER_AUDIT_UNAVAILABLE");
    }
  } };
});
