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
 * Bill-level discount is a post-tax concession (the kirana "₹10 kam de do")
 * and does not change the per-line taxable values.
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

export function computeGstBreakdown(lines: GstLineInput[], mode: GstMode = "inclusive", jurisdiction: GstJurisdiction = {}): GstBreakdown {
  const sellerStateCode = normalizedStateCode(jurisdiction.sellerStateCode);
  const buyerStateCode = normalizedStateCode(jurisdiction.buyerStateCode);
  const interstate = Boolean(sellerStateCode && buyerStateCode && sellerStateCode !== buyerStateCode);
  const byRateMap = new Map<number, { taxable: number; gst: number }>();
  let lineTotalSum = 0;

  for (const line of lines) {
    const gross = round2((Number(line.price) || 0) * (Number(line.quantity) || 0));
    const lineTotal = round2(gross - Math.min(Math.max(Number(line.lineDiscount) || 0, 0), gross));
    lineTotalSum = round2(lineTotalSum + lineTotal);
    const rate = mode === "none" ? 0 : Math.max(0, Number(line.gstRate) || 0);
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
  const zeroRated = round2(lineTotalSum - (mode === "exclusive" ? taxableTaxed : round2(taxableTaxed + gst)));
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
    byRate,
  };
}

/** Payable grand total for a bill under the given mode (discount is post-tax). */
export function gstGrandTotal(subtotal: number, discount: number, breakdown: Pick<GstBreakdown, "gstToAdd">): number {
  return round2(Math.max(0, round2(subtotal + breakdown.gstToAdd) - Math.min(Math.max(Number(discount) || 0, 0), round2(subtotal + breakdown.gstToAdd))));
}
