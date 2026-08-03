import { describe, expect, it } from "vitest";
import { backendOperationTypeFor } from "@/features/core/sync/sync-operation-normalizer";
import type { PendingSyncEvent } from "@/lib/offline/db";

function event(operationType: string): PendingSyncEvent {
  return { operation_type: operationType } as PendingSyncEvent;
}

describe("bill history delete semantics", () => {
  it("syncs history deletion separately from financial cancellation", () => {
    expect(backendOperationTypeFor(event("SOFT_DELETE_BILL_PENDING"))).toBe("DELETE_BILL");
    expect(backendOperationTypeFor(event("RESTORE_BILL_PENDING"))).toBe("RESTORE_DELETED_BILL");
    expect(backendOperationTypeFor(event("CANCEL_BILL_PENDING"))).toBe("CANCEL_BILL");
  });
});
