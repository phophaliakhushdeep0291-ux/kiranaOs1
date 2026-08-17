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

/**
 * The same idea as a tender button on the till, in the singular.
 *
 * A second map rather than a second use of the one above, because the two are
 * different grammatical roles and one word cannot fill both. The report reads
 * "Outstanding Patient Accounts" and "Top Customers (Tabs)" — collective, and
 * plural where the trade's word is plural. The till writes the destination of
 * one sale: "Full amount ₹500 goes to Patient Accounts." does not read, and
 * neither does a tender button labelled "Tabs" under a single bill.
 *
 * Where the collective word already works in the singular the two entries are
 * deliberately identical, so most trades still have exactly one word. Only
 * pharmacy, restaurant and manufacturing genuinely need the other form, and
 * `Dues` softens to the plain `Credit` a counter would say out loud.
 *
 * A parts counter reads "Party Credit" on its report and "Khata" here on
 * purpose: `navConfig` already labels its customers screen "Khata", so the till
 * agrees with the button that opens it.
 */
export const SHOP_TENDER_WORD: Record<BusinessType, TranslationKey> = {
  kirana: "reports.credit.udhar",
  clothing: "reports.credit.credit",
  footwear: "reports.credit.credit",
  auto_parts: "billing.tender.khata",
  electronics: "reports.credit.credit",
  pharmacy: "billing.tender.patientAccount",
  stationery: "reports.credit.credit",
  furniture: "reports.credit.credit",
  cosmetics: "reports.credit.credit",
  restaurant: "billing.tender.tab",
  manufacturing: "billing.tender.receivable",
  other: "reports.credit.credit",
};

export function tenderWordKeyFor(businessType: BusinessType): TranslationKey {
  return SHOP_TENDER_WORD[businessType];
}
