import type { TranslationKey } from "@/features/core/settings/i18n";

const STATUS_KEYS: Record<string, TranslationKey> = {
  draft: "manufacturing.orders.status.draft",
  confirmed: "manufacturing.orders.status.confirmed",
  allocated: "manufacturing.orders.status.allocated",
  packed: "manufacturing.orders.status.packed",
  dispatched: "manufacturing.orders.status.dispatched",
  partially_dispatched: "manufacturing.orders.status.partiallyDispatched",
  invoiced: "manufacturing.orders.status.invoiced",
  returned: "manufacturing.orders.status.returned",
  cancelled: "manufacturing.orders.status.cancelled",
};

/**
 * The words for an order's status. The register printed the raw value, so a
 * Hindi counter read "draft" and "cancelled". The server also holds an order in
 * a transient claim ("allocating", "dispatching" …) while a step commits; a
 * refresh can land in that window, and it is shown as work in progress.
 */
export function tradeOrderStatusKey(status: string): TranslationKey {
  return STATUS_KEYS[status] ?? "manufacturing.orders.status.updating";
}

/** Reallocated back-orders still have shipped goods and cannot be cancelled. */
export function canCancelTradeOrder(order: { status: string; dispatches?: unknown[] }) {
  return !order.dispatches?.length && ["draft", "confirmed", "allocated", "packed"].includes(order.status);
}

export function hasOutstandingTradeQuantity(order: { items: Array<{ quantityBaseQty: number; allocations?: Array<{ quantityBaseQty: number; dispatchId?: string | null }> }> }) {
  return order.items.some((item) => Number(item.quantityBaseQty) - (item.allocations ?? []).filter((row) => row.dispatchId).reduce((sum, row) => sum + Number(row.quantityBaseQty), 0) > 0.001);
}

export function nextDispatchNumber(order: { orderNumber: string; dispatches?: Array<{ dispatchNumber?: string }> }) {
  const used = new Set((order.dispatches ?? []).map((row) => row.dispatchNumber));
  let sequence = (order.dispatches?.length ?? 0) + 1;
  for (;;) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const number = `DSP-${order.orderNumber}`.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(number)) return number;
    sequence += 1;
  }
}

/**
 * Which documents an order can print. A packing list is what the packer works
 * from, so it exists once batches are allocated; a label once goods are packed.
 * A cancelled order printed both, for goods that were never going anywhere.
 */
export function tradeOrderDocuments(order: { status: string; billId?: string | null }) {
  const packingFrom = ["allocated", "packed", "dispatched", "partially_dispatched", "invoiced", "returned"];
  const labelFrom = ["packed", "dispatched", "partially_dispatched", "invoiced", "returned"];
  return {
    packingList: packingFrom.includes(order.status),
    label: labelFrom.includes(order.status),
    invoice: Boolean(order.billId) && ["invoiced", "returned", "partially_dispatched"].includes(order.status),
  };
}

export function lineCountKey(count: number): TranslationKey {
  return count === 1 ? "manufacturing.orders.lineOne" : "manufacturing.orders.lineMany";
}

/** Today in the device's own calendar. `toISOString()` is UTC, which in India is yesterday until 05:30. */
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
