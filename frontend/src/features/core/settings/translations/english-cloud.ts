// The English tables that only an `onlineOnly` route can ever render.
//
// This is the string half of a rule the build already applies to code. Routes
// marked `onlineOnly` in routes.tsx render the shell's internet-required state
// instead of mounting their page, so vite.config.ts deliberately keeps those page
// chunks out of the service worker's offline install: caching them "cannot make
// the feature work offline; it only makes every shop download cloud-only
// administration UI during install". Their STRINGS were still in the deferred
// half, which IS precached — so every shop paid for copy that cannot appear on an
// offline till by construction, because the screen that would render it refuses
// to mount without a connection.
//
// Measured on the 2026-09-21 build (restaurant, the largest shop payload):
// moving assurance + devices out of the two deferred halves is -13.2 kB gzip of
// precache, 6.4 of it English and 6.8 Hindi.
//
// Only two modules qualify, and the other two candidates were checked rather than
// assumed — this is the whole test for admitting a table here:
//
//   assurance  -> read only under features/core/assurance/**, and all nine
//                 Assurance routes are onlineOnly. Qualifies.
//   devices    -> read only by DevicesPage, which is onlineOnly. Qualifies.
//   accounting -> REJECTED. Layout.tsx and MobileAppChrome.tsx read accounting.*
//                 for the nav, and ReportsPage reads it too. Both are shell/core
//                 and must render offline.
//   assistant  -> REJECTED. BillingAssistantStrip reads assistant.* on the
//                 BILLING screen, the highest-frequency offline surface there is.
//
// So the rule is not "does this feature need the cloud" but "can any offline
// screen read one of these keys". A table whose keys leak into core copy belongs
// in english-deferred.ts, whatever its feature needs at runtime.
//
// Loaded on demand by `loadCloudTranslations()` and held afterwards by the
// worker's `cacheFirstStatic`, the same runtime path that has always covered lazy
// route chunks. Nothing here may be imported statically from shell code.
import { assuranceEn } from "./assurance";
import { devicesEn } from "./devices";

export const englishCloudTranslations = {
  ...assuranceEn,
  ...devicesEn,
};

/** Registered cloud-only modules. `english.ts` re-exports these into EN_MODULES. */
export const EN_CLOUD_MODULES = {
  assurance: assuranceEn,
  devices: devicesEn,
} as const;
