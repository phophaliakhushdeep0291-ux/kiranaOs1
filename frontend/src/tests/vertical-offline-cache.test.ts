import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync("vite.config.ts", "utf8");
const worker = readFileSync("public/sw.js", "utf8");
const routes = readFileSync("src/app/routes.tsx", "utf8");
const bundleGate = readFileSync("scripts/check-bundle-size.mjs", "utf8");
const readiness = readFileSync("src/features/core/sync/offline-readiness.ts", "utf8");

describe("business-specific offline application cache", () => {
  it("keeps vertical pages out of the universal core cache", () => {
    expect(viteConfig).toContain("experimentalMinChunkSize: 0");
    expect(viteConfig).toContain("Vertical page leaked into the core offline cache");
    expect(viteConfig).toContain("__KIRANA_VERTICAL_ASSETS__");
  });

  it("caches only the authenticated shop's active vertical", () => {
    expect(worker).toContain("CACHE_VERTICAL");
    expect(worker).toContain("VERTICAL_ASSETS[event.data.verticalId]");
    expect(routes).toContain('type: "CACHE_VERTICAL", verticalId: verticalPack.id');
    expect(worker).toContain('/__offline/vertical/${event.data.verticalId}/${BUILD_ID}');
    expect(readiness).toContain("OFFLINE_VERTICAL_BY_BUSINESS_TYPE");
    expect(readiness).toContain('/__offline/vertical/${verticalId}/${buildId()}');

  });

  it("budgets the largest real shop payload instead of every market vertical combined", () => {
    expect(bundleGate).toContain("Largest shop offline payload");
    expect(bundleGate).toContain("MAX_SHOP_OFFLINE_GZIP_BYTES");
  });
});
