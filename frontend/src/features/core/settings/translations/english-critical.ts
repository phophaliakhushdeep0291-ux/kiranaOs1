// The English strings the first paint actually needs: the app shell (nav, page
// chrome, dashboard) and billing.
//
// This half is STATIC — it is imported by i18n.tsx and therefore ships inside the
// startup chunk every merchant downloads. Everything else is in
// english-deferred.ts and is fetched after mount.
//
// English is split for a different reason than Hindi. Hindi was split because
// main.tsx BLOCKS the mount on its chunk. Nothing blocks on English; it is split
// because it is the only catalogue that is always present, so every key ever
// added grew the startup download for every shop in every language. Translating
// two secondary screens (suppliers, orders) added ~250 keys and pushed the raw
// startup budget over its ceiling with the gzip line 2.2 kB from its own.
//
// The pair here is the same boot path hindi-critical.ts uses, and for the same
// evidence: routes.tsx warms exactly DashboardPage and BillingPage as "the two
// highest-frequency workspaces", and shell.ts holds the `dashboard.`, `nav.`,
// `page.` and `chrome.` keys.
//
// A key belongs here if a shop can read it before it has navigated anywhere. In
// practice that is the shell, billing, and anything billing renders — which is
// why `billing.credit.*` lives in the billing table rather than with the report
// that also uses it.
import { billingEn } from "./billing";
import { shellEn } from "./shell";

export const englishCriticalTranslations = { ...shellEn, ...billingEn };

/** Registered critical modules. `english.ts` re-exports these into EN_MODULES. */
export const EN_CRITICAL_MODULES = {
  shell: shellEn,
  billing: billingEn,
} as const;
