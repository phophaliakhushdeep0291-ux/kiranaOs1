/**
 * The trade-details bag stored in Product.attributesJson.
 *
 * The server deliberately does NOT know the trade vocabulary. Which fields a
 * pharmacy or a shoe shop puts on a product is a question about the form that
 * asks for them, and it lives with that form
 * (frontend/src/features/core/products/product-attributes.ts). Mirroring the
 * catalogue here would mean two lists that must be edited together forever, and
 * the one that drifts would silently drop whatever the other had just added —
 * exactly the failure this shape is meant to avoid.
 *
 * What the server owns is the envelope: this is a flat bag of scalars, bounded
 * in count and in size, because it rides every sync push and pull. Anything the
 * app branches on — stock, price, tax, drug schedule, variant axes — is a real
 * column and is not reachable through here.
 */

/** Room for the largest trade catalogue (manufacturing, 13) several times over. */
const MAX_KEYS = 60;
const MAX_KEY_LENGTH = 48;
const MAX_TEXT_LENGTH = 500;
/** camelCase identifiers only: the keys are field ids, never user-typed prose. */
const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * A scalar the bag can hold, or undefined for anything it cannot.
 *
 * Empty strings are dropped rather than stored: "the shopkeeper cleared this
 * box" and "this field was never filled in" are the same fact, and keeping both
 * spellings would make every comparison — conflict detection, audit diffs — see
 * a change where nothing changed.
 */
function normalizeValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const text = value.trim().slice(0, MAX_TEXT_LENGTH);
    return text || undefined;
  }
  // null/undefined clear a field; objects, arrays and functions are not scalars.
  return undefined;
}

/**
 * Coerce an incoming `attributes` payload into something safe to store.
 *
 * Returns a plain object, never null: an unparseable or hostile payload is worth
 * exactly as much as an empty one, and a product save must not fail because a
 * client sent a stray field. Unknown keys are KEPT — see parseProductAttributes.
 */
export function sanitizeProductAttributes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (Object.keys(result).length >= MAX_KEYS) break;
    const key = String(rawKey).trim();
    if (key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) continue;
    const value = normalizeValue(rawValue);
    if (value === undefined) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Read the stored column back.
 *
 * A product whose attributes JSON is damaged is a product with no trade details,
 * not a 500 on the catalogue — the same rule parseVariantAxes follows, and for
 * the same reason: one bad row must not take the shop's product list down.
 */
export function parseProductAttributes(json) {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return sanitizeProductAttributes(parsed);
  } catch {
    return {};
  }
}

/**
 * What to write when an edit arrives.
 *
 * A merge, not a replacement, and this is the load-bearing decision. The product
 * form only ever renders the CURRENT trade's fields, so its payload names only
 * those. Replacing the bag would mean a shop that switched from pharmacy to
 * kirana lost every composition and dosage form the moment anyone re-saved a
 * medicine — and switching back would show empty boxes with no way to tell that
 * the data had ever existed.
 *
 * An explicit null or empty string clears one key, which is how the form deletes
 * a value it no longer wants. Passing an empty object therefore changes nothing,
 * which is also what a client that does not know about this field should do.
 */
export function mergeProductAttributes(existingJson, incoming) {
  const existing = parseProductAttributes(existingJson);
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return existing;
  const merged = { ...existing };
  for (const [rawKey, rawValue] of Object.entries(incoming)) {
    const key = String(rawKey).trim();
    if (key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) continue;
    const value = normalizeValue(rawValue);
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return sanitizeProductAttributes(merged);
}

export const PRODUCT_ATTRIBUTE_LIMITS = Object.freeze({
  maxKeys: MAX_KEYS,
  maxKeyLength: MAX_KEY_LENGTH,
  maxTextLength: MAX_TEXT_LENGTH,
});
