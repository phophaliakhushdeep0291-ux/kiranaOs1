import assert from "node:assert/strict";
import {
  clearProductKnowledgeCache,
  lookupProductKnowledge,
  mapOpenFoodFactsProduct,
  normalizeKnowledgeBarcode,
} from "../src/modules/products/product-knowledge.service.js";

assert.equal(normalizeKnowledgeBarcode(" 8901234567890 "), "8901234567890");
assert.equal(normalizeKnowledgeBarcode("internal-sku"), null);

const mapped = mapOpenFoodFactsProduct("8901234567890", {
  product: {
    product_name_en: "Parle-G Original",
    product_name_hi: "पारले जी",
    brands: "Parle",
    categories_tags: ["en:biscuits"],
    quantity: "800 g",
    generic_name_en: "Glucose biscuits",
    image_front_url: "https://images.openfoodfacts.org/images/products/890/123/456/7890/front_en.jpg",
  },
});
assert.deepEqual(mapped, {
  found: true,
  barcode: "8901234567890",
  name: "Parle-G Original",
  brand: "Parle",
  category: "Biscuits",
  unit: "packet",
  packSizeValue: 800,
  packSizeUnit: "g",
  aliases: ["पारले जी", "Glucose biscuits"],
  description: "Glucose biscuits",
  imageUrl: "https://images.openfoodfacts.org/images/products/890/123/456/7890/front_en.jpg",
  source: "Open Food Facts",
});

assert.equal(mapOpenFoodFactsProduct("8901234567890", { product: { product_name: "" } }), null);
assert.equal(mapOpenFoodFactsProduct("8901234567890", { product: { product_name: "Unsafe", image_url: "http://evil.example/item.jpg" } }).imageUrl, null);

clearProductKnowledgeCache();
let calls = 0;
const fetchImpl = async () => {
  calls += 1;
  return { ok: true, json: async () => ({ product: { product_name: "Known item", quantity: "1 kg" } }) };
};
const first = await lookupProductKnowledge("8901234567890", { fetchImpl, now: 1_000 });
const second = await lookupProductKnowledge("8901234567890", { fetchImpl, now: 2_000 });
assert.equal(first.found, true);
assert.deepEqual(second, first);
assert.equal(calls, 1, "shared lookup cache must avoid one vendor request per shop scan");

console.log("Product knowledge lookup examples passed");
