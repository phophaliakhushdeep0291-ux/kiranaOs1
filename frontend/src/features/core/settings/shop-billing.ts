import { useMemo } from "react";
import { getStoredBusinessType, useBusinessTypeKey, type BusinessType } from "./business-types";
import { englishTranslations, useAppLanguage, type TranslationKey } from "./i18n";
import { SHOP_TENDER_WORD } from "./shop-credit";

/**
 * The till's three trade words.
 *
 * Billing gets no guidance strip and no shortcut chips, unlike the other shared
 * screens. It is a full-height two-panel counter tool that already sets
 * `lg:overflow-hidden`, and every row added at the top pushes the cart down on
 * the tablet the shop actually bills from. The trade's own screens are reachable
 * from the sidebar, which the pack already fills; a second copy on the busiest
 * screen in the app would cost cart space to save one tap.
 *
 * What was genuinely wrong here was the wording, and specifically one word.
 * Eight strings on the till hardcoded "Udhar" as the name of the credit tender —
 * the button, the split line, the remaining-amount label and the two "full
 * amount goes to Udhar" sentences — so a café taking a tab and a factory raising
 * a credit dispatch both read a kirana store's word at the moment of committing
 * the sale. The report and the customer screen had already been given the trade's
 * own word, which left the till disagreeing with both.
 *
 * The tender word comes from `shop-credit.ts` so all three screens read one map.
 */
export interface ShopBillingProfile {
  /** What the credit tender is called on the button and in the sentences. */
  tenderWordKey: TranslationKey;
  /** What one sale is: a bill, an order, a dispatch. */
  billNounKey: TranslationKey;
  /** What the product grid is full of, for the empty-cart hint. */
  itemsNounKey: TranslationKey;
}

export const SHOP_BILLING: Record<BusinessType, ShopBillingProfile> = {
  kirana: {
    tenderWordKey: SHOP_TENDER_WORD.kirana,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.products",
  },
  clothing: {
    tenderWordKey: SHOP_TENDER_WORD.clothing,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.styles",
  },
  footwear: {
    tenderWordKey: SHOP_TENDER_WORD.footwear,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.models",
  },
  auto_parts: {
    tenderWordKey: SHOP_TENDER_WORD.auto_parts,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.parts",
  },
  electronics: {
    tenderWordKey: SHOP_TENDER_WORD.electronics,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.models",
  },
  pharmacy: {
    tenderWordKey: SHOP_TENDER_WORD.pharmacy,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.medicines",
  },
  stationery: {
    tenderWordKey: SHOP_TENDER_WORD.stationery,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.titles",
  },
  furniture: {
    tenderWordKey: SHOP_TENDER_WORD.furniture,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.models",
  },
  cosmetics: {
    tenderWordKey: SHOP_TENDER_WORD.cosmetics,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.products",
  },
  restaurant: {
    tenderWordKey: SHOP_TENDER_WORD.restaurant,
    billNounKey: "billing.noun.order",
    itemsNounKey: "billing.noun.items.dishes",
  },
  manufacturing: {
    tenderWordKey: SHOP_TENDER_WORD.manufacturing,
    billNounKey: "billing.noun.dispatch",
    itemsNounKey: "billing.noun.items.products",
  },
  other: {
    tenderWordKey: SHOP_TENDER_WORD.other,
    billNounKey: "billing.noun.bill",
    itemsNounKey: "billing.noun.items.products",
  },
};

export function getShopBillingProfile(businessType: BusinessType): ShopBillingProfile {
  return SHOP_BILLING[businessType];
}

/**
 * The three words, resolved.
 *
 * Returned together because every till component that needs one needs at least
 * two, and threading three separate props through the cart, the summary and the
 * payment panel is three chances to pass the wrong one.
 */
export interface ShopBillingWords {
  /** Credit tender: "Udhar", "Tab", "Patient Account", "Receivable". */
  credit: string;
  /** One sale: "bill", "order", "dispatch". */
  bill: string;
  /** The grid's contents: "products", "dishes", "medicines". */
  items: string;
}

/**
 * Read by each till component rather than threaded down from the page.
 *
 * The four places that need these words — the cart, the summary, the payment
 * panel and the open-bills bar — sit at three different depths under
 * `BillingPage`, and two of them are already past a dozen props. A hook keeps
 * each one self-contained and makes it impossible to hand a component the wrong
 * one of three strings.
 */
/**
 * The credit tender word for the printed receipt, in English.
 *
 * The receipt is built by plain functions during a print call — no React, so no
 * `t()` — and it is English throughout today: "Estimate", "Sale receipt",
 * "Cash", "UPI" are all literals in `billing-print.ts`. This resolves the one
 * word that is trade-specific out of the same map the screen uses, and takes the
 * English side of the dictionary deliberately rather than pretending the rest of
 * the slip is translated.
 *
 * It matters more here than on screen: the receipt is the copy the customer
 * carries out of the shop, so a café's slip reading "Udhar" is the version of
 * this bug that leaves the building.
 */
export function receiptCreditWordEnglish(): string {
  return englishTranslations[SHOP_TENDER_WORD[getStoredBusinessType()]];
}

export function useShopBillingWords(): ShopBillingWords {
  const { t } = useAppLanguage();
  const businessType = useBusinessTypeKey();
  return useMemo(() => {
    const profile = SHOP_BILLING[businessType];
    return {
      credit: t(profile.tenderWordKey),
      bill: t(profile.billNounKey),
      items: t(profile.itemsNounKey),
    };
  }, [businessType, t]);
}
