import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deferred = readFileSync("src/features/core/sync/deferred-runtime.ts", "utf8");
const bootstrap = readFileSync("src/features/core/sync/CloudDataBootstrap.tsx", "utf8");
const status = readFileSync("src/features/core/sync/useOfflineStatus.ts", "utf8");
const multiDevice = readFileSync("src/lib/realtime/useMultiDeviceSync.tsx", "utf8");

describe("deferred sync runtime", () => {
  it("keeps reconciliation code out of the first application bundle", () => {
    expect(deferred).toContain('await import("@/features/core/sync/sync-engine")');
    expect(deferred).toContain('await import("@/features/core/sync/manual-sync")');
    expect(deferred).toContain('await import("@/features/core/sync/cloud-hydration")');

    for (const source of [bootstrap, status, multiDevice]) {
      expect(source).toContain("@/features/core/sync/deferred-runtime");
      expect(source).not.toMatch(/^import .*from "@\/features\/core\/sync\/(?:engine|sync-engine|manual-sync|cloud-hydration)";/m);
    }
  });
});
