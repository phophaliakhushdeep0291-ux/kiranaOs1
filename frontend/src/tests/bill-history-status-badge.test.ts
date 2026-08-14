import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/core/bills/pages/BillsPage.tsx", "utf8");

describe("bill history connection badge", () => {
  it("uses live backup status instead of a hardcoded offline label", () => {
    expect(source).toContain("useOfflineStatus");
    // The badge must branch on live connection state, not render a fixed label.
    expect(source).toMatch(/isOnline\s*\?/);
    expect(source).toContain("isBrowserOnline");
    expect(source).toContain("backendStatus");
    expect(source).toContain("isSyncing ?");
    expect(source).toContain("Backing up");
    expect(source).toContain("Cloud paused");
    expect(source).toContain("Checking backup");
    expect(source).toContain("chrome.sync.offlineReady");
    expect(readFileSync("src/features/core/settings/translations/shell.ts", "utf8")).toContain("Offline ready");
    expect(source).not.toContain("Works offline");
  });
});
