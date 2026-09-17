import { round2 } from "../../utils/money.js";

/**
 * An MRP scaled from the default pack onto the pack actually being sold.
 *
 * A product's `mrp` describes its DEFAULT pack — "₹55" on a product whose default
 * pack is a 500 g packet means ₹55 per 500 g packet. Reading that raw number as the
 * ceiling for every other pack made a bigger size unsellable at any honest price:
 * a 5 kg bag at ₹450 was rejected with "exceeds the configured maximum of Rs 55",
 * so adding a second packaging quietly broke billing for it.
 *
 * Scaling only works when both packs measure in the same base unit, which they
 * always do — conversionToBase is by definition in the product's base unit.
 */
function mrpForPack(mrp, sellingUnit, defaultSellingUnit) {
  if (!(mrp > 0)) return 0;
  if (!sellingUnit || sellingUnit.isDefault) return round2(mrp);

  const defaultConversion = Number(defaultSellingUnit?.conversionToBase ?? 0);
  const unitConversion = Number(sellingUnit.conversionToBase ?? 0);
  if (!(defaultConversion > 0) || !(unitConversion > 0)) return round2(mrp);
  if (defaultConversion === unitConversion) return round2(mrp);

  return round2((mrp / defaultConversion) * unitConversion);
}

/**
 * The buying price of ONE packaging.
 *
 * The exact counterpart of mrpForPack, and it exists for the same reason. A
 * product's `costPerRateUnit` describes its DEFAULT pack — "Rs 80" on a product
 * whose default pack is a 1 kg packet means Rs 80 per kilo. Reading that raw
 * number as the cost of every other pack made each smaller size look like a loss:
 * a 500 g packet sold at Rs 55 was booked as cost 80, so the bill reported minus
 * Rs 25 on a sale that actually earned Rs 15, and every profit report inherited it.
 *
 * An ALTERNATE pack's own `costPrice` always wins — that is what the shopkeeper
 * typed for THIS size. Blank means "work it out from the product", which is the
 * answer the product form's cost box shows as its placeholder, so the two agree.
 *
 * The DEFAULT pack is the exception, and has to be. Its `costPrice` is not an
 * independent fact but a COPY of the product's: `legacySellingUnit` derives it from
 * `costPerRateUnit`, `applyDefaultSellingUnitToProduct` copies it back, and
 * `syncDefaultSellingUnitPricing` exists only to keep the two equal. A purchase,
 * meanwhile, moves `Product.costPerRateUnit` — the weighted average every receipt
 * recomputes — and that is the number that tracks what the shop actually pays. So
 * reading the copy first costed every sale at whatever seeded the row and nothing
 * the shop had bought since: a starter-catalogue item seeded at Rs 137.95, restocked
 * at Rs 120 and sold at Rs 155 booked Rs 17.05 of profit instead of Rs 35, on the
 * line, on the bill's grossProfit and on the owner dashboard's margin tile, forever.
 * For the default pack the product's cost is therefore the answer, and the row's own
 * copy survives only as the fallback for a product carrying no cost at all.
 */
export function sellingUnitCostPrice(sellingUnit, product, defaultSellingUnit) {
  const own = round2(Number(sellingUnit?.costPrice ?? 0));
  const productCost = round2(Number(product?.costPerRateUnit ?? 0));

  if (!sellingUnit || sellingUnit.isDefault) return productCost > 0 ? productCost : own;

  if (own > 0) return own;
  if (!(productCost > 0)) return 0;

  // A restaurant portion consumes recipe stock rather than holding a pack size,
  // so scaling its conversion into a rupee cost invents a number. Same carve-out
  // sellingUnitMaxPrice makes, and for the same reason.
  if (String(sellingUnit?.unitType ?? "").trim().toLowerCase() === "portion") return productCost;

  const defaultConversion = Number(defaultSellingUnit?.conversionToBase ?? 0);
  const unitConversion = Number(sellingUnit.conversionToBase ?? 0);
  if (!(defaultConversion > 0) || !(unitConversion > 0)) return productCost;
  if (defaultConversion === unitConversion) return productCost;

  return round2((productCost / defaultConversion) * unitConversion);
}

/**
 * The price ceiling for ONE packaging.
 *
 * Without a batch MRP, the order of preference is unchanged:
 *   1. the pack's own maximumPrice — what the shopkeeper typed for THIS size,
 *   2. the product MRP scaled to this pack,
 *   3. 0, meaning nothing caps the price (same as a product with no MRP).
 *
 * `batchMrp` is the price printed on the specific batch being dispensed, and it
 * is a LEGAL ceiling rather than a preference: a pharmacy cannot sell a strip
 * above the MRP printed on it, whatever the product record or the shop's own
 * configured maximum says. So when a batch price is present the answer is the
 * lower of the two ceilings, not the first one found. Both directions matter —
 * a batch whose MRP was revised UP must not be capped at the old product price
 * either, which is why this replaces rather than merely tightens.
 *
 * Batch MRP is stored on the same basis as Product.mrp (the default pack), so it
 * goes through the identical scaling — one rule, not two.
 */
export function sellingUnitMaxPrice(sellingUnit, product, defaultSellingUnit, batchMrp) {
  const ownMax = round2(Number(sellingUnit?.maximumPrice ?? 0));

  // A restaurant portion is a menu-price row, not a packet. Its conversion is
  // how much recipe/stock one portion consumes, so applying pack or batch MRP
  // arithmetic to it creates a fake ceiling (Large 590 at factor 1.4 became
  // 588 from the dish's 420 MRP). An owner may still set an explicit ceiling.
  if (String(sellingUnit?.unitType ?? "").trim().toLowerCase() === "portion") return ownMax;

  const batchCeiling = mrpForPack(Number(batchMrp ?? 0), sellingUnit, defaultSellingUnit);

  if (batchCeiling > 0) {
    return ownMax > 0 ? round2(Math.min(ownMax, batchCeiling)) : batchCeiling;
  }
  if (ownMax > 0) return ownMax;

  return mrpForPack(Number(product?.mrp ?? 0), sellingUnit, defaultSellingUnit);
}
