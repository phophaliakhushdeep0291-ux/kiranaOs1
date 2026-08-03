import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sync settings status display", () => {
  const settingsSource = readFileSync("src/features/core/settings/pages/SyncSettingsPage.tsx", "utf8");
  const repairSource = readFileSync("src/features/core/sync/sync-status-repair.ts", "utf8");

  it("does not show Synced while uploads are still pending", () => {
    expect(settingsSource).toContain("hasPending ? \"Pending backup\" : \"Synced\"");
    expect(settingsSource).toContain("pendingCount > 0");
    expect(settingsSource).toContain("backupStatusTone");
  });

  it("repairs stale SYNCING outbox rows so they can retry", () => {
    expect(repairSource).toContain("STALE_SYNCING_TIMEOUT_MS");
    expect(repairSource).toContain("repairStaleSyncingOutboxEvents");
    expect(repairSource).toContain("status: \"PENDING\"");
    expect(repairSource).toContain("sync_status: \"pending_sync\"");
  });
});
