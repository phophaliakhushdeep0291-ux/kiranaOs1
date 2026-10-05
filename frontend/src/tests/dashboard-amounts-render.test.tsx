import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ language: "en", t: (key: string) => key }) }));
import { MobileHeroStat, PaymentModeBreakdown } from "@/features/core/dashboard/pages/DashboardPage";

describe("dashboard rendered amounts", () => {
  it("shows paise in the mobile cash value", () => {
    const html = renderToStaticMarkup(<MobileHeroStat label="Cash collected" value={121.5} />);
    expect(html).toContain("Cash collected");
    expect(html).toContain("₹121.50");
    expect(html).not.toContain("₹122");
  });

  it("shows a signed refund and a zero net total without a misleading pie percentage", () => {
    const html = renderToStaticMarkup(<PaymentModeBreakdown total={0} period="today" onPeriodChange={() => undefined}
      rows={[{ label: "Cash", value: -20.25, color: "green", dot: "bg-green" }, { label: "UPI", value: 20.25, color: "blue", dot: "bg-blue" }]} />);
    expect(html).toContain("-₹20.25");
    expect(html).toContain("₹0");
    expect(html).not.toMatch(/\(\d+(\.\d+)?%\)/);
  });
});
