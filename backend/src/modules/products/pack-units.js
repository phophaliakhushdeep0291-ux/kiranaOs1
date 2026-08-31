/**
 * How many base units are in one pack.
 *
 * The till has always known this — frontend/src/features/core/products/pages/
 * product-pricing.ts holds the same table, because the product form computes a
 * pack's conversion before it ever reaches the server. Nothing on this side did,
 * so anything server-side wanting to build a selling unit had no way to work out
 * that a 500 gram packet is 500 base units.
 *
 * The two tables must agree. They are pinned to each other by a test that reads
 * the frontend file, because a silent divergence here does not throw: it writes
 * a plausible-looking pack whose sales take the wrong quantity off the shelf,
 * and the shop finds out at stock count weeks later.
 *
 * `stock moved = quantity sold x conversionToBase` — the same equation the
 * assurance rule BILL_UNIT_CONVERSION_MISMATCH audits after the fact.
 */
export const UNIT_FACTOR_TO_BASE = Object.freeze({
  kg: 1000, gram: 1, g: 1,
  litre: 1000, liter: 1000, ltr: 1000, l: 1000, ml: 1,
  piece: 1, packet: 1, pack: 1, pouch: 1, box: 1, carton: 1,
  bottle: 1, jar: 1, can: 1, sachet: 1,
  dozen: 12, bundle: 1, roll: 1, sheet: 1,
  set: 1, pair: 1,
  meter: 1, yard: 1,
  strip: 1, tablet: 1, tube: 1,
  plate: 1, glass: 1,
  custom: 1,
});

/** Which measure a unit ultimately counts in: kg and gram both settle on gram. */
export const UNIT_TO_BASE_UNIT = Object.freeze({
  kg: "gram", gram: "gram", g: "gram",
  litre: "ml", liter: "ml", ltr: "ml", l: "ml", ml: "ml",
  piece: "piece", packet: "piece", pack: "piece", pouch: "piece", box: "piece", carton: "piece",
  bottle: "piece", jar: "piece", can: "piece", sachet: "piece",
  dozen: "piece", bundle: "bundle", roll: "roll", sheet: "sheet",
  set: "set", pair: "pair",
  meter: "meter", yard: "yard",
  strip: "strip", tablet: "tablet", tube: "tube",
  plate: "plate", glass: "glass",
  custom: "custom",
});

export function normalisePackUnit(unit) {
  return String(unit ?? "").trim().toLowerCase();
}

/**
 * Whether the pack maths actually knows this measure.
 *
 * Worth asking, because the conversion itself does not fail loudly on an unknown
 * unit — it falls back to a factor of 1, which is right for a trade unit nobody
 * tabulated and catastrophic for a typo. The form's own dropdown can skip this
 * check; anything taking free text cannot. "500 gm" unchecked builds a
 * 500-PIECE pack, and a single sale of it takes 500 off the shelf.
 */
export function isKnownPackUnit(unit) {
  return Object.hasOwn(UNIT_FACTOR_TO_BASE, normalisePackUnit(unit));
}

export function knownPackUnits() {
  return Object.keys(UNIT_FACTOR_TO_BASE);
}

export function baseUnitFor(unit) {
  const key = normalisePackUnit(unit);
  return UNIT_TO_BASE_UNIT[key] ?? key ?? "piece";
}

/** Base units in one pack of `packSizeValue` `packSizeUnit`. */
export function sellingUnitConversion(packSizeValue, packSizeUnit) {
  const factor = UNIT_FACTOR_TO_BASE[normalisePackUnit(packSizeUnit)] ?? 1;
  return Math.round(Number(packSizeValue || 0) * factor * 100) / 100;
}
