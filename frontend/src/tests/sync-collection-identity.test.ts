import { describe, expect, it } from "vitest";
import { extractIdPair } from "@/features/core/sync/sync-types";
import type { PendingSyncEvent } from "@/lib/offline/db";

describe("collection sync identities", () => {
  it("does not replace the original supplier payment identity with its refund identity", () => {
    const pair = extractIdPair({ status: "synced", serverId: "refund-ledger",
      result: { paymentId: "supplier-payment-local", originalLedgerEntryId: "original-ledger", reversalLedgerEntryId: "refund-ledger" },
    }, { operation_type: "REVERSE_SUPPLIER_PAYMENT", entity_type: "payment", entity_id: "supplier-payment-local" } as PendingSyncEvent);
    expect(pair.serverId).toBe("original-ledger");
    expect(pair.localId).toBe("supplier-payment-local");
  });
  it("keeps two customer collections distinct when an older envelope returns the customer id", () => {
    const pairs = ["a", "b"].map((suffix) => extractIdPair({
      status: "synced", serverId: "customer_1",
      result: { customerId: "customer_1", ledgerEntryId: `server_ledger_${suffix}`, localPaymentId: `payment_${suffix}` },
    }, { operation_type: "RECORD_PAYMENT", entity_type: "payment", entity_id: `payment_${suffix}` } as PendingSyncEvent));
    expect(pairs.map((row) => row.serverId)).toEqual(["server_ledger_a", "server_ledger_b"]);
    expect(pairs.map((row) => row.localId)).toEqual(["payment_a", "payment_b"]);
  });
});
