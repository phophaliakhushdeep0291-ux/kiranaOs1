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
// is invisible to it. What covers them is `cacheFirstStatic`, which serves this
// build's cached copy and writes every successful script response into the
// runtime cache behind it — so this chunk is held from the first load onward,
// exactly like a lazy route chunk. (It was `networkFirstStatic` until the worker
// moved to cache-first; the guarantee is the same, the function is not.)
//
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download. The test in
// i18n-english-split.test.ts fails the build if i18n.tsx imports it as a value.
import { assistantEn } from "./assistant";
import { devicesEn } from "./devices";
import { assuranceEn } from "./assurance";
import { customersEn } from "./customers";
import { inventoryEn } from "./inventory";
import { manufacturingEn } from "./manufacturing";
import { ordersEn } from "./orders";
import { productsEn } from "./products";
import { reportsEn } from "./reports";
import { restaurantEn } from "./restaurant";
import { settingsPagesEn } from "./settings-pages";
import { shopTypesEn } from "./shop-types";
import { suppliersEn } from "./suppliers";
import { syncEn } from "./sync";
import { workflowsEn } from "./workflows";

export const englishDeferredTranslations = {
  ...productsEn,
  ...assistantEn,
  ...devicesEn,
  ...assuranceEn,
  ...customersEn,
  ...restaurantEn,
  ...reportsEn,
  ...manufacturingEn,
  ...inventoryEn,
  ...settingsPagesEn,
  ...suppliersEn,
  ...ordersEn,
  ...shopTypesEn,
  ...syncEn,
  ...workflowsEn,
};

/** Registered deferred modules. `english.ts` re-exports these into EN_MODULES. */
export const EN_DEFERRED_MODULES = {
  products: productsEn,
  assistant: assistantEn,
  devices: devicesEn,
  assurance: assuranceEn,
  customers: customersEn,
  restaurant: restaurantEn,
  reports: reportsEn,
  manufacturing: manufacturingEn,
  inventory: inventoryEn,
  settingsPages: settingsPagesEn,
  suppliers: suppliersEn,
  orders: ordersEn,
  shopTypes: shopTypesEn,
  sync: syncEn,
  workflows: workflowsEn,
} as const;
