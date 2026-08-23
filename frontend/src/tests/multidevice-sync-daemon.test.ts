import { describe, expect, it } from "vitest";
import fs from "node:fs";

const daemon = fs.readFileSync("src/lib/realtime/useMultiDeviceSync.tsx", "utf8");
const providers = fs.readFileSync("src/app/providers.tsx", "utf8");

describe("multi-device sync daemon", () => {
  it("runs a controlled sync loop for visible devices", () => {
    // This used to assert SYNC_INTERVAL_MS, because the hook drove its own 8s
    // sync interval. It no longer does: two schedulers with separate re-entrancy
    // flags ran overlapping cycles over the same outbox, so `useOfflineStatus`
    // now owns the cadence for the tab. The loop this test protects is still
    // here — it is just driven by focus, reconnect, local writes and the
    // snapshot timer rather than by a clock of its own.
    expect(daemon).toContain("const SNAPSHOT_INTERVAL_MS = 60_000");
    expect(daemon).toContain("runSyncCycle");
    expect(daemon).toContain("hydrateFromBackendSnapshot");
    expect(daemon).toContain("shouldRunScheduledNetworkWork");
  });

  it("broadcasts completed sync refreshes across tabs", () => {
    expect(daemon).toContain("BroadcastChannel");
    expect(daemon).toContain("sync-complete");
    expect(daemon).toContain("cloud-import-complete");
  });

  it("is wired into app providers", () => {
    expect(providers).toContain("useMultiDeviceSync");
  });
});
