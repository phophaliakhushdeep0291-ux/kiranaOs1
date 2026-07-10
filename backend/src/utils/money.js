const PAISE_PER_RUPEE = 100;

/**
 * Ensure money helpers only receive finite numbers.
 * Keeping this central makes money bugs fail loudly during development/tests.
 */
export function assertFiniteMoney(value, fieldName = "money") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${fieldName} must be a finite number`);
  }
  return value;
}

/**
 * Convert a rupee amount to integer paise for safe comparisons/sums.
 * This is an in-memory helper only; DB columns remain Float for now.
 */
export function toPaise(value) {
  return Math.round(assertFiniteMoney(value) * PAISE_PER_RUPEE);
}

/** Convert integer paise back to rupees. */
export function fromPaise(paise) {
  if (typeof paise !== "number" || !Number.isFinite(paise)) {
    throw new TypeError("paise must be a finite number");
  }
  return paise / PAISE_PER_RUPEE;
}

/**
 * Round a number to 2 decimal places through integer paise.
 */
export function round2(value) {
  return fromPaise(toPaise(value));
}

/** Sum money values through integer paise to avoid floating drift. */
export function sumMoney(values) {
  return fromPaise(values.reduce((totalPaise, value) => totalPaise + toPaise(value), 0));
}

/** Add one or more money values through integer paise. */
export function addMoney(...values) {
  return sumMoney(values);
}

/** Subtract one or more money values from a starting amount through integer paise. */
export function subtractMoney(start, ...values) {
  return fromPaise(values.reduce((totalPaise, value) => totalPaise - toPaise(value), toPaise(start)));
}

/** Multiply money by a quantity/rate and round once to paise. */
export function multiplyMoney(amount, multiplier) {
  assertFiniteMoney(amount, "amount");
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) {
    throw new TypeError("multiplier must be a finite number");
  }
  return round2(amount * multiplier);
}

/** Compare money values by integer paise, not raw floating point numbers. */
export function moneyEquals(a, b) {
  return toPaise(a) === toPaise(b);
}

/**
 * Calculate weighted average cost after adding new stock.
 *
 * @param {number} currentQty   - existing stock in baseUnit
 * @param {number} currentCost  - existing weighted avg cost per rateUnit
 * @param {number} newQty       - new stock being added in baseUnit
 * @param {number} newCost      - new cost per rateUnit
 * @returns {number} new weighted average cost per rateUnit
 */
export function weightedAvgCost(currentQty, currentCost, newQty, newCost) {
  // Overselling is allowed, so on-hand stock can be negative (and cost can be
  // unset/0). A weighted average against non-positive stock or cost is
  // undefined and can produce absurd values (e.g. -10000g @40 + 10001g @50
  // averages to ₹100,050/kg), silently poisoning every later profit figure.
  // Convention: the fresh purchase price becomes the cost.
  if (!(currentQty > 0) || !(currentCost > 0)) return round2(newCost);
  const totalQty = currentQty + newQty;
  if (totalQty <= 0) return round2(newCost);
  return round2((currentQty * currentCost + newQty * newCost) / totalQty);
}


/** Convert a rupee amount to BigInt paise for Prisma BigInt shadow columns. */
export function toPaiseBigInt(value) {
  return BigInt(toPaise(value));
}

/** Build one Prisma data field for a rupee Float + matching Paise shadow column. */
export function moneyShadow(fieldName, value) {
  if (value === undefined || value === null) return {};
  return { [`${fieldName}Paise`]: toPaiseBigInt(value) };
}

/** Build Prisma data fields for multiple rupee Float values. */
export function moneyShadows(valuesByField) {
  return Object.entries(valuesByField || {}).reduce((acc, [fieldName, value]) => {
    Object.assign(acc, moneyShadow(fieldName, value));
    return acc;
  }, {});
}
