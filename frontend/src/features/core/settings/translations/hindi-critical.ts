// The Hindi strings the first paint actually needs: the app shell (nav, page
// chrome, dashboard) and billing.
//
// This split exists because main.tsx BLOCKS the mount on the Hindi chunk, and
// Hindi is the default language — so a brand-new shop, with nothing cached,
// waits for every Devanagari table in the product before it sees anything. Two
// thirds of that wait bought screens the shop was not opening: settings pages,
// inventory, reports, and two trade-specific tables.
//
// "Critical" is not a guess. routes.tsx warms exactly DashboardPage and
// BillingPage as "the two highest-frequency workspaces", and shell.ts is the
// module holding the `dashboard.`, `nav.`, `page.` and `chrome.` keys. This
// pair is the same boot path, expressed in strings.
//
// Nothing here may be imported statically from shell code — that would defeat
// the split and put the tables back into the startup download.
import { billingHi } from "./billing.hi";
import { shellHi } from "./shell.hi";

export const hindiCriticalTranslations = { ...shellHi, ...billingHi };

/** Registered critical modules. `hindi.ts` re-exports these into HI_MODULES. */
export const HI_CRITICAL_MODULES = {
  shell: shellHi,
  billing: billingHi,
} as const;
