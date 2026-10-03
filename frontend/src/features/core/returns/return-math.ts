import { allocateAmountByWeights, allocateInvoiceDiscount, gstLineAmounts, type GstMode } from "@/lib/gst";
import { roundMoney, toPaise } from "@/lib/money";

const roundQuantity = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

export interface OriginalReturnLine {
  id: string;
  quantity: number;
  lineTotal: number;
  lineDiscount: number;
  lineCost: number;
  gstRate: number;
}

export interface PreviousReturnLine {
  originalBillItemId?: string | null;
  quantity: number;
  lineTotal: number;
  lineDiscount: number;
  lineCost: number;
  gstRate: number;
}

export interface PreviousReturnRecord {
  gst: number;
  gstMode: GstMode;
  items: PreviousReturnLine[];
}

export interface ReturnLineBalance {
  soldQuantity: number;
  gross: number;
  subtotal: number;
  gst: number;
  cost: number;
  returnedQuantity: number;
  returnedGross: number;
  returnedSubtotal: number;
  returnedGst: number;
  returnedCost: number;
}

/** Invoice tax is authoritative when historical returns lack per-line tax. A
 * fully returned line cannot retain tax for a later refund to consume. */
export function reconcileReturnTaxBalances(balances: ReturnLineBalance[], remainingGst: number): void {
  const open = balances.map((line) => roundQuantity(line.soldQuantity - line.returnedQuantity) > 0);
  const weights = balances.map((line, index) => open[index] ? Math.max(0, roundMoney(line.gst - line.returnedGst)) : 0);
  const fallback = balances.map((line, index) => open[index] ? Math.max(0, roundMoney(line.subtotal - line.returnedSubtotal)) : 0);
  const allocation = allocateAmountByWeights(weights.some((value) => value > 0) ? weights
    : fallback.some((value) => value > 0) ? fallback : open.map((value) => value ? 1 : 0), remainingGst);
  balances.forEach((line, index) => { line.gst = (toPaise(line.returnedGst) + toPaise(allocation[index])) / 100; });
}

function lineGst(lineTotal: number, gstRate: number, mode: GstMode): number {
  const total = Math.max(0, roundMoney(lineTotal));
  const rate = Math.max(0, Number(gstRate) || 0);
  if (total <= 0 || rate <= 0 || mode === "none") return 0;
  return gstLineAmounts(total, rate, mode).gst;
}

/**
 * Rebuild the exact refundable balance of every original line.
 *
 * The stored invoice GST is authoritative, including for older invoices. A
 * final partial return receives every paise left after earlier returns, which
 * prevents the offline amount from changing after the server confirms it.
 */
export function buildReturnLineBalances(input: {
  lines: OriginalReturnLine[];
  discount: number;
  gst: number;
  gstMode: GstMode;
  previousReturns?: PreviousReturnRecord[];
}): Map<string, ReturnLineBalance> {
  const discountAllocation = allocateInvoiceDiscount(
    input.lines.map((line) => Math.abs(Number(line.lineTotal) || 0)),
    Math.abs(Number(input.discount) || 0),
  );
  const currentTaxWeights = discountAllocation.discountedLineTotals.map((total, index) =>
    lineGst(total, input.lines[index]?.gstRate ?? 0, input.gstMode));
  const preDiscountTaxWeights = input.lines.map((line) => lineGst(Math.abs(line.lineTotal), line.gstRate, input.gstMode));
  const taxWeights = currentTaxWeights.some((value) => value > 0)
    ? currentTaxWeights
    : preDiscountTaxWeights.some((value) => value > 0)
      ? preDiscountTaxWeights
      : input.lines.map((line) => Math.abs(line.lineTotal));
  const storedTaxByLine = allocateAmountByWeights(taxWeights, Math.abs(Number(input.gst) || 0));
  const balances = new Map<string, ReturnLineBalance>();

  input.lines.forEach((line, index) => {
    balances.set(line.id, {
      soldQuantity: Math.abs(Number(line.quantity) || 0),
      gross: roundMoney(Math.abs(Number(line.lineTotal) || 0) + Math.abs(Number(line.lineDiscount) || 0)),
      subtotal: discountAllocation.discountedLineTotals[index] ?? 0,
      gst: storedTaxByLine[index] ?? 0,
      cost: Math.abs(roundMoney(Number(line.lineCost) || 0)),
      returnedQuantity: 0,
      returnedGross: 0,
      returnedSubtotal: 0,
      returnedGst: 0,
      returnedCost: 0,
    });
  });

  for (const previousReturn of input.previousReturns ?? []) {
    const taxWeightsForReturn = previousReturn.items.map((line) =>
      lineGst(Math.abs(Number(line.lineTotal) || 0), line.gstRate, previousReturn.gstMode));
    const fallbackWeights = previousReturn.items.map((line) => Math.abs(Number(line.lineTotal) || 0));
    const exactReturnTax = allocateAmountByWeights(
      taxWeightsForReturn.some((value) => value > 0) ? taxWeightsForReturn : fallbackWeights,
      Math.abs(Number(previousReturn.gst) || 0),
    );
    previousReturn.items.forEach((line, index) => {
      const balance = line.originalBillItemId ? balances.get(line.originalBillItemId) : undefined;
      if (!balance) return;
      balance.returnedQuantity = roundQuantity(balance.returnedQuantity + Math.abs(Number(line.quantity) || 0));
      balance.returnedGross = roundMoney(balance.returnedGross + Math.abs(Number(line.lineTotal) || 0) + Math.abs(Number(line.lineDiscount) || 0));
      balance.returnedSubtotal = roundMoney(balance.returnedSubtotal + Math.abs(Number(line.lineTotal) || 0));
      balance.returnedGst = roundMoney(balance.returnedGst + (exactReturnTax[index] ?? 0));
      balance.returnedCost = roundMoney(balance.returnedCost + Math.abs(Number(line.lineCost) || 0));
    });
  }

  if (input.previousReturns?.length) {
    reconcileReturnTaxBalances([...balances.values()], Math.max(0, (toPaise(input.gst)
      - input.previousReturns.reduce((sum, row) => sum + toPaise(Math.abs(row.gst)), 0)) / 100));
  }
  return balances;
}

