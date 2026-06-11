import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("purchase navigation", () => {
  it("keeps Purchases in the main daily counter navigation", () => {
    // The sidebar is now a single primary NAV array (link + group entries).
    const nav = layout.slice(layout.indexOf("const NAV"), layout.indexOf("const MOBILE_NAV"));

    // Purchases stays a top-level, one-tap primary link — not buried inside a sub-group.
    expect(nav).toContain('kind: "link", href: "/purchase-bills", label: "Purchases"');
    // It sits in the primary cluster: after the Inventory group, before the Sales group.
    expect(nav.indexOf('id: "inventory"')).toBeLessThan(nav.indexOf('href: "/purchase-bills"'));
    expect(nav.indexOf('href: "/purchase-bills"')).toBeLessThan(nav.indexOf('id: "sales"'));
  });
});
