import { fromPaise, round2, toPaise } from "./money.js";

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Validate and normalize an Indian GSTIN, including its base-36 checksum. */
export function validateGstin(value) {
  const gstin = String(value || "").trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { valid: false, normalized: gstin, reason: "GSTIN must be a valid 15-character Indian GST number" };
  }
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const codePoint = GST_CHARS.indexOf(gstin[index]);
    const product = codePoint * ((index % 2) + 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GST_CHARS[(36 - (sum % 36)) % 36];
  if (gstin[14] !== expected) return { valid: false, normalized: gstin, reason: "GSTIN checksum is invalid" };
  return { valid: true, normalized: gstin, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) };
}

/** HSN codes are 4, 6, or 8 decimal digits. */
export function validateHsn(value) {
  const hsn = String(value || "").trim();
  return { valid: /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(hsn), normalized: hsn };
}

/**
 * Allocate an invoice-level discount across line values in integer paise.
 *
 * Section 15(3) of the CGST Act excludes an invoice-recorded discount from the
 * taxable value. A mixed-rate invoice therefore has to apportion the discount
 * before calculating each rate bucket. Sequential remainder allocation keeps
 * every line non-negative and guarantees that allocations equal the exact
 * discount down to one paise. The frontend GST engine mirrors this algorithm.
 */
export function allocateInvoiceDiscount(lineTotals, discount) {
  const linePaise = lineTotals.map((value) => Math.max(0, toPaise(round2(Number(value) || 0))));
  const totalPaise = linePaise.reduce((sum, value) => sum + value, 0);
  const discountPaise = Math.min(Math.max(0, toPaise(round2(Number(discount) || 0))), totalPaise);
  const lastFundedIndex = linePaise.reduce((last, value, index) => value > 0 ? index : last, -1);
  let remainingBase = totalPaise;
  let remainingDiscount = discountPaise;
  const allocationPaise = linePaise.map((line, index) => {
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
  return {
    allocations: allocationPaise.map(fromPaise),
    discountedLineTotals: linePaise.map((value, index) => fromPaise(value - allocationPaise[index])),
    discount: fromPaise(discountPaise),
  };
}

/**
 * Allocate an exact money amount across non-negative weights in integer paise.
 *
 * This is deliberately not capped by the weights: it is also used to apportion
 * the exact GST stored on an older invoice, whose historical tax policy may
 * differ from the current calculation. The final funded line receives the
 * remainder, so the allocated values always add back to the source amount.
 */
export function allocateAmountByWeights(weights, amount) {
  const weightPaise = weights.map((value) => Math.max(0, toPaise(round2(Number(value) || 0))));
  const totalWeight = weightPaise.reduce((sum, value) => sum + value, 0);
  const amountPaise = Math.max(0, toPaise(round2(Number(amount) || 0)));
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
    return fromPaise(allocated);
  });
}

/** Calculate total GST after allocating the bill discount across line values. */
export function calculateInvoiceGst(lines, discount, mode = "inclusive") {
  const allocation = allocateInvoiceDiscount(lines.map((line) => line.lineTotal), discount);
  if (mode === "none") {
    return {
      gst: 0,
      lineGst: lines.map(() => 0),
      discount: allocation.discount,
      discountedLineTotals: allocation.discountedLineTotals,
    };
  }
  const lineGst = allocation.discountedLineTotals.map((lineTotal, index) => {
    const rate = Math.max(0, Number(lines[index]?.gstRate) || 0);
    if (rate <= 0 || lineTotal <= 0) return 0;
    return mode === "exclusive"
      ? round2(lineTotal * rate / 100)
      : round2(lineTotal - round2(lineTotal / (1 + rate / 100)));
  });
  return {
    gst: fromPaise(lineGst.reduce((sum, value) => sum + toPaise(value), 0)),
    lineGst,
    discount: allocation.discount,
    discountedLineTotals: allocation.discountedLineTotals,
  };
}
