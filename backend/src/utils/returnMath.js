import { toPaise, subtractMoney } from "./money.js";

export function roundReturnQuantity(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Repeated partial refunds cannot consume more money than the original line. */
export function takeReturnAmount(full, returned, requestedQuantity, soldQuantity, finalReturn) {
  const remaining = Math.max(0, subtractMoney(full, returned));
  if (finalReturn) return remaining;
  const units = BigInt(Math.round(requestedQuantity * 1000));
  const sold = BigInt(Math.max(1, Math.round(soldQuantity * 1000)));
  const numerator = BigInt(toPaise(full)) * units;
  const allocated = Number((2n * numerator + sold) / (2n * sold)) / 100;
  return Math.min(remaining, allocated);
}
