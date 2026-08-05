/**
 * Shoe size systems.
 *
 * A garment size chart cannot express this: "8" is three different shoes in UK,
 * EU and US, and a UK 6 women's is not a UK 6 men's — the lasts differ. A shop
 * stocking both Indian brands (UK numbering) and imports has to convert at the
 * counter, from a customer who only knows one of the numbers.
 *
 * HOW ACCURATE THIS IS. Conversion is genuinely brand-dependent — a Nike 9 and a
 * Bata 9 are not the same shoe — so nothing here is exact and the UI says so.
 * These are the mainstream retail equivalences, laid out as an explicit anchor
 * table rather than arithmetic so the approximations stay visible and editable.
 * A formula would hide the fact that EU sizing is not linear against UK.
 *
 * India uses UK numbering, so it is not a separate system.
 */

export const SIZE_SYSTEMS = ["uk", "us", "eu", "cm"];
export const SIZE_GENDERS = ["mens", "womens", "kids", "unisex"];

export const SIZE_SYSTEM_LABELS = { uk: "UK / India", us: "US", eu: "EU", cm: "CM" };

/**
 * One row per physical shoe, in the order the systems are listed above.
 *
 * Rows are ordered small to large; that ordering is load-bearing, because it is
 * what makes a size run sortable when the values are text like "8½".
 */
const MENS = [
  ["3", "4", "36", "22"],
  ["4", "5", "37", "23"],
  ["5", "6", "38", "23.5"],
  ["6", "7", "39", "24.5"],
  ["7", "8", "41", "25.5"],
  ["8", "9", "42", "26.5"],
  ["9", "10", "43", "27.5"],
  ["10", "11", "44.5", "28.5"],
  ["11", "12", "46", "29.5"],
  ["12", "13", "47", "30.5"],
  ["13", "14", "48", "31.5"],
];

const WOMENS = [
  ["2", "4", "34", "21"],
  ["3", "5", "35", "22"],
  ["4", "6", "36", "22.5"],
  ["5", "7", "37", "23.5"],
  ["6", "8", "38", "24"],
  ["7", "9", "39", "25"],
  ["8", "10", "40", "25.5"],
  ["9", "11", "41", "26.5"],
];

/**
 * Kids is deliberately absent.
 *
 * Children's sizing splits into infant and junior scales that restart at 1, and
 * the mapping varies so widely by brand that any table here would be invented
 * rather than approximated. A shop is better served by "we can't convert this"
 * than by a confident wrong answer about a child's shoe.
 */
const TABLES = { mens: MENS, womens: WOMENS, unisex: MENS };

function normalize(value) {
  // "UK 8", "8.0", "8 " and "8" are the same size off a box.
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(uk|us|eu|cm)\s*/, "")
    .replace(/\s+/g, "")
    .replace(/(\.0+|½)$/, (match) => (match === "½" ? ".5" : ""));
}

export function normalizeSystem(system) {
  const key = String(system ?? "").trim().toLowerCase();
  return SIZE_SYSTEMS.includes(key) ? key : null;
}

export function normalizeGender(gender) {
  const key = String(gender ?? "").trim().toLowerCase();
  return SIZE_GENDERS.includes(key) ? key : "unisex";
}

/** Whether a conversion table exists at all for this wearer. */
export function canConvert(gender) {
  return Boolean(TABLES[normalizeGender(gender)]);
}

/**
 * Every equivalent of one size.
 *
 * Returns null when the size is not on the chart, rather than guessing by
 * interpolation: a half-size that no maker produces is not a useful answer, and
 * an invented EU 45.5 sends someone to a shelf that has never held one.
 */
export function convertSize(system, value, gender = "unisex") {
  const from = normalizeSystem(system);
  const table = TABLES[normalizeGender(gender)];
  if (!from || !table) return null;

  const wanted = normalize(value);
  if (!wanted) return null;

  const column = SIZE_SYSTEMS.indexOf(from);
  const row = table.find((entry) => normalize(entry[column]) === wanted);
  if (!row) return null;

  return {
    gender: normalizeGender(gender),
    uk: row[0],
    us: row[1],
    eu: row[2],
    cm: row[3],
  };
}

/** The full ladder for a wearer, smallest first — what a size-run grid is drawn against. */
export function sizeLadder(system, gender = "unisex") {
  const key = normalizeSystem(system);
  const table = TABLES[normalizeGender(gender)];
  if (!key || !table) return [];
  return table.map((row) => row[SIZE_SYSTEMS.indexOf(key)]);
}

/**
 * Where a size sits on the ladder, for sorting a run.
 *
 * Sizes are stored as text on a variant, so "10" sorts before "9" alphabetically
 * and a run would read 10, 11, 6, 7, 8, 9. Ranking against the chart fixes that
 * for known sizes; anything off the chart falls back to its numeric value, and
 * anything not numeric at all sorts last rather than scrambling the row.
 */
export function sizeRank(system, value, gender = "unisex") {
  const key = normalizeSystem(system);
  const table = TABLES[normalizeGender(gender)];
  const wanted = normalize(value);

  if (key && table) {
    const column = SIZE_SYSTEMS.indexOf(key);
    const index = table.findIndex((row) => normalize(row[column]) === wanted);
    if (index !== -1) return index;
  }

  const numeric = Number.parseFloat(wanted);
  // Off-chart numerics keep their order relative to each other but stay clear of
  // the charted block, so a stray "14" still lands after a charted "13".
  return Number.isFinite(numeric) ? 1000 + numeric : Number.MAX_SAFE_INTEGER;
}

/** Sorts a shop's own size values into the order a customer reads them. */
export function sortSizes(values, system, gender = "unisex") {
  return [...values].sort((a, b) => {
    const rank = sizeRank(system, a, gender) - sizeRank(system, b, gender);
    return rank !== 0 ? rank : String(a).localeCompare(String(b));
  });
}
