/**
 * Unit conversion factors to base unit.
 * Base units: g (for weight), ml (for volume), piece/packet (count).
 *
 * Production rule: unknown units are rejected instead of silently assuming 1.
 * A silent fallback corrupts stock and profit, so unsupported units must be added
 * here intentionally before the frontend sends them.
 */
const CONVERSION = Object.freeze({
  // Weight
  kg: 1000,
  g: 1,
  gram: 1,
  grams: 1,
  // Volume
  ltr: 1000,
  litre: 1000,
  liter: 1000,
  l: 1000,
  ml: 1,
  // Count
  piece: 1,
  pieces: 1,
  pcs: 1,
  pc: 1,
  packet: 1,
  packets: 1,
  pkt: 1,
  dozen: 12,
  box: 1,
});

export const SUPPORTED_UNITS = Object.freeze(Object.keys(CONVERSION));

function normalizeUnit(unit, fieldName) {
  const value = String(unit ?? "").trim().toLowerCase();
  if (!value) throw new Error(`${fieldName} is required`);
  if (!Object.prototype.hasOwnProperty.call(CONVERSION, value)) {
    const err = new Error(`Unsupported unit "${unit}". Supported units: ${SUPPORTED_UNITS.join(", ")}`);
    err.code = "UNSUPPORTED_UNIT";
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function factorFor(unit, fieldName) {
  return CONVERSION[normalizeUnit(unit, fieldName)];
}

/**
 * Convert a quantity in enteredUnit to baseUnit quantity.
 * e.g. toBaseQty(2, "kg", "g") → 2000
 */
export function toBaseQty(qty, fromUnit, baseUnit) {
  const from = factorFor(fromUnit, "enteredUnit");
  const base = factorFor(baseUnit, "baseUnit");
  return (qty * from) / base;
}

/**
 * Convert baseQty back to displayUnit for showing to user.
 * e.g. fromBaseQty(2000, "g", "kg") → 2
 */
export function fromBaseQty(baseQty, baseUnit, displayUnit) {
  const base = factorFor(baseUnit, "baseUnit");
  const disp = factorFor(displayUnit, "displayUnit");
  return (baseQty * base) / disp;
}

/**
 * Conversion factor between rateUnit and baseUnit.
 * Used to calculate per-rateUnit cost from a base quantity.
 * e.g. rateUnitToBase("kg", "g") → 1000
 */
export function rateUnitToBase(rateUnit, baseUnit) {
  const rate = factorFor(rateUnit, "rateUnit");
  const base = factorFor(baseUnit, "baseUnit");
  return rate / base;
}

/**
 * Convert quantity already stored in a product's base unit into the product's rate unit.
 * This is the safe quantity to multiply by ratePerRateUnit/costPerRateUnit.
 * e.g. baseQtyToRateQty(500, "kg", "g") → 0.5
 */
export function baseQtyToRateQty(baseQty, rateUnit, baseUnit) {
  const factor = rateUnitToBase(rateUnit, baseUnit);
  return baseQty / factor;
}
