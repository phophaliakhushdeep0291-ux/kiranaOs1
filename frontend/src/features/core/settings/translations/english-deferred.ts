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
// Offline used to be covered by `cacheFirstStatic` alone — this chunk was
// invisible to CORE_ASSETS, which is walked from the STATIC import graph, so a
// dynamic import never appeared in it. That is NO LONGER how this works: on
// 2026-09-16 vite.config.ts added this file to `criticalEntries` by name, because
// an install could otherwise be declared ready while a cold restart still needed
// a dictionary it did not have. This chunk IS precached now, and it is the single
// largest English contributor to the offline install, so what lives in it is a
// per-shop download decision and not a filing one.
//
// Which is why there is a third tier next door. A table only an `onlineOnly`
// route can render belongs in english-cloud.ts, which is deliberately left out of
// CORE_ASSETS and still covered by `cacheFirstStatic` the way this file once was.
// Anything an offline screen can read belongs here. See english-cloud.ts for the
// test that decides, and for the two tables that failed it.
//
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download. The test in
// i18n-english-split.test.ts fails the build if i18n.tsx imports it as a value.
import { accountingEn } from "./accounting";
import { assistantEn } from "./assistant";
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
  ...accountingEn,
  ...assistantEn,
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
  accounting: accountingEn,
  assistant: assistantEn,
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
