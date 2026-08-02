import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./index.css";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { installGlobalErrorHandlers } from "@/lib/diagnostics";
import { ACTIVITY_EVENTS, startActivityTracking, trackEvent } from "@/lib/activity";

registerServiceWorker();
installGlobalErrorHandlers();
startActivityTracking();
trackEvent(ACTIVITY_EVENTS.APP_LAUNCH);

createRoot(document.getElementById("root")!).render(<App />);
