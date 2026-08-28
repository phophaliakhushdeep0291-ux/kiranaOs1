import { z } from "zod";
import { AppError } from "../middleware/error.js";

// The array is an immutable quote: never splice or renumber it. Kitchen and
// bill references use the original index, including after a line is cancelled.
export function orderLineSnapshots(order) {
  const lines = JSON.parse(order.itemsJson || "[]");
  if (!Array.isArray(lines)) throw new AppError("The saved order is incomplete. Please ask staff for help.", 409, "INVALID_ORDER_ITEMS");
  return lines;
}

export function activeOrderLines(order) {
  return orderLineSnapshots(order).map((line, index) => ({
    ...line,
    lineId: `${order.id}-${index}`,
    originalQty: Number(line.qty),
    cancelledQty: Number(line.cancelledQty ?? 0),
    qty: Number(line.qty) - Number(line.cancelledQty ?? 0),
  })).filter((line) => line.qty > 0);
}

export function cancelledOrderLines(order) {
  return orderLineSnapshots(order).map((line, index) => ({
    ...line, lineId: `${order.id}-${index}`, qty: Number(line.cancelledQty ?? 0),
  })).filter((line) => line.qty > 0);
}

const selectionSchema = z.object({
  items: z.array(z.object({
    lineId: z.string().min(1).max(200),
    // A desired TOTAL, not an increment. A lost reply can safely be retried
    // without removing another serving, even after the deadline has passed.
    cancelledQuantity: z.number().int().positive().max(10000),
  }).strict()).min(1).max(100).optional(),
}).strict();

export function parseCancellationSelection(input) {
  const result = selectionSchema.safeParse(input);
  if (!result.success) throw new AppError("Select the items and quantities you want to cancel.", 400, "INVALID_CANCELLATION_SELECTION");
  return result.data;
}

export function applyCancellationSelection(order, selection) {
  const snapshots = orderLineSnapshots(order);
  if (snapshots.some((line) => !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0
    || !Number.isFinite(Number(line.price)) || Number(line.price) < 0
    || !Number.isFinite(Number(line.cancelledQty ?? 0)) || Number(line.cancelledQty ?? 0) < 0 || Number(line.cancelledQty ?? 0) > Number(line.qty))) {
    throw new AppError("The saved order needs staff assistance.", 409, "INVALID_ORDER_ITEMS");
  }
  const targets = selection.items ?? snapshots.map((line, index) => ({ lineId: `${order.id}-${index}`, cancelledQuantity: Number(line.qty) }));
  const byId = new Map(snapshots.map((line, index) => [`${order.id}-${index}`, line]));
  const seen = new Set();
  for (const target of targets) {
    const line = byId.get(target.lineId);
    if (!line || seen.has(target.lineId) || target.cancelledQuantity > Number(line.qty)) {
      throw new AppError("The selected items have changed. Refresh the order and try again.", 409, "INVALID_CANCELLATION_SELECTION");
    }
    seen.add(target.lineId);
  }
  let changed = false;
  const requested = new Map(targets.map((target) => [target.lineId, target.cancelledQuantity]));
  const updated = snapshots.map((line, index) => {
    const current = Number(line.cancelledQty ?? 0);
    const next = Math.max(current, requested.get(`${order.id}-${index}`) ?? current);
    if (next === current) return line;
    changed = true;
    return { ...line, cancelledQty: next };
  });
  const active = activeOrderLines({ ...order, itemsJson: JSON.stringify(updated) });
  // Prices already include the selected portion and add-ons. Never use a
  // submitted price or re-price against today's menu.
  const totalPaise = active.reduce((sum, line) => sum + Math.round(Number(line.price) * 100) * line.qty, 0);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) throw new AppError("The saved order total needs staff assistance.", 409, "INVALID_ORDER_ITEMS");
  return { changed, snapshots: updated, itemCount: active.length, estimatedTotal: totalPaise / 100 };
}
