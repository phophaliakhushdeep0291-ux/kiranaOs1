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
export function toPaise(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) || 0;
}

export function fromPaise(value: number): number {
  return (Number.isFinite(value) ? value : 0) / 100 || 0;
}

export function roundMoney(value: number): number {
  return fromPaise(toPaise(value));
}

export function addMoney(...values: unknown[]): number {
  return fromPaise(values.reduce<number>((total, value) => total + toPaise(value), 0));
}

export function subtractMoney(start: unknown, ...values: unknown[]): number {
  return fromPaise(values.reduce<number>((total, value) => total - toPaise(value), toPaise(start)));
}

export function moneyExceeds(value: unknown, limit: unknown): boolean {
  return toPaise(value) > toPaise(limit);
}

/**
 * Round a bill total to the nearest whole rupee — the "₹0.50-and-up rounds up"
 * convention every Indian counter uses. Kept here beside roundMoney so the billing
 * UI, the offline bill validator, and the sync payload all round by the SAME rule
 * and can never disagree by a paisa. The backend mirrors this (Math.round on its
 * paise-reconciled total) so a synced bill reconciles on replay.
 */
export function roundToRupee(value: unknown): number {
  return Math.round(roundMoney(Number(value))) || 0;
}

/**
 * Apply nearest-rupee round-off to a bill total. Returns the `payable` (a whole
 * rupee when enabled) and the signed `roundOff` adjustment (payable − raw) — the
 * figure the receipt shows and the drawer needs so collected cash matches the
 * recorded total. Disabled → paise pass through untouched.
 */
export function applyRoundOff(rawTotal: unknown, enabled: boolean): { payable: number; roundOff: number } {
  const raw = roundMoney(Number(rawTotal));
  if (!enabled) return { payable: raw, roundOff: 0 };
  const payable = roundToRupee(raw);
  return { payable, roundOff: roundMoney(payable - raw) };
}

export function formatMoney(value: unknown): string {
  const rounded = roundMoney(Number(value));
  const hasPaise = Math.abs(toPaise(rounded)) % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}
