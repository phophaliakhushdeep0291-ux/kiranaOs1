import { SUPPORTED_UNITS, rateUnitToBase } from "../../utils/units.js";

/**
 * How many base units are in one of a product's rate units.
 *
 * `rateUnit` is what the price is quoted per. For a loose product it is a real
 * unit — "kg", "ltr" — and the unit table converts it. For a packaged product the
 * catalogue sets it to the pack's own word — "bottle", "pack", "tray" — and the
 * unit table deliberately refuses anything it does not know, so converting through
 * it threw UNSUPPORTED_UNIT for exactly the products a kirana shop sells most.
 *
 * Found by using the app: a damage write-off on a 750 ml bottle of 7Up was accepted
 * at the till and then refused by the server, landing in sync_conflicts. The same
 * conversion sits under raising, receiving and reconciling a purchase order and
 * under a supplier return.
 *
 * Precedence, most specific first:
 *   1. the packaging the movement actually named — its conversion already produced
 *      the base quantity, so the factor has to agree with it;
 *   2. an explicit `conversionToBase` from the caller, which describes THIS
 *      movement and so outranks anything stored on the product;
 *   3. the unit table, when `rateUnit` is a real unit. This is authoritative for a
 *      loose product even if it also stocks packs: sugar sold per kg and stocked in
 *      500 g packets is still priced per kg, and reaching for the pack first would
 *      divide by 500 instead of 1000 and double every figure it touched;
 *   4. the product's default packaging, only when `rateUnit` is a pack word — which
 *      is what the sale and return paths already fall back to;
 *   5. the unit table regardless, so a genuinely unknown unit still fails loudly
 *      with the table's own message rather than being silently assumed to be 1.
 *
 * @param {object} tx  a Prisma client or transaction
 * @param {string} shopId
 * @param {{ id: string, rateUnit: string, baseUnit: string }} product
 * @param {{ conversionToBase?: number, conversion_to_base?: number }} [data]
 * @param {{ conversionToBase?: number } | null} [resolvedSellingUnit]
 */
export async function rateUnitFactor(tx, shopId, product, data = {}, resolvedSellingUnit = null) {
  const fromResolved = Number(resolvedSellingUnit?.conversionToBase ?? 0);
  if (fromResolved > 0) return fromResolved;

  const explicit = Number(data?.conversionToBase ?? data?.conversion_to_base ?? 0);
  if (explicit > 0) return explicit;

  if (isKnownUnit(product.rateUnit)) return rateUnitToBase(product.rateUnit, product.baseUnit);

  const defaultPack = await tx.productSellingUnit.findFirst({
    where: { shopId, productId: product.id, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const fromDefault = Number(defaultPack?.conversionToBase ?? 0);
  if (fromDefault > 0) return fromDefault;

  return rateUnitToBase(product.rateUnit, product.baseUnit);
}

export function isKnownUnit(unit) {
  return SUPPORTED_UNITS.includes(String(unit ?? "").trim().toLowerCase());
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
 * A line here never names its own packaging or carries an explicit conversion,
 * so precedence starts at step 3 of `rateUnitFactor`: a real unit is
 * authoritative, and only a pack word falls back to the default pack.
 *
 * @param {object} tx
 * @param {string} shopId
 * @param {Array<{ id: string, rateUnit: string, baseUnit: string }>} products
 * @returns {Promise<Map<string, number>>}
 */
export async function rateUnitFactorsFor(tx, shopId, products) {
  const factors = new Map();
  const packWorded = [];
  for (const product of products) {
    if (!product?.id || factors.has(product.id)) continue;
    if (isKnownUnit(product.rateUnit)) factors.set(product.id, rateUnitToBase(product.rateUnit, product.baseUnit));
    else packWorded.push(product);
  }
  if (packWorded.length === 0) return factors;

  const packs = await tx.productSellingUnit.findMany({
    where: { shopId, productId: { in: packWorded.map((product) => product.id) }, isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const defaultPackByProduct = new Map();
  for (const pack of packs) {
    if (!defaultPackByProduct.has(pack.productId)) defaultPackByProduct.set(pack.productId, pack);
  }
  for (const product of packWorded) {
    const conversion = Number(defaultPackByProduct.get(product.id)?.conversionToBase ?? 0);
    // No pack either: let the unit table say so in its own words, as before.
    factors.set(product.id, conversion > 0 ? conversion : rateUnitToBase(product.rateUnit, product.baseUnit));
  }
  return factors;
}
