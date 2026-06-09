import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/features/bills/pages/BillsPage.tsx", "utf8");

describe("bill history connection badge", () => {
  it("uses live backup status instead of a hardcoded offline label", () => {
    expect(source).toContain("useOfflineStatus");
    expect(source).toContain("Online backup");
    expect(source).toContain("Backing up");
    expect(source).toContain("Backup reconnecting");
    expect(source).toContain("Offline ready");
    expect(source).not.toContain("Works offline");
  });
});
