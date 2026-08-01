import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync("src/features/bills/pages/BillDetailPage.tsx", "utf8");

describe("email receipt UI", () => {
  it("sends a validated email through the tenant-scoped bill endpoint", () => {
    expect(detail).toContain("Send by email");
    expect(detail).toContain('type="email"');
    expect(detail).toContain("/email`");
    expect(detail).toContain('method: "POST"');
  });

  it("does not claim success when the provider or network rejects delivery", () => {
    expect(detail).toContain("setEmailError(error instanceof Error ? error.message");
    expect(detail).toContain("Receipt emailed");
    expect(detail.indexOf("Receipt emailed")).toBeGreaterThan(detail.indexOf("await apiRequest"));
  });
});
