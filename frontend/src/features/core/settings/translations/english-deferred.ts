// Every English table that is not on the boot path, fetched after the app has
// mounted rather than shipped in the startup chunk.
//
// A key from one of these tables that is read before this chunk lands renders as
// the key itself. That is the one real cost of splitting English, and it is
// bounded by an ordering that holds by construction: the fetch is kicked off at
// module scope in i18n.tsx, before the first render, while every screen these
// tables serve sits behind a lazy route chunk that is not requested until the
// owner navigates to it. So this chunk is always asked for first, and a network
// too poor to deliver it is also too poor to deliver the screen that would have
// shown the gap.
//
// Offline is covered by the same path the Hindi chunks already rely on rather
// than by precaching: neither half is in the service worker's CORE_ASSETS,
// because that list is walked from the STATIC import graph and a dynamic import
// is invisible to it. What covers them is `networkFirstStatic`, which writes
// every successful script response into the runtime cache — so this chunk is
// held from the first load onward, exactly like a lazy route chunk.
//
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download. The test in
// i18n-english-split.test.ts fails the build if i18n.tsx imports it as a value.
import { assuranceEn } from "./assurance";
import { customersEn } from "./customers";
import { inventoryEn } from "./inventory";
import { manufacturingEn } from "./manufacturing";
import { ordersEn } from "./orders";
import { productsEn } from "./products";
import { reportsEn } from "./reports";
import { restaurantEn } from "./restaurant";
import { settingsPagesEn } from "./settings-pages";
import { suppliersEn } from "./suppliers";

export const englishDeferredTranslations = {
  ...productsEn,
  ...assuranceEn,
  ...customersEn,
  ...restaurantEn,
  ...reportsEn,
  ...manufacturingEn,
  ...inventoryEn,
  ...settingsPagesEn,
  ...suppliersEn,
  ...ordersEn,
};

/** Registered deferred modules. `english.ts` re-exports these into EN_MODULES. */
export const EN_DEFERRED_MODULES = {
  products: productsEn,
  assurance: assuranceEn,
  customers: customersEn,
  restaurant: restaurantEn,
  reports: reportsEn,
  manufacturing: manufacturingEn,
  inventory: inventoryEn,
  settingsPages: settingsPagesEn,
  suppliers: suppliersEn,
  orders: ordersEn,
} as const;
