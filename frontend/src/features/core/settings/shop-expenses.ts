import type { BusinessType } from "./business-types";

/**
 * What each trade actually spends money on.
 *
 * One ten-item list served all twelve trades, and it had no row a restaurant
 * could file its gas cylinder under, none for a factory's power bill or labour
 * wages, and none for a chemist's licence renewal. Every one of those went in as
 * "Misc", which is the same as not recording a category at all — and the expense
 * pie chart, the P&L and every "where is the money going" question are built out
 * of this field.
 *
 * THESE STRINGS ARE STORED DATA, NOT DISPLAY COPY. The category saved on an
 * expense is this literal text, so unlike the rest of the trade profiles these
 * are not dictionary keys and must not become ones: translating them would file
 * the same expense under two different categories depending on the language the
 * shop happened to be in that day. Renaming an entry orphans every expense
 * already filed under the old name, exactly like a product attribute key.
 */

/** What every shop pays regardless of what it sells. */
const COMMON: readonly string[] = [
  "Rent",
  "Salaries",
  "Utilities",
  "Stock Purchase",
  "Transport",
  "Maintenance",
  "Marketing",
  "Office Supplies",
  "Mobile & Internet",
];

/** Filed last, so the trade's own rows are the ones in reach. */
const MISC = "Misc";

/** What this trade pays that the others largely do not. */
const TRADE_EXPENSES: Record<BusinessType, readonly string[]> = {
  kirana: ["Packing Material", "Loading & Unloading"],
  clothing: ["Alterations & Tailoring", "Display & Mannequins", "Packing Material"],
  footwear: ["Display & Racks", "Packing Material"],
  auto_parts: ["Tools & Equipment", "Godown Rent", "Loading & Unloading"],
  electronics: ["Service & Repairs", "Demo Units", "Packing Material"],
  pharmacy: ["Drug Licence & Fees", "Cold Chain & Fridge", "Biomedical Waste"],
  stationery: ["Printing & Photocopy", "Packing Material"],
  furniture: ["Delivery & Installation", "Polishing & Finishing", "Showroom Display"],
  cosmetics: ["Testers & Samples", "Display & Shelving"],
  restaurant: ["Vegetables & Provisions", "Kitchen Gas & LPG", "Crockery & Utensils", "Aggregator Commission", "Kitchen Cleaning"],
  manufacturing: ["Raw Material", "Packaging Material", "Power & Fuel", "Labour Wages", "Factory Consumables", "Freight & Export"],
  other: [],
};

/** The categories this trade is offered, its own first. */
export function expenseCategoriesFor(businessType: BusinessType): string[] {
  return [...TRADE_EXPENSES[businessType], ...COMMON, MISC];
}

/**
 * The offered list, plus anything already filed that is not on it.
 *
 * A shop that changes its business type still has last month's expenses filed
 * under the old trade's categories. Dropping those would hide the rows from the
 * filter and blank the field when one is edited — so they are kept, listed after
 * the current trade's own. Same reason `tradeFirstUnits` orders rather than
 * filters.
 */
export function expenseCategoryOptions(businessType: BusinessType, used: readonly string[]): string[] {
  const offered = expenseCategoriesFor(businessType);
  const known = new Set(offered);
  const foreign = [...new Set(used.filter((category) => category && !known.has(category)))].sort();
  // "Misc" stays at the bottom: it is the row you pick when none of the ones
  // above fit, and a list that ends on a real category invites it to be picked
  // by position instead.
  return [...offered.filter((category) => category !== MISC), ...foreign, MISC];
}
