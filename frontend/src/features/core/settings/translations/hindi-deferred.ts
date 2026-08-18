// Every Hindi table that is not on the boot path, fetched after the app has
// mounted rather than before it paints. See hindi-critical.ts for why the
// dictionary is split at all.
//
// A key from one of these tables that is read before this chunk lands falls
// back to English, which is the complete catalogue and already in the shell —
// the same trade main.tsx already makes when the Hindi fetch is slow. The
// window is one network round trip on the first ever load, and nothing after
// that: the service worker caches the chunk.
//
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download.
import { assuranceHi } from "./assurance.hi";
import { customersHi } from "./customers.hi";
import { inventoryHi } from "./inventory.hi";
import { manufacturingHi } from "./manufacturing.hi";
import { productsHi } from "./products.hi";
import { reportsHi } from "./reports.hi";
import { restaurantHi } from "./restaurant.hi";
import { settingsPagesHi } from "./settings-pages.hi";
import { suppliersHi } from "./suppliers.hi";
import { ordersHi } from "./orders.hi";
import { shopTypesHi } from "./shop-types.hi";
import { workflowsHi } from "./workflows.hi";

export const hindiDeferredTranslations = {
  ...productsHi,
  ...assuranceHi,
  ...customersHi,
  ...restaurantHi,
  ...reportsHi,
  ...manufacturingHi,
  ...inventoryHi,
  ...settingsPagesHi,
  ...suppliersHi,
  ...ordersHi,
  ...shopTypesHi,
  ...workflowsHi,
};

/** Registered deferred modules. `hindi.ts` re-exports these into HI_MODULES. */
export const HI_DEFERRED_MODULES = {
  products: productsHi,
  assurance: assuranceHi,
  customers: customersHi,
  restaurant: restaurantHi,
  reports: reportsHi,
  manufacturing: manufacturingHi,
  inventory: inventoryHi,
  settingsPages: settingsPagesHi,
  suppliers: suppliersHi,
  orders: ordersHi,
  shopTypes: shopTypesHi,
  workflows: workflowsHi,
} as const;
