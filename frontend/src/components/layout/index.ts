import { setModulePathGate } from "@/features/core/settings/modules";
import { isVerticalPathActive } from "@/features/verticals/registry";

// Core owns the owner-facing module switches; the vertical registry owns which
// trade a route belongs to. They are married here rather than in `providers.tsx`
// so the shared spine never has to import one trade's code to know that another
// trade's screens are none of this shop's business.
//
// This barrel and not the app entry, because `providers.tsx` is in the startup
// shell: importing the module registry from there dragged `settings/modules` and
// `settings/business-types` — ~22 kB that had been lazy — into the first paint of
// every shop. The layout is itself lazy, and it loads before anything that reads
// the gate (sidebar, mobile drawer, dashboard shortcuts, Settings → Modules).
setModulePathGate(isVerticalPathActive);

export { Layout } from "./Layout";
