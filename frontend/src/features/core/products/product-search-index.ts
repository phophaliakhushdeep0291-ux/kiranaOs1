import { buildProductSearchText, normaliseProductSearchTerm } from "./product-reliability";

type SearchableProduct = Parameters<typeof buildProductSearchText>[0];

/** Build once per catalogue snapshot, not once per keystroke. The owner of the
 * snapshot (useMemo in the UI) also owns its lifetime; no global product cache. */
export function createProductSearchIndex<T extends SearchableProduct>(products: readonly T[]) {
  const entries = products.map((product) => ({ product, text: buildProductSearchText(product) }));
  return {
    search(query: string, include: (product: T) => boolean = () => true): T[] {
      const normalized = normaliseProductSearchTerm(query);
      const matches: T[] = [];
      for (const { product, text } of entries) {
        if ((!normalized || text.includes(normalized)) && include(product)) matches.push(product);
      }
      return matches;
    },
  };
}
