import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { installGlobalErrorHandlers } from "@/lib/diagnostics";
import { ACTIVITY_EVENTS, startActivityTracking, trackEvent } from "@/lib/activity";
import { getInitialLanguage, loadHindiDictionary } from "@/features/core/settings/i18n";

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
 */
const HINDI_FIRST_PAINT_TIMEOUT_MS = 3000;

if (getInitialLanguage() === "hi") {
  void Promise.race([
    loadHindiDictionary(),
    new Promise((resolve) => setTimeout(resolve, HINDI_FIRST_PAINT_TIMEOUT_MS)),
  ]).then(mount, mount);
} else {
  mount();
}