export function remainingReturnQuantity(balance: ReturnLineBalance): number {
  return Math.max(0, roundQuantity(balance.soldQuantity - balance.returnedQuantity));
}

/** A live preview can outlast its balance while a return commits or syncs. */
export function returnPreviewQuantity(requested: number, balance: ReturnLineBalance): number {
  return Math.min(Math.max(0, roundQuantity(requested)), remainingReturnQuantity(balance));
}

/** Calculate one linked return and consume it from the in-memory balance. */
export function consumeReturnLine(balance: ReturnLineBalance, quantity: number) {
  const requestedQuantity = Math.abs(roundQuantity(quantity));
  const remainingQuantity = remainingReturnQuantity(balance);
  if (requestedQuantity > remainingQuantity + 0.000001) {
    throw new Error("Return quantity exceeds what remains on the original sale");
  }
  const finalReturn = requestedQuantity >= remainingQuantity - 0.000001;
  const units = BigInt(Math.round(requestedQuantity * 1000));
  const sold = BigInt(Math.max(1, Math.round(balance.soldQuantity * 1000)));
  const amount = (full: number, returned: number) => {
    const remaining = Math.max(0, roundMoney(full - returned));
    if (finalReturn) return remaining;
    const numerator = BigInt(toPaise(full)) * units;
    return Math.min(remaining, Number((2n * numerator + sold) / (2n * sold)) / 100);
  };
  const gross = amount(balance.gross, balance.returnedGross);
  const subtotal = amount(balance.subtotal, balance.returnedSubtotal);
  const gst = amount(balance.gst, balance.returnedGst);
  const cost = amount(balance.cost, balance.returnedCost);
  const lineDiscount = Math.max(0, roundMoney(gross - subtotal));

  balance.returnedQuantity = roundQuantity(balance.returnedQuantity + requestedQuantity);
  balance.returnedGross = roundMoney(balance.returnedGross + gross);
  balance.returnedSubtotal = roundMoney(balance.returnedSubtotal + subtotal);
  balance.returnedGst = roundMoney(balance.returnedGst + gst);
  balance.returnedCost = roundMoney(balance.returnedCost + cost);
  return { quantity: requestedQuantity, gross, subtotal, gst, cost, lineDiscount, finalReturn };
}

/**
 * Price one return line that has no original sale behind it.
 *
 * `ReturnLineInput.soldQty` carries two meanings: on a bill-linked return it is
 * the quantity sold, and the refund is that line's money apportioned by how much
 * comes back. On a standalone return — the "New Return" form, which builds its
 * rows straight from the catalogue — it is 0, documented as "unlimited", because
 * there is no original sale to cap or apportion against.
 *
 * Reading the second case as "sold nothing" priced every standalone refund at
 * zero, and "Process return" is disabled while the refund is not positive, so the
 * standalone flow could not be completed at all. When there is no sale to
 * apportion, the shopkeeper is stating the quantity, and that is what it prices.
 */
export function unlinkedReturnLineAmount(input: {
  returnQty: number;
  soldQty: number;
  ratePerRateUnit: number;
  lineDiscount?: number;
  soldLineTotal?: number;
  gstRate?: number;
  gstMode: GstMode;
}): { net: number; tax: number; total: number } {
  const returnQty = Math.max(0, Number(input.returnQty) || 0);
  const soldQty = Math.max(0, Number(input.soldQty) || 0);
  const fraction = soldQty > 0 ? returnQty / soldQty : 1;
  const pricedQty = soldQty > 0 ? soldQty : returnQty;
  const soldNet = typeof input.soldLineTotal === "number" && Number.isFinite(input.soldLineTotal)
    ? Math.abs(input.soldLineTotal)
    : Math.max(0, pricedQty * (Number(input.ratePerRateUnit) || 0) - (Number(input.lineDiscount) || 0));
  const net = roundMoney(soldNet * fraction);
  const tax = input.gstMode === "exclusive" ? gstLineAmounts(net, Number(input.gstRate) || 0, input.gstMode).gst : 0;
  return { net, tax, total: roundMoney(net + tax) };
}

/** Settle invoice round-off on the final return without changing item values or GST. */
export function linkedReturnRefundTotal(itemTotal: number, remainingInvoiceTotal: number | undefined, finalInvoiceReturn: boolean): number {
  if (remainingInvoiceTotal == null || !Number.isFinite(remainingInvoiceTotal)) return roundMoney(itemTotal);
  const remaining = Math.max(0, roundMoney(remainingInvoiceTotal));
  return finalInvoiceReturn ? remaining : Math.min(remaining, roundMoney(itemTotal));
}
