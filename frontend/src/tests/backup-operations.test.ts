import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync("src/features/backups/api.ts", "utf8");
const settingsSource = readFileSync("src/features/settings/pages/SyncSettingsPage.tsx", "utf8");
const httpSource = readFileSync("src/lib/api/http.ts", "utf8");

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
    expect(settingsSource).toContain("AES-256-GCM");
    expect(settingsSource).toContain("SHA-256");
    expect(settingsSource).toContain("Sensitive credentials");
    expect(settingsSource).not.toContain("Downloadable backups & restore are coming soon");
  });
});
