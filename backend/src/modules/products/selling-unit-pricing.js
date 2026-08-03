import { round2 } from "../../utils/money.js";

/**
 * The price ceiling for ONE packaging.
 *
 * A product's `mrp` describes its DEFAULT pack — "₹55" on a product whose default
 * pack is a 500 g packet means ₹55 per 500 g packet. Reading that raw number as the
 * ceiling for every other pack made a bigger size unsellable at any honest price:
 * a 5 kg bag at ₹450 was rejected with "exceeds the configured maximum of Rs 55",
 * so adding a second packaging quietly broke billing for it.
 *
 * Order of preference:
 *   1. the pack's own maximumPrice — what the shopkeeper typed for THIS size,
 *   2. the product MRP scaled by how much bigger this pack is than the default,
 *   3. 0, meaning nothing caps the price (same as a product with no MRP today).
 *
 * Scaling only works when both packs measure in the same base unit, which they
 * always do — conversionToBase is by definition in the product's base unit.
 */
export function sellingUnitMaxPrice(sellingUnit, product, defaultSellingUnit) {
  const ownMax = Number(sellingUnit?.maximumPrice ?? 0);
  if (ownMax > 0) return round2(ownMax);

  const productMrp = Number(product?.mrp ?? 0);
  if (!(productMrp > 0)) return 0;
  if (!sellingUnit || sellingUnit.isDefault) return round2(productMrp);

  const defaultConversion = Number(defaultSellingUnit?.conversionToBase ?? 0);
  const unitConversion = Number(sellingUnit.conversionToBase ?? 0);
  if (!(defaultConversion > 0) || !(unitConversion > 0)) return round2(productMrp);
  if (defaultConversion === unitConversion) return round2(productMrp);

  return round2((productMrp / defaultConversion) * unitConversion);
}
