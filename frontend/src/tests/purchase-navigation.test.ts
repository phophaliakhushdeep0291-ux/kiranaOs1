import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("purchase navigation", () => {
  it("keeps Purchases in the main daily counter navigation", () => {
    const dailyLinks = layout.slice(layout.indexOf("const dailyLinks"), layout.indexOf("const businessLinks"));
    const businessLinks = layout.slice(layout.indexOf("const businessLinks"), layout.indexOf("const adminLinks"));

    expect(dailyLinks).toContain('href: "/purchase-bills"');
    expect(dailyLinks.indexOf('href: "/inventory"')).toBeLessThan(dailyLinks.indexOf('href: "/purchase-bills"'));
    expect(dailyLinks.indexOf('href: "/purchase-bills"')).toBeLessThan(dailyLinks.indexOf('href: "/customers"'));
    expect(businessLinks).not.toContain('href: "/purchase-bills"');
  });
});
