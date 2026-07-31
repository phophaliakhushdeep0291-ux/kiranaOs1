import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const api = readFileSync("src/features/sync/api.ts", "utf8");
const pull = readFileSync("src/features/sync/sync-pull.ts", "utf8");
const page = readFileSync("src/features/sync/pages/SyncStatusPage.tsx", "utf8");

describe("sync fleet operations", () => {
  it("acknowledges only after the applied sequence is durable locally", () => {
    expect(api).toContain('"/sync/ack"');
    const persist = pull.indexOf("await setStoredServerSequence(latestServerSequence)");
    const acknowledge = pull.indexOf("await acknowledgeSyncSequence(latestServerSequence");
    expect(persist).toBeGreaterThan(-1);
    expect(acknowledge).toBeGreaterThan(persist);
    expect(pull).toContain(".catch(() => undefined)");
  });

  it("loads the management fleet endpoint and exposes actionable terminal states", () => {
    expect(api).toContain('"/sync/devices"');
    expect(page).toContain("getSyncFleet({ background: true })");
    for (const label of [
      "Device sync health",
      "Current",
      "Catching up",
      "Needs attention",
      "Not initialized",
      "Sequence lag",
      "This device",
    ]) {
      expect(page).toContain(label);
    }
  });

  it("never offers destructive version selection for financial conflicts", () => {
    expect(page).toContain('["product", "products", "customer", "customers", "supplier", "suppliers"]');
    expect(page).toContain("allowsDirectConflictChoice(conflict.entity_type)");
    expect(page).toContain("Correction required");
    expect(page).toContain("Use reversal / correction workflow");
    expect(page).toContain("Financial history is append-only");
  });
});
