import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { retryableBillCancellationValidationConflict } from "@/features/core/sync/sync-status-repair";
import type { PendingSyncEvent } from "@/types/domain";

/**
 * Offline bill cancellations were parked in the conflict queue forever.
 *
 * A bill cancelled before it ever reached the server has no server id, so the
 * client sends `serverBillId: null`. The server schema used `.optional()`, which
 * accepts a MISSING key but not an explicit null, so the event came back
 * INVALID_EVENT with `retryable: false`. No existing repair sweep matched a
 * CANCEL_BILL event, so the cancellation never retried even once the server was
 * fixed — the shop kept seeing "Backup needs attention" for a bill it had already
 * cancelled.
 *
 * The real stuck event, taken from Cloud Backup > "Backup needs attention".
 */
const productionStuckEvent = {
  id: "soft_delete_bill_pending_8d73e536-64c2-47b4-8938-4d70c991e5c7",
  operation_type: "CANCEL_BILL",
  original_operation_type: "SOFT_DELETE_BILL_PENDING",
  entity_type: "bill",
  entity_id: "cmr980a2w004zg1e53rnly6y8",
  status: "CONFLICT",
  sync_status: "conflict",
  payload: {
    billId: "cmr980a2w004zg1e53rnly6y8",
    localBillId: "cmr980a2w004zg1e53rnly6y8",
    serverBillId: null,
    reason: "fgugjklgjkgl",
  },
  error_message:
    '[{"code":"invalid_type","expected":"string","received":"null","path":["serverBillId"],"message":"Expected string, received null"}]',
} as unknown as PendingSyncEvent;

function event(overrides: Record<string, unknown>): PendingSyncEvent {
  return { ...(productionStuckEvent as unknown as Record<string, unknown>), ...overrides } as unknown as PendingSyncEvent;
}

describe("stuck offline bill cancellations are re-queued", () => {
  it("matches the real production CANCEL_BILL / serverBillId null conflict", () => {
    expect(retryableBillCancellationValidationConflict(productionStuckEvent)).toBe(true);
  });

  it("matches a failed (not just conflicted) cancellation", () => {
    expect(
      retryableBillCancellationValidationConflict(event({ status: "FAILED", sync_status: "failed" })),
    ).toBe(true);
  });

  it("matches a RESTORE_BILL rejected the same way", () => {
    expect(
      retryableBillCancellationValidationConflict(
        event({ operation_type: "RESTORE_BILL", original_operation_type: "" }),
      ),
    ).toBe(true);
  });

  it("matches when only the original operation type identifies it as a cancellation", () => {
    expect(
      retryableBillCancellationValidationConflict(
        event({ operation_type: "", original_operation_type: "SOFT_DELETE_BILL_PENDING" }),
      ),
    ).toBe(true);
  });

  // The sweep must stay narrow: anything rejected for a different reason is a real
  // problem that a human should look at, not something to silently re-push in a loop.
  it("ignores a cancellation rejected for an unrelated reason", () => {
    expect(
      retryableBillCancellationValidationConflict(
        event({ error_message: "Bill already cancelled by another device" }),
      ),
    ).toBe(false);
  });

  it("ignores a non-cancellation event with the same validation error", () => {
    expect(
      retryableBillCancellationValidationConflict(
        event({ operation_type: "CREATE_BILL", original_operation_type: "" }),
      ),
    ).toBe(false);
  });

  it("ignores an already-pending cancellation so it is not reset mid-flight", () => {
    expect(
      retryableBillCancellationValidationConflict(
        event({ status: "PENDING", sync_status: "pending_sync" }),
      ),
    ).toBe(false);
  });
});

describe("the repair sweep runs the cancellation repair", () => {
  const repairSource = readFileSync("src/features/core/sync/sync-status-repair.ts", "utf8");

  it("re-queues matched events as PENDING with the error cleared", () => {
    expect(repairSource).toContain("repairRetryableBillCancellationConflicts");
    expect(repairSource).toContain("cancellationRepaired");
  });
});
