import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("purchase bill actions", () => {
  it("shows paid, edit, and delete actions on the purchase ledger", () => {
    const source = readFileSync("src/features/purchases/pages/PurchaseBillsPage.tsx", "utf8");

    expect(source).toContain("markPurchasePaidLocal");
    expect(source).toContain("updatePurchaseLocal");
    expect(source).toContain("deletePurchaseLocal");
    expect(source).toContain("aria-label=\"Mark purchase paid\"");
    expect(source).toContain("aria-label=\"Edit purchase\"");
    expect(source).toContain("aria-label=\"Delete purchase\"");
  });

  it("updates matching purchase history and inventory movement copies together", () => {
    const source = readFileSync("src/features/purchases/local-actions.ts", "utf8");

    expect(source).toContain("\"purchase_bills\"");
    expect(source).toContain("\"inventory_movements\"");
    expect(source).toContain("\"sync_outbox\"");
    expect(source).toContain("UPDATE_PURCHASE_BILL");
    expect(source).toContain("DELETE_PURCHASE_BILL");
    expect(source).toContain("findMatchingPurchaseRows");
    expect(source).toContain("businessKey");
  });
});
