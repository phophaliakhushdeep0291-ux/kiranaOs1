import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const hydration = readFileSync("src/features/sync/cloud-hydration.ts", "utf8");
const bootstrap = readFileSync("src/features/sync/CloudDataBootstrap.tsx", "utf8");
const engine = readFileSync("src/features/sync/sync-engine.ts", "utf8");
const manualSync = readFileSync("src/features/sync/manual-sync.ts", "utf8");
const offlineStatus = readFileSync("src/features/sync/useOfflineStatus.ts", "utf8");
const syncBanner = readFileSync("src/features/sync/SyncAlertBanner.tsx", "utf8");

describe("cloud hydration direct import wiring", () => {
  it("imports backend snapshot data from normal APIs, not only sync pull", () => {
    expect(hydration).toContain("/products?limit=");
    expect(hydration).toContain("/customers?limit=");
    expect(hydration).toContain("/bills?from=");
    expect(hydration).toContain("/inventory");
    expect(hydration).toContain("/udhar?limit=");
    expect(hydration).toContain("/subscription/current");
    expect(hydration).toContain("hydratePurchaseHistoryFromSyncPull");
    expect(hydration).toContain("offlineDB.putMany(\"purchase_bills\"");
    expect(hydration).toContain("writeSubscriptionSnapshot(data)");
    expect(hydration).toContain("offlineDB.putMany(\"bills\"");
    expect(hydration).toContain("writeInstantCache(\"bills\"");
  });

  it("runs direct cloud hydration before normal sync cycle after login", () => {
    expect(bootstrap).toContain("const snapshot = await hydrateFromBackendSnapshot()");
    expect(bootstrap.indexOf("const snapshot = await hydrateFromBackendSnapshot()")).toBeLessThan(bootstrap.indexOf("const syncResult = await runSyncCycle()"));
  });

  it("does not rely only on empty local subscription cache before checking server sync status", () => {
    expect(engine).toContain("serverAllowsSync");
    expect(engine).toContain("status.allowed !== false");
    expect(engine).toContain("serverAllowsSync ?? localSubscriptionAllowsSync");
  });

  it("rehydrates authoritative snapshots during user-requested recovery sync", () => {
    expect(manualSync).toContain("const sync = await runSyncCycle()");
    expect(manualSync).toContain("const snapshot = await hydrateFromBackendSnapshot()");
    expect(manualSync.indexOf("const sync = await runSyncCycle()")).toBeLessThan(
      manualSync.indexOf("const snapshot = await hydrateFromBackendSnapshot()"),
    );
    expect(offlineStatus).toContain("if (hydrate) await runManualSyncCycle()");
    expect(offlineStatus).toContain("syncNow({ manual: true, hydrate: false })");
    expect(syncBanner).toContain("await runManualSyncCycle()");
  });
});
