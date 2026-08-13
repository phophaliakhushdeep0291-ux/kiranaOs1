/**
 * Shared engine compositions. Engines are reusable strategies, not shop types.
 * A vertical selects one composition and may add only trade-exclusive behavior.
 */
export const ENGINE_CATALOG = Object.freeze({
  RETAIL: { base: "retail", strategies: ["simple-sku", "stock-ledger"] },
  VARIANT_RETAIL: { base: "retail", strategies: ["variant-sku", "stock-ledger"] },
  FITMENT_RETAIL: { base: "retail", strategies: ["simple-sku", "vehicle-fitment", "stock-ledger"] },
  SERIALIZED_RETAIL: { base: "retail", strategies: ["variant-sku", "serialized-unit", "stock-ledger"] },
  BATCH_RETAIL: { base: "retail", strategies: ["simple-sku", "batch-expiry", "stock-ledger"] },
  ORDER_RETAIL: { base: "retail", strategies: ["variant-sku", "sales-order", "delivery"] },
  VARIANT_BATCH_RETAIL: { base: "retail", strategies: ["variant-sku", "batch-expiry", "stock-ledger"] },
  RESTAURANT: { base: "restaurant-order", strategies: ["tables", "kot", "recipe-inventory"] },
  MANUFACTURING: { base: "manufacturing", strategies: ["batch-genealogy", "bom", "production-run", "packaging-sku", "wholesale-order", "export-document", "stock-ledger"] },
  CONFIGURABLE_RETAIL: { base: "retail", strategies: ["owner-selected"] },
});

export const ENGINE_IDS = Object.freeze(Object.keys(ENGINE_CATALOG));

export function isEngineId(value) {
  return ENGINE_IDS.includes(value);
}
