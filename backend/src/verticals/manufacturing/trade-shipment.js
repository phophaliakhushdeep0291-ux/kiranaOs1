import { round2 } from "../../utils/money.js";

// Packing describes the next reserved consignment; dispatched documents name
// the latest shipment. Never mix its batches with prior loads.
export function shipmentForOrder(order) {
  const pending = ["allocated", "packed"].includes(order.status);
  const dispatch = pending ? null : order.dispatches?.at(-1);
  if (!pending && !dispatch) return { dispatch: null, items: order.items };
  const items = order.items.flatMap((item) => {
    const allocations = item.allocations.filter((row) => pending ? !row.dispatchId : row.dispatchId === dispatch.id);
    const baseQuantity = round2(allocations.reduce((sum, row) => sum + Number(row.quantityBaseQty), 0));
    if (baseQuantity <= 0) return [];
    const fraction = baseQuantity / Number(item.quantityBaseQty);
    const quantity = round2(Number(item.quantity) * fraction);
    return [{ ...item, allocations, quantity, packedQuantity: quantity, quantityBaseQty: baseQuantity, lineTotal: round2(Number(item.lineTotal) * fraction) }];
  });
  return { dispatch, items };
}
