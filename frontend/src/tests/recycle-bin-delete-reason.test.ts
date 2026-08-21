/**
 * The Recycle Bin's Reason column has to say why, because the owner was made to type it.
 *
 * Every delete dialog marks the reason REQUIRED, but no table here has a column for it
 * and neither does the server — it goes to the audit trail and only there. The column
 * read the record, found nothing, and printed "No reason added" for every row ever
 * binned: a mandatory field collected and then thrown away as far as anyone could see.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  stores: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => mockState.stores[storeName] ?? []),
  },
}));

vi.mock("@/features/core/sync/bill-reconciliation", () => ({
  isMergedBillTwin: vi.fn(() => false),
}));

import { loadRecycleRows } from "@/features/core/recycle-bin/pages/RecycleBinPage";

const DELETED_AT = "2026-08-21T18:00:00.000Z";

beforeEach(() => {
  mockState.stores = {};
});

describe("recycle bin shows why a record was binned", () => {
  it("fills the reason from the audit trail when the record carries none", async () => {
    mockState.stores.products = [{ id: "server_product_1", name: "Ashirvaad Atta", deleted_at: DELETED_AT }];
    mockState.stores.local_audit_logs = [
      { action: "product_deleted", entity_id: "server_product_1", reason: "Discontinued by the mill", created_at: DELETED_AT },
    ];

    const [row] = await loadRecycleRows();

    expect(row).toEqual(expect.objectContaining({ label: "Ashirvaad Atta", reason: "Discontinued by the mill" }));
  });

  it("matches the audit row by whichever id the record was deleted under", async () => {
    // The trail names the record as it was at the time; the row may since be keyed by
    // its server id, so the lookup has to try local_id and server_id too.
    mockState.stores.suppliers = [
      { id: "server_supplier_1", local_id: "supplier_local_1", name: "Shree Balaji", deletedAt: DELETED_AT },
    ];
    mockState.stores.local_audit_logs = [
      { action: "supplier_deleted", entity_id: "supplier_local_1", reason: "Duplicate supplier", created_at: DELETED_AT },
    ];

    const [row] = await loadRecycleRows();

    expect(row.reason).toBe("Duplicate supplier");
  });

  it("uses the newest reason when a record was binned, restored and binned again", async () => {
    mockState.stores.customers = [{ id: "c1", name: "Ramesh", deleted_at: "2026-08-21T20:00:00.000Z" }];
    mockState.stores.local_audit_logs = [
      { action: "customer_deleted", entity_id: "c1", reason: "Left the area", created_at: "2026-08-20T09:00:00.000Z" },
      { action: "customer_deleted", entity_id: "c1", reason: "Duplicate entry", created_at: "2026-08-21T20:00:00.000Z" },
    ];

    const [row] = await loadRecycleRows();

    expect(row.reason).toBe("Duplicate entry");
  });

  it("still prefers a reason stored on the record itself", async () => {
    mockState.stores.bills = [{ id: "b1", billNumber: "INV-1", deleted_at: DELETED_AT, reason: "Cancelled at the counter" }];
    mockState.stores.local_audit_logs = [
      { action: "bill_deleted", entity_id: "b1", reason: "Something older", created_at: DELETED_AT },
    ];

    const [row] = await loadRecycleRows();

    expect(row.reason).toBe("Cancelled at the counter");
  });

  it("leaves the reason empty when the trail genuinely has none", async () => {
    // Blank, so the column falls back to its own "No reason added" — never a stray
    // reason borrowed from an unrelated record.
    mockState.stores.products = [{ id: "p1", name: "Orphan", deleted_at: DELETED_AT }];
    mockState.stores.local_audit_logs = [
      { action: "product_deleted", entity_id: "some_other_product", reason: "Not this one", created_at: DELETED_AT },
      { action: "product_updated", entity_id: "p1", reason: "A price change, not a delete", created_at: DELETED_AT },
    ];

    const [row] = await loadRecycleRows();

    expect(row.reason).toBe("");
  });
});
