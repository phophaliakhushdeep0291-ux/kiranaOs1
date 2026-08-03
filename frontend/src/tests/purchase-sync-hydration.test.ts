import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizePullChanges } from "@/features/core/sync/sync-pull";
import { tableNameForEntity } from "@/features/core/sync/sync-types";
import type { SyncPullResponse } from "@/types/api";

describe("purchase sync hydration", () => {
  it("hydrates backend purchase history into the local purchase bills table", () => {
    const response = {
      purchaseHistory: [
        {
          id: "purchase_history_1",
          supplierName: "Govind ji",
          billAmount: 4100,
          purchasePaidAmount: 4100,
          purchaseDueAmount: 0,
        },
      ],
    } as unknown as SyncPullResponse;

    expect(normalizePullChanges(response)).toEqual([
      {
        entity_type: "purchase_history",
        entity: response.purchaseHistory?.[0],
      },
    ]);
    expect(tableNameForEntity("purchase_history")).toBe("purchase_bills");
    expect(tableNameForEntity("purchaseHistory")).toBe("purchase_bills");
  });

  it("keeps purchase history on its own entity cursor", () => {
    const source = readFileSync("src/features/core/sync/sync-pull.ts", "utf8");
    const apiSource = readFileSync("src/features/core/sync/api.ts", "utf8");
    const backendSource = readFileSync("../backend/src/modules/sync/sync.service.js", "utf8");
    const hydrationSource = readFileSync("src/features/core/sync/cloud-hydration.ts", "utf8");
    const pageSource = readFileSync("src/features/core/purchases/pages/PurchaseBillsPage.tsx", "utf8");

    expect(source).toContain("\"purchaseHistory\"");
    expect(source).toContain("[\"purchaseHistory\", \"purchase_history\"]");
    expect(apiSource).toContain("value === null");
    expect(backendSource).toContain("parsed[entity] === null");
    expect(hydrationSource).toContain("hydratePurchaseHistoryFromSyncPull");
    expect(hydrationSource).toContain("offlineDB.putMany(\"purchase_bills\"");
    expect(pageSource).toContain("hydratePurchaseHistoryFromSyncPull");
  });
});
