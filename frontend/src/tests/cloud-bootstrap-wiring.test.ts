import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

describe("cloud data bootstrap wiring", () => {
  it("mounts cloud bootstrap and realtime sync inside the authenticated provider tree", () => {
    const providers = read("src/app/providers.tsx");
    expect(providers).toContain("CloudDataBootstrap");
    expect(providers).toContain("RealtimeRefreshBridge");
    expect(providers).toContain('networkMode: "always"');

    const authProviderIndex = providers.indexOf("<AuthProvider>");
    const realtimeIndex = providers.indexOf("<RealtimeRefreshBridge />");
    const bootstrapIndex = providers.indexOf("<CloudDataBootstrap />");
    const childrenIndex = providers.indexOf("{children}");
    const authCloseIndex = providers.indexOf("</AuthProvider>");

    expect(authProviderIndex).toBeGreaterThanOrEqual(0);
    expect(realtimeIndex).toBeGreaterThan(authProviderIndex);
    expect(bootstrapIndex).toBeGreaterThan(authProviderIndex);
    expect(childrenIndex).toBeGreaterThan(authProviderIndex);
    expect(authCloseIndex).toBeGreaterThan(childrenIndex);
    expect(realtimeIndex).toBeLessThan(authCloseIndex);
    expect(bootstrapIndex).toBeLessThan(authCloseIndex);
  });

  it("runs sync and refreshes active queries after login", () => {
    const bootstrap = read("src/features/core/sync/CloudDataBootstrap.tsx");
    expect(bootstrap).toContain("runSyncCycle");
    expect(bootstrap).toContain("kirana:cloud-bootstrap-complete");
    expect(bootstrap).toContain("kirana:local-data-changed");
    expect(bootstrap).toContain("refetchQueries");
  });
});
