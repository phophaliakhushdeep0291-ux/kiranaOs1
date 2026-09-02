/**
 * Stable audit values written to stock movements.
 *
 * Keep these independent from translated labels: changing the counter language
 * must not change reconciliation, exports, or the meaning of historical rows.
 */
export const STOCK_OUT_REASON = {
  counter: "Counter stock out",
  expiry: "Expiry",
  damage: "Damage",
  missing: "Theft / Missing",
  other: "Other",
} as const;

