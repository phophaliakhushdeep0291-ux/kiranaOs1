import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tradeFocus = readFileSync("src/components/shared/TradeFocusStrip.tsx", "utf8");
const reports = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");
const settings = readFileSync("src/features/core/settings/pages/SettingsPage.tsx", "utf8");
const customers = readFileSync("src/features/core/customers/pages/CustomersPage.tsx", "utf8");
const purchaseOrders = readFileSync("src/features/core/purchases/components/PurchaseOrdersPanel.tsx", "utf8");
const styles = readFileSync("src/index.css", "utf8");

describe("core mobile contrast surfaces", () => {
  it("keeps the shared trade guidance on one measurable background", () => {
    expect(tradeFocus).toContain('bg-[#f7faff]');
    expect(tradeFocus).not.toContain("linear-gradient");
    expect(tradeFocus).toContain('text-[#52617c]');
  });

  it("does not put mobile report text over gradients or decorative overlays", () => {
    expect(reports).toContain('bg-[#0b2f6b]');
    expect(reports).toContain('bg-[#071c42]');
    expect(reports).toContain('bg-[#f0fdf4]');
    expect(reports).not.toContain('bg-gradient-to-br from-[var(--brand-ink)]');
    expect(reports).not.toContain('pointer-events-none absolute -right-12');
    expect(reports).toContain('<ChevronDown size={14} className="text-[#7e8ba3]" aria-hidden="true" />');
  });

  it("keeps the compact settings status card on definite dark surfaces", () => {
    expect(settings).toContain('bg-[#0b2f6b]');
    expect(settings).toContain('bg-[#071c42]');
    expect(settings).toContain('text-[#dceaff]');
    expect(settings).not.toContain("bg-[linear-gradient(135deg,var(--brand)_0%,var(--brand-strong)_100%)]");
  });

  it("keeps remaining empty-state actions and headers measurable", () => {
    expect(customers).toContain('rounded-[14px] bg-[#174ea6]');
    expect(purchaseOrders).toContain('border-[#edf1f7] bg-[#f8fbff]');
    expect(purchaseOrders).not.toContain("bg-[linear-gradient(135deg,#f8fbff,#fff)]");
    expect(styles).not.toMatch(/\.scroll-rail\s*\{[^}]*mask-image/s);
  });
});
