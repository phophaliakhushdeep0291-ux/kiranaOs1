import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/features/recovery/pages/RecoveryModePage.tsx", "utf8");

describe("recovery access contract", () => {
  it("does not paywall local data recovery or sync repair", () => {
    expect(page).not.toContain("<FeatureGate");
    expect(page).not.toContain("<UpgradePrompt");
    expect(page).toContain("Restore last unsaved bill");
    expect(page).toContain("Recover pending sync operations");
    expect(page).toContain("Local DB health check");
  });
});
