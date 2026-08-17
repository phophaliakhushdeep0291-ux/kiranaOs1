/**
 * The trade-details bag as a VALUE — no vocabulary, no labels, no trade copy.
 *
 * Split out of product-attributes.ts for one reason, and it is a bundling one.
 * `products/local-actions.ts` is reachable from the app entry: the offline write
 * path is part of the shell, so anything it imports is downloaded by every shop
 * before first paint. It needs to normalise a bag on its way into IndexedDB —
 * and importing that helper from the catalogue put all twelve trades' field
 * labels, options and help text (~25 kB raw) into the startup chunk of a kirana
 * till that will never render a single one of them. It pushed the initial-JS
 * budget over its ceiling, which is how it was caught.
 *
 * So the shape rule: the SHELL may import this file. Only the product screens
 * may import product-attributes.ts, which re-exports everything here so callers
 * that legitimately want both keep one import.
 */

/** A stored bag: scalars only, empty values omitted rather than stored blank. */
export type ProductAttributes = Record<string, string | number | boolean>;

export function isProductAttributeScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Coerce anything that arrived from the API, IndexedDB or a CSV row into the bag.
 *
 * Blank strings are dropped rather than kept: "cleared" and "never filled in" are
 * the same fact about a product, and storing both spellings would make every
 * comparison — the dirty check, a conflict diff — report a change where the
 * shopkeeper made none.
 */
export function normalizeProductAttributes(input: unknown): ProductAttributes {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: ProductAttributes = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isProductAttributeScalar(value)) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      result[key] = text;
      continue;
    }
    result[key] = value;
  }
  return result;
}
