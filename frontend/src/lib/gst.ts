/**
 * GST engine — the single source of truth for tax math on the counter.
 *
 * Indian retail reality this models:
 * - "inclusive" (default): the entered price IS the final price (MRP includes
 *   GST by law). The payable total never changes; tax is EXTRACTED from it for
 *   the invoice breakup: taxable = price / (1 + r), gst = price − taxable.
 * - "exclusive" (B2B style): tax is ADDED on top of the entered price.
 * - "none": no GST anywhere.
 *
 * Intra-state sales split tax as CGST + SGST; interstate sales use IGST.
 * The remainder component is derived from total GST so every split reconciles
 * to the paisa, including signed credit-note lines.
 * Invoice discounts reduce taxable value under CGST Act section 15(3). A
 * bill-level discount is therefore allocated across line values before tax is
 * extracted/added; it is never treated as a post-tax concession.
 */

export type GstMode = "inclusive" | "exclusive" | "none";

export interface GstLineInput {
  /** Unit price as entered at the counter. */
  price: number;
  quantity: number;
  /** Percentage, e.g. 18 for 18%. */
  gstRate: number;
  /**
   * Flat rupee discount for the whole line. Unlike the bill-level discount
   * (post-tax concession), a line discount reduces the line's taxable value.
   */
  lineDiscount?: number;
}

