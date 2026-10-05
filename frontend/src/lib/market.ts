/** Explicit profiles for new regional code. No mutable global currency: an
 * invoice must always render in its own denomination, even after shop switches.
 * AE is a preview contract until ledger, sync and provider acceptance is done.
 */
export const MARKETS = {
  IN: { countryCode: "IN", currencyCode: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", taxRegime: "GST", minorDigits: 2, tradingEnabled: true },
  AE: { countryCode: "AE", currencyCode: "AED", locale: "en-AE", timeZone: "Asia/Dubai", taxRegime: "VAT", minorDigits: 2, tradingEnabled: false },
} as const;
export type MarketCode = keyof typeof MARKETS;
export type CurrencyCode = (typeof MARKETS)[MarketCode]["currencyCode"];

const dates = new Map<MarketCode, Intl.DateTimeFormat>();
export function marketBusinessDate(instant: string | Date, market: MarketCode): string {
  // A timestamp with no offset uses the device timezone in Date.parse. It is
  // not an instant and cannot safely determine a shop's accounting day.
  if (typeof instant === "string" && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(instant)) throw new Error("INVALID_TRANSACTION_INSTANT");
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid transaction date");
  let formatter = dates.get(market);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: MARKETS[market].timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dates.set(market, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** UAE mobile national prefix 05x or international +971/00971; preserve the
 * country code so UAE and Indian identities can never collapse into one key.
 * Format validation only, never proof of ownership or an active subscription.
 */
export function normalizeUaeMobile(input: string): string | null {
  let value = input.trim().replace(/[\s()-]/g, "");
  if (value.startsWith("00971")) value = `+971${value.slice(5)}`;
  else if (/^971\d{9}$/.test(value)) value = `+${value}`;
  else if (/^05\d{8}$/.test(value)) value = `+971${value.slice(1)}`;
  return /^\+9715[024568]\d{7}$/.test(value) ? value : null;
}

/** TRN syntax only. Registration status must be checked with the FTA. */
export function isUaeTrn(value: string): boolean {
  return /^\d{15}$/.test(value.trim());
}
