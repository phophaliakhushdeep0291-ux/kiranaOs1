import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the udhar route", () => {
  const routes = readFileSync("src/app/routes.tsx", "utf8");
  /**
   * `/udhar` is an alias, not a screen. It briefly rendered a standalone page,
   * which split the same concept across two lists — the dashboard "Outstanding
   * Udhar" card opened one and the sidebar's "Customers / Udhar" the other, and
   * only the sidebar's could record a payment. Both land on the customer credit
   * view again. The widths that view survives are measured by the CDP matrix in
   * scripts/capture-mobile-core-matrix-v1.mjs, not by source assertions here.
   */
  it("resolves to the customer credit view rather than a screen of its own", () => {
    expect(routes).toContain('<Redirect to="/customers?filter=udhar" />');
    expect(routes).not.toContain("loadUdharRoute");
  });
});