export interface GstRateRow {
  rate: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface GstBreakdown {
  mode: GstMode;
  /** Sum of line totals as entered (what the UI calls subtotal). */
  lineTotal: number;
  /** Tax-exclusive value of the goods. */
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
  igst: number;
  supplyType: "intrastate" | "interstate";
  /** Amount to ADD to the payable total (0 unless mode is exclusive). */
  gstToAdd: number;
  /** Bill-level invoice discount allocated before calculating tax. */
  discount: number;
  /** Sum of entered line values after the bill-level discount. */
  discountedLineTotal: number;
  byRate: GstRateRow[];
}

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export interface GstJurisdiction {
  sellerStateCode?: string | null;
  buyerStateCode?: string | null;
}

function normalizedStateCode(value: string | null | undefined) {
  const code = String(value ?? "").trim();
  return /^\d{2}$/.test(code) ? code : "";
}

/**
 * Allocate one invoice-level discount in integer paise. The sequential
 * remainder method makes allocations add back to the exact discount while
 * keeping each line non-negative. Backend billing mirrors this byte-for-byte.
 */
export function allocateInvoiceDiscount(lineTotals: number[], discount: number): { allocations: number[]; discountedLineTotals: number[]; discount: number } {
  const linePaise = lineTotals.map((value) => Math.max(0, Math.round(round2(value) * 100)));
  const totalPaise = linePaise.reduce((sum, value) => sum + value, 0);
  const discountPaise = Math.min(Math.max(0, Math.round(round2(discount) * 100)), totalPaise);
  const lastFundedIndex = linePaise.reduce((last, value, index) => value > 0 ? index : last, -1);
  let remainingBase = totalPaise;
  let remainingDiscount = discountPaise;
  const allocationsPaise = linePaise.map((line, index) => {
    if (line <= 0 || remainingDiscount <= 0 || remainingBase <= 0) {
      remainingBase -= line;
      return 0;
    }
    const proportional = index === lastFundedIndex
      ? remainingDiscount
      : Math.round((remainingDiscount / remainingBase) * line);
    const allocated = Math.min(line, remainingDiscount, Math.max(0, proportional));
    remainingBase -= line;
    remainingDiscount -= allocated;
    return allocated;
  });
  const allocations = allocationsPaise.map((value) => value / 100);
  const discountedLineTotals = linePaise.map((value, index) => (value - allocationsPaise[index]) / 100);
  return { allocations, discountedLineTotals, discount: discountPaise / 100 };
}

/** Allocate an exact amount across weights, with the last funded line taking the paise remainder. */
export function allocateAmountByWeights(weights: number[], amount: number): number[] {
  const weightPaise = weights.map((value) => Math.max(0, Math.round(round2(Number(value) || 0) * 100)));
  const totalWeight = weightPaise.reduce((sum, value) => sum + value, 0);
  const amountPaise = Math.max(0, Math.round(round2(Number(amount) || 0) * 100));
  if (amountPaise === 0 || totalWeight === 0) return weightPaise.map(() => 0);

  const lastFundedIndex = weightPaise.reduce((last, value, index) => value > 0 ? index : last, -1);
  let remainingWeight = totalWeight;
  let remainingAmount = amountPaise;
  return weightPaise.map((weight, index) => {
    if (weight <= 0 || remainingAmount <= 0 || remainingWeight <= 0) {
      remainingWeight -= weight;
      return 0;
    }
    const proportional = index === lastFundedIndex
      ? remainingAmount
      : Math.round((remainingAmount / remainingWeight) * weight);
    const allocated = Math.min(remainingAmount, Math.max(0, proportional));
    remainingWeight -= weight;
    remainingAmount -= allocated;
    return allocated / 100;
  });
}

export function computeGstBreakdown(
  lines: GstLineInput[],
  mode: GstMode = "inclusive",
  jurisdiction: GstJurisdiction = {},
  billDiscount = 0,
): GstBreakdown {
  const sellerStateCode = normalizedStateCode(jurisdiction.sellerStateCode);
  const buyerStateCode = normalizedStateCode(jurisdiction.buyerStateCode);
  const interstate = Boolean(sellerStateCode && buyerStateCode && sellerStateCode !== buyerStateCode);
  const byRateMap = new Map<number, { taxable: number; gst: number }>();
  const normalizedLines = lines.map((line) => {
    const gross = round2((Number(line.price) || 0) * (Number(line.quantity) || 0));
    const lineTotal = round2(gross - Math.min(Math.max(Number(line.lineDiscount) || 0, 0), gross));
    return { lineTotal, rate: mode === "none" ? 0 : Math.max(0, Number(line.gstRate) || 0) };
  });
  const lineTotalSum = round2(normalizedLines.reduce((sum, line) => sum + line.lineTotal, 0));
  const allocation = allocateInvoiceDiscount(normalizedLines.map((line) => line.lineTotal), billDiscount);
  const discountedLineTotal = round2(allocation.discountedLineTotals.reduce((sum, value) => sum + value, 0));

  for (const [index, line] of normalizedLines.entries()) {
    const lineTotal = allocation.discountedLineTotals[index];
    const rate = line.rate;
    if (rate <= 0 || lineTotal <= 0) continue;

    let taxable: number;
    let gst: number;
    if (mode === "exclusive") {
      taxable = lineTotal;
      gst = round2(lineTotal * (rate / 100));
    } else {
      taxable = round2(lineTotal / (1 + rate / 100));
      gst = round2(lineTotal - taxable);
    }

    const bucket = byRateMap.get(rate) ?? { taxable: 0, gst: 0 };
    bucket.taxable = round2(bucket.taxable + taxable);
    bucket.gst = round2(bucket.gst + gst);
    byRateMap.set(rate, bucket);
  }

  const byRate: GstRateRow[] = [...byRateMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, { taxable, gst }]) => {
      const cgst = interstate ? 0 : round2(gst / 2);
      return { rate, taxable, gst, cgst, sgst: interstate ? 0 : round2(gst - cgst), igst: interstate ? gst : 0 };
    });

  const gst = round2(byRate.reduce((sum, row) => sum + row.gst, 0));
  const cgst = round2(byRate.reduce((sum, row) => sum + row.cgst, 0));
  const sgst = round2(gst - cgst);
  const igst = interstate ? gst : 0;
  const taxableTaxed = round2(byRate.reduce((sum, row) => sum + row.taxable, 0));
  // Zero-rated lines are part of the taxable value too (at their full amount).
  const zeroRated = round2(discountedLineTotal - (mode === "exclusive" ? taxableTaxed : round2(taxableTaxed + gst)));
  const taxable = round2(taxableTaxed + Math.max(0, zeroRated));

  return {
    mode,
    lineTotal: lineTotalSum,
    taxable,
    gst,
    cgst,
    sgst: interstate ? 0 : sgst,
    igst,
    supplyType: interstate ? "interstate" : "intrastate",
    gstToAdd: mode === "exclusive" ? gst : 0,
    discount: allocation.discount,
    discountedLineTotal,
    byRate,
  };
}

/** Payable grand total when the breakdown was computed with the same discount. */
export function gstGrandTotal(subtotal: number, discount: number, breakdown: Pick<GstBreakdown, "gstToAdd">): number {
  const appliedDiscount = Math.min(Math.max(round2(Number(discount) || 0), 0), round2(subtotal));
  return round2(Math.max(0, round2(subtotal - appliedDiscount + breakdown.gstToAdd)));
}
