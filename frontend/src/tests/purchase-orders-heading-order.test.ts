import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/features/core/purchases/components/PurchaseOrdersPanel.tsx", "utf8");

describe("purchase orders heading structure", () => {
  it("uses a section heading directly below the Purchase Bills page heading", () => {
    expect(panel).toContain('<h2 className="font-display text-[15px] font-black text-[var(--brand-ink)]">Purchase orders</h2>');
    expect(panel).not.toContain(">Purchase orders</h3>");
  });
});
