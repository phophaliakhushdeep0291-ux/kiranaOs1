import type { BusinessType } from "./business-types";
import type { TranslationKey } from "./i18n";

/**
 * What money a customer owes is called, in one place.
 *
 * It is udhar in a kirana store, a patient account at a chemist, party khata on
 * a parts counter, a tab in a café and a receivable in a factory. The word turns
 * up on the report, on the customer screen and in every reminder built from
 * them, so it is held here rather than on any one of those profiles: two copies
 * would let a shop read "Patient Accounts" on its report and "Udhar" on the
 * screen the report links to.
 *
 * These are dictionary keys, not English text. Several are reused across trades
 * because "Credit" really is the right word in more than one of them — the map
 * is not obliged to invent eleven different nouns.
 */
export const SHOP_CREDIT_WORD: Record<BusinessType, TranslationKey> = {
  kirana: "reports.credit.udhar",
  clothing: "reports.credit.credit",
  footwear: "reports.credit.dues",
  auto_parts: "reports.credit.partyCredit",
  electronics: "reports.credit.credit",
  pharmacy: "reports.credit.patientAccounts",
  stationery: "reports.credit.credit",
  furniture: "reports.credit.dues",
  cosmetics: "reports.credit.credit",
  restaurant: "reports.credit.tabs",
  manufacturing: "reports.credit.receivables",
  other: "reports.credit.credit",
};

export function creditWordKeyFor(businessType: BusinessType): TranslationKey {
  return SHOP_CREDIT_WORD[businessType];
}
