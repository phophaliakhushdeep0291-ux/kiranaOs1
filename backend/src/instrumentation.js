// This file is loaded through Node's --import flag before the API or worker
// entrypoint. Sentry's ESM instrumentation must initialize before framework and
// database modules are imported so automatic error context is reliable.
import { initErrorTracking } from "./lib/errorTracking.js";

initErrorTracking();
