import { toPaise, subtractMoney } from "./money.js";
import { allocateAmountByWeights } from "./gst.js";

/** Historical return rows store tax on the invoice, not on each line. Keep the
 * reconstructed line budgets equal to that exact unreturned invoice tax. */
export function reconcileReturnTaxBalances(balances, remainingGst) {
  const open = balances.map((line) => roundReturnQuantity(line.soldQuantity - line.returnedQuantity) > 0);
  const weights = balances.map((line, index) => open[index] ? Math.max(0, subtractMoney(line.gst, line.returnedGst)) : 0);
  const fallback = balances.map((line, index) => open[index] ? Math.max(0, subtractMoney(line.subtotal, line.returnedSubtotal)) : 0);
  const allocation = allocateAmountByWeights(weights.some((value) => value > 0) ? weights
    : fallback.some((value) => value > 0) ? fallback : open.map((value) => value ? 1 : 0), remainingGst);
  balances.forEach((line, index) => { line.gst = (toPaise(line.returnedGst) + toPaise(allocation[index])) / 100; });
}

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
