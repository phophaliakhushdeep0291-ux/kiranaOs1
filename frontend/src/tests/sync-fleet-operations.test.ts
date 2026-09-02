import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syncEn } from "@/features/core/settings/translations/sync";

const api = readFileSync("src/features/core/sync/api.ts", "utf8");
const pull = readFileSync("src/features/core/sync/sync-pull.ts", "utf8");
const page = readFileSync("src/features/core/sync/pages/SyncStatusPage.tsx", "utf8");

describe("sync fleet operations", () => {
  it("acknowledges only after the applied sequence is durable locally", () => {
    expect(api).toContain('"/sync/ack"');
    const persist = pull.indexOf("await setStoredServerSequence(latestServerSequence)");
    const acknowledge = pull.indexOf("await acknowledgeApplied(latestServerSequence)");
    expect(persist).toBeGreaterThan(-1);
    expect(acknowledge).toBeGreaterThan(persist);
    // A refused acknowledgement must not discard applied data or block paging —
    // but it must not vanish either, which is what the bare catch here did.
    expect(pull).not.toContain("acknowledgeSyncSequence(latestServerSequence, { background: true }).catch");
    expect(pull).toContain("acknowledgement?.stale_ack_ignored");
  });

  it("gives production catch-up pulls longer than the generic background timeout", () => {
    expect(api).toContain("timeoutMs: 30_000");
  });

  it("loads the management fleet endpoint and exposes actionable terminal states", () => {
    expect(api).toContain('"/sync/devices"');
    expect(page).toContain("getSyncFleet({ background: true })");
    // The page reads these through the dictionary now, so the guard has two halves:
    // the screen still asks for each terminal state, and the words still exist to
    // answer with. Asserting only the literals would go green on a page that had
    // stopped rendering them; asserting only the keys would go green on an empty
    // dictionary entry.
    for (const key of [
      "sync.fleet.title",
      "sync.fleet.state.current",
      "sync.fleet.state.behind",
      "sync.fleet.state.stale",
      "sync.fleet.state.neverAcknowledged",
      "sync.fleet.lag",
      "sync.fleet.thisDevice",
    ] as const) {
      expect(page).toContain(`t("${key}")`);
      expect(syncEn[key]).toBeTruthy();
    }
    for (const label of [
      "Device sync health",
      "Current",
      "Catching up",
      "Needs attention",
      "Not initialized",
      "Sequence lag",
      "This device",
    ]) {
      expect(Object.values(syncEn)).toContain(label);
    }
    // "This device" is a badge on one terminal, never the name of every terminal.
    expect(page).toContain("displayDeviceName(device.device_name, isCurrentDevice)");
  });

  it("never offers destructive version selection for financial conflicts", () => {
    expect(page).toContain('["product", "products", "customer", "customers", "supplier", "suppliers"]');
    expect(page).toContain("allowsDirectConflictChoice(conflict.entity_type)");
    expect(page).toContain('t("sync.conflict.correctionRequired")');
    expect(page).toContain('t("sync.conflict.useReversal")');
    expect(page).toContain('t("sync.conflict.immutable")');
    expect(syncEn["sync.conflict.correctionRequired"]).toBe("Correction required");
    expect(syncEn["sync.conflict.useReversal"]).toBe("Use reversal / correction workflow");
    expect(syncEn["sync.conflict.immutable"]).toContain("Financial and stock history is immutable");
  });
});
