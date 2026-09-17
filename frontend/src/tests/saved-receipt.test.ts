import { describe, expect, it } from "vitest";
import { syncedReceiptIdentity } from "@/features/core/billing/pages/saved-receipt";
import type { Bill } from "@/types/api";
const rows = (values: object[]) => values as Bill[];

describe("saved receipt after offline sync", () => {
  it("uses the permanent number after the server replaces the local id", () => {
    expect(syncedReceiptIdentity("local-sale", rows([
      { id: "other-sale", billNo: "KOS-2" },
      { id: "server-sale", local_id: "local-sale", billNo: "KOS-1" },
    ]))).toEqual({ billId: "server-sale", billNo: "KOS-1" });
  });
  it("preserves the pending receipt until its own bill has synced", () => {
    expect(syncedReceiptIdentity("local-sale", rows([{ id: "local-sale", billNo: "PENDING-1" }]))).toBeNull();
    expect(syncedReceiptIdentity("local-sale", rows([{ id: "other-sale", billNo: "KOS-2" }]))).toBeNull();
    expect(syncedReceiptIdentity(undefined, [])).toBeNull();
  });
  it("keeps matching after the saved receipt switches to the server id", () => {
    expect(syncedReceiptIdentity("server-sale", rows([{ id: "server-sale", billNumber: "KOS-1" }]))).toEqual({ billId: "server-sale", billNo: "KOS-1" });
  });
});
