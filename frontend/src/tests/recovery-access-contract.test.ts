import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/features/core/recovery/pages/RecoveryModePage.tsx", "utf8");
const health = readFileSync("src/features/core/recovery/health.ts", "utf8");

describe("recovery access contract", () => {
  it("does not paywall local data recovery or sync repair", () => {
    expect(page).not.toContain("<FeatureGate");
    expect(page).not.toContain("<UpgradePrompt");
    expect(page).toContain("Restore last unsaved bill");
    expect(page).toContain("Recover pending sync operations");
    expect(page).toContain("Encrypted local emergency backup");
    expect(page).toContain("Export local backup");
    expect(page).toContain("Works offline");
    expect(page).toContain("Local DB health check");
  });

  it("checks the real scoped offline stock stores instead of a nonexistent inventory table", () => {
    expect(health).toContain('"inventory_movements"');
    expect(health).toContain('offlineDB.getAll<Record<string, unknown>>("products")');
    expect(health).not.toContain('offlineDB.getAll<Record<string, unknown>>("inventory")');
    expect(health).toContain("row.stockBaseQty ?? row.stock_base_qty");
  });
});
