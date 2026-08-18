import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { installGlobalErrorHandlers } from "@/lib/diagnostics";
import { ACTIVITY_EVENTS, startActivityTracking, trackEvent } from "@/lib/activity";
import { getInitialLanguage, loadCriticalHindiDictionary } from "@/features/core/settings/i18n";

registerServiceWorker();
installGlobalErrorHandlers();
startActivityTracking();
trackEvent(ACTIVITY_EVENTS.APP_LAUNCH);

function mount() {
  createRoot(document.getElementById("root")!).render(<App />);
}

/**
 * A Hindi shop must not watch its billing screen render in English and then swap.
 *
 * Waiting here rather than inside AppLanguageProvider is the difference between
 * extending a blank page that is already blank, and blanking an app that has already
 * painted. The race bounds it: if the Hindi chunk is slow on shop wifi the app still
 * mounts, in English, which is a complete dictionary rather than a broken screen.
 *
 * What is waited on is the CRITICAL half only — the shell and billing tables, the
 * same two workspaces routes.tsx warms. Hindi is the default language, so this wait
 * is on the first-ever load of every new shop, with nothing cached; blocking it on
 * settings, inventory, reports and the trade tables meant a blank screen paid for
 * strings the shop was not about to render. The rest is fetched straight after and
 * merged in when it lands, falling back to English in the gap.
 */
const HINDI_FIRST_PAINT_TIMEOUT_MS = 3000;

if (getInitialLanguage() === "hi") {
  void Promise.race([
    loadCriticalHindiDictionary(),
    new Promise((resolve) => setTimeout(resolve, HINDI_FIRST_PAINT_TIMEOUT_MS)),
  ]).then(mount, mount);
} else {
  mount();
}
