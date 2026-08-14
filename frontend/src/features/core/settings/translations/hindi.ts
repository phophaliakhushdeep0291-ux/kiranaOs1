// Every Hindi table in one module, so `i18n.tsx` can pull the whole Hindi
// dictionary with a single dynamic import and keep it out of the app shell.
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download.
import { billingHi } from "./billing.hi";
import { customersHi } from "./customers.hi";
import { productsHi } from "./products.hi";
import { reportsHi } from "./reports.hi";
import { restaurantHi } from "./restaurant.hi";
import { shellHi } from "./shell.hi";
import { manufacturingHi } from "./manufacturing.hi";
import { inventoryHi } from "./inventory.hi";
import { settingsPagesHi } from "./settings-pages.hi";

export const hindiTranslations = { ...shellHi, ...billingHi, ...productsHi, ...customersHi, ...restaurantHi, ...reportsHi, ...manufacturingHi, ...inventoryHi, ...settingsPagesHi };

/**
 * The same modules as EN_MODULES in i18n.tsx, keyed identically. The completeness
 * test compares the two key-for-key, so a module added to English and forgotten here
 * fails a test rather than shipping English strings to a Hindi counter.
 */
export const HI_MODULES = {
  shell: shellHi,
  billing: billingHi,
  products: productsHi,
  customers: customersHi,
  restaurant: restaurantHi,
  reports: reportsHi,
  manufacturing: manufacturingHi,
  inventory: inventoryHi,
  settingsPages: settingsPagesHi,
} as const;
