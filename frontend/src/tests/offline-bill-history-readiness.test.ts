import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/core/bills/pages/BillsPage.tsx", "utf8");

describe("offline bill history readiness", () => {
  it("renders scoped local bills before running the repair sweep", () => {
    const loadStart = source.indexOf("async function loadBills()");
    const loadEnd = source.indexOf("function useLocalBills()", loadStart);
    const loadBody = source.slice(loadStart, loadEnd);

    expect(loadStart).toBeGreaterThan(-1);
    expect(loadBody).toContain('offlineDB.getAll<BillRecord>("bills")');
    expect(loadBody).toContain("scheduleBillHistoryRepair();");
    expect(loadBody).not.toContain("await repairStaleSyncedBillOutboxFailures");
  });

  it("keeps the deferred repair single-flight and refreshes through the existing queue event", () => {
    expect(source).toContain("billHistoryRepairTimer !== null || billHistoryRepairSweep !== null");
    expect(source).toContain('window.addEventListener("kirana:sync-queue-updated", refresh)');
  });
});
