import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cart = readFileSync("src/features/core/billing/pages/components/BillingCart.tsx", "utf8");
const summary = readFileSync("src/features/core/billing/pages/components/BillingSummary.tsx", "utf8");
const payment = readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");

describe("mobile billing checkout touch targets", () => {
  it("keeps portion, rate, discount, note, quantity and remove controls at least 44px", () => {
    expect(cart).toContain("grid-cols-[34px_minmax(0,1fr)_44px]");
    expect(cart).toContain("sm:grid-cols-[34px_minmax(0,1fr)_134px_60px_44px]");
    expect(cart).toContain('className="mt-1 h-11 max-w-full');
    expect(cart).toContain("inline-flex min-h-11 items-center");
    expect(cart).toContain('className="mt-1 h-11 w-full');
    expect(cart).toContain('grid h-[46px] w-[134px] grid-cols-3');
    expect(cart).toContain("min-h-11 min-w-11 bg-white");
    expect(cart).toContain('grid h-11 w-11 place-items-center');
  });

  it("keeps checkout disclosure and destructive actions at least 44px", () => {
    expect(summary).toContain('className="ml-auto inline-flex min-h-11');
    expect(summary).toContain('className="inline-flex min-h-11 items-center text-[12px]');
    expect(summary).toContain('className="flex h-11 w-full items-center');
    expect(summary).toContain('className="flex min-h-11 w-full items-center');
    expect(summary).toContain('className="mt-1 min-h-11 w-full');
  });

  it("keeps partial-payment and cash-tender shortcuts at least 44px", () => {
    expect(payment).toContain('className="min-h-11 w-full rounded-[8px]');
    expect(payment).toContain("inline-flex min-h-11 min-w-11 items-center justify-center");
    expect(payment.match(/className="h-11 font-semibold"/g)).toHaveLength(2);
  });
});
