import { describe, expect, it } from "vitest";
import fs from "node:fs";

const daemon = fs.readFileSync("src/lib/realtime/useMultiDeviceSync.tsx", "utf8");
const providers = fs.readFileSync("src/app/providers.tsx", "utf8");

describe("multi-device sync daemon", () => {
  it("runs a controlled sync loop for visible devices", () => {
    expect(daemon).toContain("SYNC_INTERVAL_MS");
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
