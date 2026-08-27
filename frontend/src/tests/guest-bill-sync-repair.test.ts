import { describe, expect, it } from "vitest";
import { retryableGuestOrderBillValidationConflict, retryableStoredGuestBillConflict } from "@/features/core/sync/sync-status-repair";
import { cartItemKey, type CartItem } from "@/features/core/billing/pages/billing-types";
import type { PendingSyncEvent } from "@/types/domain";

function failedBill(overrides: Record<string, unknown> = {}): PendingSyncEvent {
  return {
    clientEventId: "failed-guest-bill",
    operation_type: "CREATE_BILL",
    entity_type: "bill",
    entity_id: "bill-t1",
    status: "FAILED",
    sync_status: "failed",
    error_message: "Include every guest order line before settling the table.",
    payload: {},
    ...overrides,
  } as unknown as PendingSyncEvent;
}

const product = {
  id: "dish-1",
  name: "Dal Fry",
  rateUnit: "piece",
  displayUnit: "piece",
} as CartItem["product"];

function line(overrides: Partial<CartItem> = {}): CartItem {
  return { product, quantity: 1, rate: 180, unit: "piece", ...overrides };
}

describe("guest bill sync recovery", () => {
  it("retries the exact legacy incomplete-QR-line rejection", () => {
    expect(retryableGuestOrderBillValidationConflict(failedBill())).toBe(true);
    expect(retryableGuestOrderBillValidationConflict(failedBill({ status: "CONFLICT", sync_status: "conflict" }))).toBe(true);
  });

  it("does not retry unrelated or still-pending bill failures", () => {
    expect(retryableGuestOrderBillValidationConflict(failedBill({ error_message: "Guest order is already billed" }))).toBe(false);
    expect(retryableGuestOrderBillValidationConflict(failedBill({ status: "PENDING", sync_status: "pending_sync" }))).toBe(false);
    expect(retryableGuestOrderBillValidationConflict(failedBill({ operation_type: "UPDATE_PRODUCT" }))).toBe(false);
  });

  it("keeps legacy guest-marked lines distinct even when guestSnapshot was lost", () => {
    const ordinary = line();
    const legacyGuest = line({ guestOrderId: "order-1", guestOrderLineId: "order-1-0" });
    const otherGuest = line({ guestOrderId: "order-2", guestOrderLineId: "order-2-0" });

    expect(cartItemKey(legacyGuest)).not.toBe(cartItemKey(ordinary));
    expect(cartItemKey(legacyGuest)).not.toBe(cartItemKey(otherGuest));
  });

  it("recognizes only the protected server review that can be replayed", () => {
    const conflict = {
      id: "conflict-1",
      entity_type: "bill",
      entity_id: "bill-t1",
      source_event_id: "old-create-bill-op",
      error_message: "Include every guest order line before settling the table.",
      local_snapshot: {
        items: [
          { guestOrderId: "order-1", guestOrderLineId: "order-1-0", productId: "coffee" },
          { productId: "dal-fry" },
        ],
      },
    };
    expect(retryableStoredGuestBillConflict(conflict as never)).toBe(true);
    expect(retryableStoredGuestBillConflict({ ...conflict, source_event_id: undefined } as never)).toBe(false);
    expect(retryableStoredGuestBillConflict({ ...conflict, error_message: "Guest order already billed" } as never)).toBe(false);
    expect(retryableStoredGuestBillConflict({ ...conflict, entity_type: "payment" } as never)).toBe(false);
  });
});
