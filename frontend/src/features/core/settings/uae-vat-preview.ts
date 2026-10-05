/** Pure preview arithmetic. This is deliberately not wired to the live INR
 * ledger/outbox. All amounts are integer fils; quantities are thousandths.
 * Unsupported tax treatments must not be guessed from an arbitrary percentage.
 */
export interface VatPreviewLine {
  id: string;
  quantityMilli: number;
  unitPriceMinor: number;
  treatment: "standard" | "zero" | "exempt";
}
export interface VatPreviewResultLine extends VatPreviewLine {
  discountMinor: number;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
}
export interface VatPreviewResult {
  currencyCode: "AED";
  priceMode: "inclusive" | "exclusive";
  lines: VatPreviewResultLine[];
  discountMinor: number;
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
}

const LIMIT = 1_000_000_000_000;
function integer(value: number, minimum = 0): bigint {
  if (!Number.isSafeInteger(value) || value < minimum || value > LIMIT) throw new Error("INVALID_AMOUNT_OR_QUANTITY");
  return BigInt(value);
}
function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}
function amount(value: bigint): number {
  if (value > BigInt(LIMIT) || value < 0n) throw new Error("AMOUNT_EXCEEDS_PREVIEW_LIMIT");
  return Number(value);
}

/** Strict decimal parser: blanks, exponents, negatives and excess precision
 * are errors, not a silent zero or rounded down cashier entry. */
export function parsePreviewDecimal(value: string, digits: 2 | 3): number {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(value.trim())) throw new Error("INVALID_DECIMAL");
  const [whole, fraction = ""] = value.trim().split(".");
  return amount(BigInt(whole) * (10n ** BigInt(digits)) + BigInt(fraction.padEnd(digits, "0")));
}

export function calculateUaeVatPreview(lines: VatPreviewLine[], priceMode: "inclusive" | "exclusive", discountMinor = 0): VatPreviewResult {
  if (!lines.length || lines.length > 100 || !["inclusive", "exclusive"].includes(priceMode)
    || new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error("INVALID_INVOICE");
  const discount = integer(discountMinor);
  const extended = lines.map((line) => {
    if (!line.id || !["standard", "zero", "exempt"].includes(line.treatment)) throw new Error("UNSUPPORTED_VAT_TREATMENT");
    const value = halfUp(integer(line.quantityMilli, 1) * integer(line.unitPriceMinor), 1000n);
    amount(value);
    return value;
  });
  const subtotal = extended.reduce((sum, value) => sum + value, 0n);
  amount(subtotal);
  if (discount > subtotal) throw new Error("DISCOUNT_EXCEEDS_INVOICE_VALUE");
  // Largest remainders distribute every fils exactly once across mixed rates.
  const allocations = extended.map((value, index) => ({
    index, share: subtotal ? discount * value / subtotal : 0n,
    remainder: subtotal ? discount * value % subtotal : 0n,
  }));
  let remaining = discount - allocations.reduce((sum, row) => sum + row.share, 0n);
  const order = [...allocations].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const row of order) { if (remaining <= 0n) break; row.share += 1n; remaining -= 1n; }
  const result = lines.map((line, index) => {
    const afterDiscount = extended[index] - allocations[index].share;
    const vat = line.treatment === "standard" ? halfUp(afterDiscount * 5n, priceMode === "inclusive" ? 105n : 100n) : 0n;
    const net = priceMode === "inclusive" ? afterDiscount - vat : afterDiscount;
    return { ...line, discountMinor: amount(allocations[index].share), netMinor: amount(net), vatMinor: amount(vat), totalMinor: amount(net + vat) };
  });
  const sum = (key: "netMinor" | "vatMinor" | "totalMinor") => amount(result.reduce((total, line) => total + BigInt(line[key]), 0n));
  return { currencyCode: "AED", priceMode, lines: result, discountMinor, netMinor: sum("netMinor"), vatMinor: sum("vatMinor"), totalMinor: sum("totalMinor") };
}

/** Cumulative apportionment makes a full series of partial returns equal the
 * saved original VAT/net exactly, including a one-fils final remainder. */
export function previewVatReturn(line: VatPreviewResultLine, alreadyReturnedMilli: number, returnMilli: number) {
  const sold = integer(line.quantityMilli, 1);
  const before = integer(alreadyReturnedMilli);
  const quantity = integer(returnMilli, 1);
  if (before + quantity > sold) throw new Error("RETURN_EXCEEDS_ORIGINAL_QUANTITY");
  const delta = (value: number) => amount(halfUp(integer(value) * (before + quantity), sold) - halfUp(integer(value) * before, sold));
  const netMinor = delta(line.netMinor);
  const vatMinor = delta(line.vatMinor);
  return { netMinor, vatMinor, totalMinor: netMinor + vatMinor };
}

export function uaeInvoiceKind(buyerVatRegistered: boolean, totalMinor: number): "full" | "simplified" {
  integer(totalMinor);
  return buyerVatRegistered && totalMinor > 1_000_000 ? "full" : "simplified";
}
