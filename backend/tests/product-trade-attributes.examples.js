import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_ATTRIBUTE_LIMITS,
  mergeProductAttributes,
  parseProductAttributes,
  sanitizeProductAttributes,
} from "../src/modules/products/product-attributes.js";
import { createProductSchema, updateProductSchema } from "../src/modules/products/products.schema.js";

/**
 * The trade-details bag on a product: a chemist's salt, a garment shop's fabric,
 * a parts shop's OEM number. The server holds the envelope and not the
 * vocabulary, so what is worth testing here is the envelope — that it cannot be
 * used as arbitrary storage, that a damaged row does not take the catalogue
 * down, and above all that a write MERGES.
 *
 * The merge is the one that matters. The product form only ever renders the
 * fields of the shop's CURRENT trade, so its payload only ever names those. A
 * replace would mean a shop that switched business type lost every detail the
 * previous trade recorded, the first time anyone re-saved a product — silently,
 * with the form showing empty boxes as if nothing had ever been there.
 */

test("keeps scalars and drops everything that is not one", () => {
  assert.deepEqual(
    sanitizeProductAttributes({
      composition: "Paracetamol 500 mg",
      unitsPerStrip: 10,
      coldChain: false,
      nested: { a: 1 },
      list: ["a"],
      fn: null,
      notANumber: Number.NaN,
    }),
    { composition: "Paracetamol 500 mg", unitsPerStrip: 10, coldChain: false },
  );
});

test("an empty string is not stored, because cleared and never-filled are one fact", () => {
  // Keeping both spellings would make every comparison — the audit diff, the
  // conflict check — report a change the shopkeeper never made.
  assert.deepEqual(sanitizeProductAttributes({ fabric: "   ", fit: " Slim " }), { fit: "Slim" });
});

test("rejects keys that are not plain identifiers", () => {
  const result = sanitizeProductAttributes({
    goodKey: "yes",
    "bad key": "no",
    "__proto__": "no",
    "9lives": "no",
    "drop; table": "no",
  });
  assert.deepEqual(Object.keys(result), ["goodKey"]);
});

test("bounds what one product can carry, so the bag cannot become a filesystem", () => {
  const many = {};
  for (let index = 0; index < PRODUCT_ATTRIBUTE_LIMITS.maxKeys + 25; index += 1) many[`key${index}`] = "x";
  assert.equal(Object.keys(sanitizeProductAttributes(many)).length, PRODUCT_ATTRIBUTE_LIMITS.maxKeys);

  const long = sanitizeProductAttributes({ notes: "a".repeat(PRODUCT_ATTRIBUTE_LIMITS.maxTextLength + 400) });
  assert.equal(long.notes.length, PRODUCT_ATTRIBUTE_LIMITS.maxTextLength);
});

test("a damaged column reads as no details, never as an exception", () => {
  // One bad row must not take down the shop's product list.
  assert.deepEqual(parseProductAttributes("{not json"), {});
  assert.deepEqual(parseProductAttributes(null), {});
  assert.deepEqual(parseProductAttributes("[1,2,3]"), {});
  assert.deepEqual(parseProductAttributes('{"fabric":"Cotton"}'), { fabric: "Cotton" });
});

test("a write merges, so another trade's details survive a re-save", () => {
  const stored = JSON.stringify({ composition: "Paracetamol 500 mg", dosageForm: "Tablet" });
  // The shop is now a kirana. Its form names only kirana fields.
  const merged = mergeProductAttributes(stored, { storage: "Chilled", rack: "A3" });

  assert.deepEqual(merged, {
    composition: "Paracetamol 500 mg",
    dosageForm: "Tablet",
    storage: "Chilled",
    rack: "A3",
  });
});

test("a named key with no value is a deliberate clear", () => {
  const stored = JSON.stringify({ fabric: "Cotton", fit: "Slim" });
  assert.deepEqual(mergeProductAttributes(stored, { fabric: "" }), { fit: "Slim" });
  assert.deepEqual(mergeProductAttributes(stored, { fit: null }), { fabric: "Cotton" });
});

test("an empty payload changes nothing, which is what an older client should do", () => {
  const stored = JSON.stringify({ fabric: "Cotton" });
  assert.deepEqual(mergeProductAttributes(stored, {}), { fabric: "Cotton" });
  assert.deepEqual(mergeProductAttributes(stored, undefined), { fabric: "Cotton" });
  assert.deepEqual(mergeProductAttributes(stored, "nonsense"), { fabric: "Cotton" });
});

test("one unusable value does not reject the whole product", () => {
  // A typed union in the schema did exactly that: a single non-scalar turned an
  // otherwise perfect save into "Validation failed: attributes", and on the sync
  // path into an event that could never be applied. The value is dropped by the
  // sanitizer instead — the product is worth more than the stray field.
  const parsed = createProductSchema.parse({
    name: "Paracetamol 500 mg",
    defaultPricePerRateUnit: 12,
    attributes: { composition: "Paracetamol 500 mg", nested: { rejected: true } },
  });
  assert.deepEqual(sanitizeProductAttributes(parsed.attributes), { composition: "Paracetamol 500 mg" });
});

test("a whole-record payload may state the field as null", () => {
  // Conflict resolution and sync echoes send every column, empty ones as null.
  // `.optional()` alone rejects that, which is how a snapshot becomes unappliable.
  assert.doesNotThrow(() => updateProductSchema.parse({ name: "X", attributes: null }));
  assert.doesNotThrow(() => updateProductSchema.parse({ name: "X" }));
});

test("false is a value, not an absence", () => {
  // `coldChain: false` is the shop saying this medicine does NOT need a fridge.
  // Treating it as empty would erase an answer and leave the question open.
  const merged = mergeProductAttributes(JSON.stringify({ coldChain: true }), { coldChain: false });
  assert.equal(merged.coldChain, false);
});
