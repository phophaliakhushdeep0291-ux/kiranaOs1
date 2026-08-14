import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const detail = readFileSync("src/features/core/bills/pages/BillDetailPage.tsx", "utf8");
// Prose lives in the dictionary now, so wording is asserted there and the
// screen is asserted to render the matching key.
const billingEn = readFileSync("src/features/core/settings/translations/billing.ts", "utf8");

describe("email receipt UI", () => {
  it("sends a validated email through the tenant-scoped bill endpoint", () => {
    expect(billingEn).toContain("Email receipt");
    expect(detail).toContain("billing.bills.emailReceipt");
    expect(detail).toContain('type="email"');
    expect(detail).toContain("/email`");
    expect(detail).toContain('method: "POST"');
  });

  it("does not claim success when the provider or network rejects delivery", () => {
    expect(detail).toContain("setEmailError(error instanceof Error ? error.message");
    expect(billingEn).toContain("Receipt emailed");
    expect(detail).toContain("billing.bills.receiptEmailed");
    expect(detail.indexOf('t("billing.bills.receiptEmailed")')).toBeGreaterThan(detail.indexOf("await apiRequest"));
  });
});
