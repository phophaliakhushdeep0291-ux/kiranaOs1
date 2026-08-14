import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync("src/features/core/backups/api.ts", "utf8");
const settingsSource = readFileSync("src/features/core/settings/pages/SyncSettingsPage.tsx", "utf8");
const httpSource = readFileSync("src/lib/api/http.ts", "utf8");
// The encryption claim is prose, so it lives in the dictionary now. Asserted
// there, and paired with the key the screen renders, so the claim cannot be
// dropped from either side.
const settingsEn = readFileSync("src/features/core/settings/translations/settings-pages.ts", "utf8");

describe("encrypted shop backup operations", () => {
  it("uses protected server endpoints and a binary response", () => {
    expect(apiSource).toContain('apiRequest<BackupListResponse>("/jobs/backups"');
    expect(apiSource).toContain('method: "POST"');
    expect(apiSource).toContain("ownerPin");
    expect(apiSource).toContain("/download");
    expect(apiSource).toContain('responseType: "blob"');
    expect(httpSource).toContain('responseType?: "json" | "blob"');
    expect(httpSource).toContain("response.blob()");
  });

  it("shows real artifact history and requires owner approval for exports", () => {
    expect(settingsSource).toContain("listShopBackups");
    expect(settingsSource).toContain("createShopBackup(ownerPin)");
    expect(settingsSource).toContain("downloadShopBackup");
    expect(settingsSource).toContain("OwnerPinModal");
    expect(settingsEn).toContain("AES-256-GCM");
    expect(settingsSource).toContain("settings.sync.encryption");
    expect(settingsEn).toContain("SHA-256");
    expect(settingsEn).toContain("Sensitive credentials");
    // Negative check stays on BOTH: the retired placeholder must not reappear
    // in the screen or in the catalogue prose that now feeds it.
    expect(settingsSource).not.toContain("Downloadable backups & restore are coming soon");
    expect(settingsEn).not.toContain("Downloadable backups & restore are coming soon");
  });
});
