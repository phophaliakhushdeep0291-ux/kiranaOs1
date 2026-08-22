import { allocateAmountByWeights, allocateInvoiceDiscount, type GstMode } from "@/lib/gst";
import { roundMoney } from "@/lib/money";

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

function lineGst(lineTotal: number, gstRate: number, mode: GstMode): number {
  const total = Math.max(0, roundMoney(lineTotal));
  const rate = Math.max(0, Number(gstRate) || 0);
  if (total <= 0 || rate <= 0 || mode === "none") return 0;
  return mode === "exclusive"
    ? roundMoney(total * rate / 100)
    : roundMoney(total - roundMoney(total / (1 + rate / 100)));
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
      balance.returnedQuantity = roundMoney(balance.returnedQuantity + Math.abs(Number(line.quantity) || 0));
      balance.returnedGross = roundMoney(balance.returnedGross + Math.abs(Number(line.lineTotal) || 0) + Math.abs(Number(line.lineDiscount) || 0));
      balance.returnedSubtotal = roundMoney(balance.returnedSubtotal + Math.abs(Number(line.lineTotal) || 0));
      balance.returnedGst = roundMoney(balance.returnedGst + (exactReturnTax[index] ?? 0));
      balance.returnedCost = roundMoney(balance.returnedCost + Math.abs(Number(line.lineCost) || 0));
    });
  }

  return balances;
}

export function remainingReturnQuantity(balance: ReturnLineBalance): number {
  return Math.max(0, roundMoney(balance.soldQuantity - balance.returnedQuantity));
}

/** Calculate one linked return and consume it from the in-memory balance. */
export function consumeReturnLine(balance: ReturnLineBalance, quantity: number) {
  const requestedQuantity = Math.abs(roundMoney(quantity));
  const remainingQuantity = remainingReturnQuantity(balance);
  if (requestedQuantity > remainingQuantity + 0.000001) {
    throw new Error("Return quantity exceeds what remains on the original sale");
  }
  const finalReturn = requestedQuantity >= remainingQuantity - 0.000001;
  const fraction = requestedQuantity / Math.max(balance.soldQuantity, 0.000001);
  const amount = (full: number, returned: number) => finalReturn
    ? Math.max(0, roundMoney(full - returned))
    : roundMoney(full * fraction);
  const gross = amount(balance.gross, balance.returnedGross);
  const subtotal = amount(balance.subtotal, balance.returnedSubtotal);
  const gst = amount(balance.gst, balance.returnedGst);
  const cost = amount(balance.cost, balance.returnedCost);
  const lineDiscount = Math.max(0, roundMoney(gross - subtotal));

  balance.returnedQuantity = roundMoney(balance.returnedQuantity + requestedQuantity);
  balance.returnedGross = roundMoney(balance.returnedGross + gross);
  balance.returnedSubtotal = roundMoney(balance.returnedSubtotal + subtotal);
  balance.returnedGst = roundMoney(balance.returnedGst + gst);
  balance.returnedCost = roundMoney(balance.returnedCost + cost);
  return { quantity: requestedQuantity, gross, subtotal, gst, cost, lineDiscount, finalReturn };
}
