import { loadAuthSession } from "./storage/auth-storage";

export interface AccountingMarketFields {
  countryCode?: string;
  currencyCode?: string;
  accountingTimeZone?: string;
  taxRegime?: string;
}

export const LEGACY_ACCOUNTING_MARKET = Object.freeze({
  countryCode: "IN", currencyCode: "INR", accountingTimeZone: "Asia/Kolkata", taxRegime: "GST",
});

/** Old installed clients/records have no fields. Their ledger was always INR.
 * An explicit foreign value is an error, never a request to relabel the money. */
export function accountingMarketSnapshot(source: AccountingMarketFields = {}) {
  const expected = source.countryCode === "AE"
    ? { countryCode: "AE", currencyCode: "AED", accountingTimeZone: "Asia/Dubai", taxRegime: "VAT" }
    : LEGACY_ACCOUNTING_MARKET;
  assertAccountingMarketClaim(source, expected);
  return { ...expected };
}

export function assertAccountingMarketClaim(input: AccountingMarketFields, expected: AccountingMarketFields) {
  for (const key of Object.keys(LEGACY_ACCOUNTING_MARKET) as (keyof AccountingMarketFields)[]) {
    if (input[key] !== undefined && input[key] !== expected[key]) {
      const error = new Error("This transaction's currency or accounting region does not match the shop. Sync and verify the shop before saving.");
      Object.assign(error, { code: "ACCOUNTING_MARKET_MISMATCH" });
      throw error;
    }
  }
}

export function activeAccountingMarketSnapshot() {
  const { shop, user } = loadAuthSession();
  if (shop && user?.shopId && shop.id !== user.shopId) throw new Error("Accounting shop does not match the signed-in account.");
  return accountingMarketSnapshot(shop ?? {});
}
