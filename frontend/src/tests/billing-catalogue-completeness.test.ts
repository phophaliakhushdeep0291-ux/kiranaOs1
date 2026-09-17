import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Product } from "@/types/api";
import { normalizeSearchText, productSearchText } from "@/features/core/billing/pages/billing-calculations";

/**
 * The till must be able to find every product the shop sells.
 *
 * BillingPage asked `useListProducts` for `limit: 350`, and the cached/offline
 * reader honours a limit by SLICING the catalogue. On a 560-item shop that made
 * 210 products unreachable from the counter — not ranked low, absent — and which
 * 210 was an accident of ordering: the server's online, IndexedDB's key order
 * offline. The starter catalogue ships 560 items, so a shop was over the line
 * before it sold anything.
 *
 * Found by selling: "Loose Toor Dal (per kg)" sat at local index 541 and answered
 * "No results" at the counter while it was in stock and billable from its own
 * product page.
 */

const product = (index: number, name: string): Product => ({
  id: `p_${index}`,
  name,
  category: "Loose Dal",
  aliases: [],
  defaultPricePerRateUnit: 155,
} as unknown as Product);

/** The exact shape BillingPage builds its grid and search from. */
function searchCatalogue(products: readonly Product[], query: string): Product[] {
  const index = products.map((row) => ({ product: row, searchText: productSearchText(row) }));
  const q = normalizeSearchText(query);
  if (!q) return index.slice(0, 30).map((entry) => entry.product);
  const starts = index.filter((entry) => entry.searchText.startsWith(q));
  const contains = index.filter((entry) => !entry.searchText.startsWith(q) && entry.searchText.includes(q));
  return [...starts, ...contains].slice(0, 30).map((entry) => entry.product);
}

describe("billing catalogue completeness", () => {
  // A catalogue the size of the one the product ships, with the item that exposed
  // this sitting where it really sat: past any 350-row page.
  const catalogue: Product[] = Array.from({ length: 560 }, (_, i) => product(i, `Filler Item ${i}`));
  catalogue[541] = product(541, "Loose Toor Dal (per kg)");

  it("finds a product that sits past the old 350-row page", () => {
    const hits = searchCatalogue(catalogue, "loose toor");
    expect(hits.map((row) => row.name)).toContain("Loose Toor Dal (per kg)");
  });

  it("would have missed it had the catalogue been paged — the bug, stated", () => {
    // This is what the till actually searched before the fix.
    const paged = catalogue.slice(0, 350);
    expect(searchCatalogue(paged, "loose toor")).toEqual([]);
    // ...while the whole catalogue answers, which is the only difference.
    expect(searchCatalogue(catalogue, "loose toor")).toHaveLength(1);
  });

  it("does not ask for a page of the catalogue on the billing screen", () => {
    // The search above is only as complete as the rows handed to it, so the
    // regression that matters is a limit reappearing on this call. A page size is
    // a cliff a growing shop walks off; the grid is capped at 30 for display and
    // the offline fallback never had a limit at all.
    const source = readFileSync(new URL("../features/core/billing/pages/BillingPage.tsx", import.meta.url), "utf8");
    const call = source.slice(source.indexOf("const products = useListProducts("), source.indexOf("const customers = useListCustomers()"));
    expect(call).toContain("useListProducts(undefined");
    expect(call).not.toMatch(/useListProducts\(\s*\{[^}]*limit/);
  });
});
