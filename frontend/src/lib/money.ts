/**
 * The single money-rounding helper for the whole frontend.
 *
 * History: this used to exist as 14 near-identical private copies (three divergent
 * bodies) and they drifted — the audit that consolidated them had to patch a `-0`
 * display bug ("₹-0") in every copy. Import from here instead of redefining.
 *
 * Semantics:
 * - rounds to 2 decimals (paise)
 * - `Number.EPSILON` nudge so float artifacts like 1.005 round up as expected
 * - non-numeric input (NaN/undefined/null) and `-0` normalize to `0`
 */
export function roundMoney(value: number): number {
  const n = Number(value) || 0;
  return Math.round((n + Number.EPSILON) * 100) / 100 || 0;
}
