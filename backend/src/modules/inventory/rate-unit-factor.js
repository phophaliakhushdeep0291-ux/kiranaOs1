import { rateUnitToBase } from "../../utils/units.js";

/**
 * How many base units are in one of a product's rate units.
 *
 * `rateUnit` is what the price and the cost are quoted per. For a loose product it
 * is a measure — "kg", "ltr" — and the unit table converts it. For a packaged
 * product it is the pack's own word — the product service copies the default
 * pack's type into it — and only the pack knows its size. The unit table either
 * refuses the word ("bottle"), which threw UNSUPPORTED_UNIT for exactly the
 * products a kirana shop sells most, or knows it as a count of 1 ("packet", "box"),
 * which over a base unit of grams says a 5 kg packet of atta weighs 1 g. That is
 * the shape of 395 of the starter catalogue's 560 products.
 *
 * Found by using the app: a damage write-off on a 750 ml bottle of 7Up was accepted
 * at the till and then refused by the server, landing in sync_conflicts. The same
 * conversion sits under raising, receiving and reconciling a purchase order and
 * under a supplier return.
 *
 * Precedence:
 *   1. the unit table, when the rate unit is a measure of the base unit's own kind
 *      — kg over g, ltr over ml, dozen over piece — or the base unit itself. This
 *      is authoritative for a loose product even if it also stocks packs: sugar
 *      sold per kg and stocked in 500 g packets is still priced per kg, and
 *      reaching for the pack first would divide by 500 instead of 1000 and double
 *      every figure it touched;
 *   2. the product's default packaging, for any other rate unit — the rate unit is
 *      that pack;
 *   3. an explicit `conversionToBase` from the caller, for a product with no
 *      packaging to consult;
 *   4. the unit table regardless, so a genuinely unknown unit still fails loudly
 *      with the table's own message rather than being silently assumed to be 1.
 *
 * The packaging a movement names never sizes the rate unit. It says how many base
 * units moved, which the caller has already worked out; the cost is still per
 * bottle. Letting it outrank the rate unit booked a crate of 24 bottles as one —
 * and the stock-in screen sends the SELECTED pack's conversion, so receiving
 * crates priced each bottle at the price of a crate.
 *
 * @param {object} tx  a Prisma client or transaction
 * @param {string} shopId
 * @param {{ id: string, rateUnit: string, baseUnit: string }} product
 * @param {{ conversionToBase?: number, conversion_to_base?: number }} [data]
 */
export async function rateUnitFactor(tx, shopId, product, data = {}) {
  const measured = measureFactor(product);
  if (measured !== null) return measured;

  const defaultPack = await tx.productSellingUnit.findFirst({
    where: { shopId, productId: product.id, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const fromDefault = Number(defaultPack?.conversionToBase ?? 0);
  if (fromDefault > 0) return fromDefault;

  const explicit = Number(data?.conversionToBase ?? data?.conversion_to_base ?? 0);
  if (explicit > 0) return explicit;

  return rateUnitToBase(product.rateUnit, product.baseUnit);
}

// Units whose size is fixed, by what they measure. The unit table also lists
// "packet" and "box", as a count of 1 — but how much a packet holds belongs to the
// product, so those are sized by its packaging like any other pack word.
const MEASURE_KIND = Object.freeze({
  kg: "weight", g: "weight", gram: "weight", grams: "weight",
  ltr: "volume", litre: "volume", liter: "volume", l: "volume", ml: "volume",
  piece: "count", pieces: "count", pcs: "count", pc: "count", dozen: "count",
});

const unitWord = (unit) => String(unit ?? "").trim().toLowerCase();

/** Step 1 of `rateUnitFactor`: the factor when the rate unit is a measure, else null. */
function measureFactor(product) {
  const rate = unitWord(product.rateUnit);
  const base = unitWord(product.baseUnit);
  if (rate && rate === base) return 1;
  const kind = MEASURE_KIND[rate];
  return kind && kind === MEASURE_KIND[base] ? rateUnitToBase(rate, base) : null;
}

/**
 * `rateUnitFactor` for every line of a document at once, keyed by product id.
 *
 * Purchase orders, receipts and supplier returns value their lines inside a
 * synchronous `.map`, and hit the same wall: a line's `rateUnit` is snapshotted
 * from the product, so for 7Up it is "bottle". Resolving the factors up front —
 * with one query for every pack-word product rather than one per line — keeps
 * those maps synchronous and the document to a single round trip.
 *
 * A line here carries no explicit conversion, so this is `rateUnitFactor` without
 * its step 3: the unit table for a measure of the base unit's kind, the default
 * pack for anything else.
 *
 * @param {object} tx
 * @param {string} shopId
 * @param {Array<{ id: string, rateUnit: string, baseUnit: string }>} products
 * @returns {Promise<Map<string, number>>}
 */
export async function rateUnitFactorsFor(tx, shopId, products) {
  const factors = await resolveRateUnitFactors(tx, shopId, products);
  for (const factor of factors.values()) {
    if (factor instanceof Error) throw factor;
  }
  return factors;
}

/**
 * `rateUnitFactorsFor` for a caller that values many products at once and must
 * keep going past one it cannot convert: an audit finding, an export, a recipe
 * card. Each of those used to catch the unit table's error around its own
 * conversion — which is how a pack word came to be priced at a factor of 1, or
 * at nothing — and each still decides for itself what an unconvertible product
 * is worth. Such a product is simply absent from the map: a word the table does
 * not know, with no packaging to fall back on.
 *
 * @param {object} tx
 * @param {string} shopId
 * @param {Array<{ id: string, rateUnit: string, baseUnit: string }>} products
 * @returns {Promise<Map<string, number>>}
 */
export async function convertibleRateUnitFactorsFor(tx, shopId, products) {
  const factors = await resolveRateUnitFactors(tx, shopId, products);
  for (const [productId, factor] of factors) {
    if (factor instanceof Error) factors.delete(productId);
  }
  return factors;
}

// Each product's factor, or the unit table's own error for one that has none —
// so the strict and the forgiving caller share one set of rules.
async function resolveRateUnitFactors(tx, shopId, products) {
  const factors = new Map();
  const sizedByPack = [];
  for (const product of products) {
    if (!product?.id || factors.has(product.id)) continue;
    const measured = measureFactor(product);
    if (measured !== null) factors.set(product.id, measured);
    else sizedByPack.push(product);
  }
  if (sizedByPack.length === 0) return factors;

  const packs = await tx.productSellingUnit.findMany({
    where: { shopId, productId: { in: sizedByPack.map((product) => product.id) }, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const defaultPackByProduct = new Map();
  for (const pack of packs) {
    if (!defaultPackByProduct.has(pack.productId)) defaultPackByProduct.set(pack.productId, pack);
  }
  for (const product of sizedByPack) {
    const conversion = Number(defaultPackByProduct.get(product.id)?.conversionToBase ?? 0);
    // No pack either: let the unit table say so in its own words, as before.
    factors.set(product.id, conversion > 0 ? conversion : unitTableFactor(product));
  }
  return factors;
}

function unitTableFactor(product) {
  try {
    return rateUnitToBase(product.rateUnit, product.baseUnit);
  } catch (error) {
    return error;
  }
}
