import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const vite = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
const readiness = readFileSync(new URL("../features/core/sync/offline-readiness.ts", import.meta.url), "utf8");

describe("offline shell and readiness contract", () => {
  it("pre-caches every critical counter route and its dependency closure", () => {
    for (const route of [
      "DashboardPage.tsx",
      "BillingPage.tsx",
      "ProductsPage.tsx",
      "CustomersPage.tsx",
      "InventoryPage.tsx",
      "BillsPage.tsx",
      "PurchaseBillsPage.tsx",
      "ReportsPage.tsx",
      "SyncStatusPage.tsx",
      "RecoveryModePage.tsx",
    ]) expect(vite).toContain(route);
    expect(vite).toContain("for (const imported of record.imports ?? []) includeRecord(imported, assets, seen)");
    expect(vite).not.toContain("collectAssets(assetsRoot)");
  });

  it("does not declare offline readiness from index.html alone", () => {
    expect(readiness).toContain('["/index.html", "/manifest.webmanifest", "/offline.html"]');
    expect(readiness).toContain("const hasScript");
    expect(readiness).toContain("const hasStyles");
  });

  it("includes licence and current-device validity in the readiness decision", () => {
    expect(readiness).toContain("getLicenseEvaluation");
    expect(readiness).toContain("listCachedDevices");
    expect(readiness).toContain("!billingAllowed");
    expect(readiness).toContain("currentDeviceStatus");
  });
});
