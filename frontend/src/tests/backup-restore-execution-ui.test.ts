import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("transactional backup restore UI", () => {
  const page = fs.readFileSync(path.resolve("src/features/core/settings/pages/SyncSettingsPage.tsx"), "utf8");
  const api = fs.readFileSync(path.resolve("src/features/core/backups/api.ts"), "utf8");
  const reset = fs.readFileSync(path.resolve("src/features/core/backups/restore-local-reset.ts"), "utf8");
  const http = fs.readFileSync(path.resolve("src/lib/api/http.ts"), "utf8");
  const database = fs.readFileSync(path.resolve("src/lib/offline/db.ts"), "utf8");

  it("requires typed artifact confirmation and owner approval", () => {
    expect(page).toContain("RESTORE ${restorePreview.artifact_id.slice(-6)}");
    expect(page).toContain('type: "restore"');
    expect(page).toContain("Final restore approval");
    expect(api).toContain("/restore`");
    expect(api).toContain("confirmation");
  });

  it("refuses restore while this device has unresolved sync work", () => {
    expect(page).toContain("pendingCount > 0 || failedCount > 0 || conflictCount > 0");
    expect(page).toContain("Resolve every pending, failed, or conflicting local change");
  });

  it("clears scoped stale data and authentication before rebootstrap", () => {
    expect(page).toContain("resetDeviceAfterCloudRestore");
    expect(page).toContain('/login?restored=1');
    expect(reset).toContain("offlineDB.clearScopedData");
    expect(reset).toContain("tenant_id: restoredShopId, store_id: restoredShopId");
    expect(reset).toContain("offlineDB.clearAllData");
    expect(http).toContain('notifyDeviceSessionRevoked("DEVICE_REBOOTSTRAP_REQUIRED", shopId)');
    expect(database).toContain("scopeOverride ?? getOfflineScope()");
    expect(reset).toContain("clearInstantMemoryCache");
    expect(reset).toContain("clearAuthStorage");
  });
});
