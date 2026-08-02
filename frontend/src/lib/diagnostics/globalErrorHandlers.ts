import { recordErrorBreadcrumb } from "./telemetryBuffer";
import { reportErrorToBackend, type ClientErrorReport } from "./diagnosticsClient";

let installed = false;

// De-dupe identical errors and cap volume so a render loop can't flood the
// backend or the network. Same fingerprint at most once per minute; at most 20
// distinct reports per rolling minute.
const lastSentAt = new Map<string, number>();
const DEDUPE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_MINUTE = 20;
let windowStartedAt = Date.now();
let reportsInWindow = 0;

function throttleAllows(fingerprint: string): boolean {
  const now = Date.now();
  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    reportsInWindow = 0;
  }
  if (reportsInWindow >= MAX_REPORTS_PER_MINUTE) return false;
  const last = lastSentAt.get(fingerprint) ?? 0;
  if (now - last < DEDUPE_WINDOW_MS) return false;
  lastSentAt.set(fingerprint, now);
  reportsInWindow += 1;
  return true;
}

/**
 * reportClientError — record a breadcrumb and (throttled) forward the error to
 * the backend. Exposed so the ErrorBoundary and other call sites report through
 * the same de-dupe/rate-limit path.
 */
export function reportClientError(input: ClientErrorReport & { source: string }): void {
  const message = (input.message || "Unknown error").slice(0, 1000);
  recordErrorBreadcrumb(message, input.source);
  if (!throttleAllows(`${input.source}:${message}`.slice(0, 300))) return;
  void reportErrorToBackend({ ...input, message });
  // §13's ERROR_OCCURRED. The full error (with stack) still goes to the error
  // store above; this records only that an error happened here, so "common
  // system errors" can be read alongside the rest of the user's activity — on
  // the same throttle, so a render loop cannot flood either pipeline.
  void trackActivityError(message, input);
}

/**
 * Imported lazily so the activity SDK never ends up in the module graph of the
 * error handlers themselves — a failure in tracking must not be able to break
 * the code whose job is to report failures.
 */
function trackActivityError(message: string, input: ClientErrorReport & { source: string }): void {
  void import("@/lib/activity")
    .then(({ ACTIVITY_EVENTS, trackEvent }) => {
      trackEvent(ACTIVITY_EVENTS.ERROR_OCCURRED, {
        source: input.source,
        errorCode: input.errorCode,
        // The message can contain a customer's name or a product string; the
        // shape of the failure is what the activity report needs, not its text.
        fileName: input.fileName,
        lineNumber: input.lineNumber,
        length: message.length,
      });
    })
    .catch(() => undefined);
}

/** Install window-level capture for uncaught errors and unhandled rejections. */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // Resource-load errors (img/script/link) surface here with no Error object; skip them.
    if (!event.error && !event.message) return;
    reportClientError({
      source: "window.onerror",
      message: event.message || event.error?.message || "Unknown error",
      stack: event.error?.stack,
      fileName: event.filename || undefined,
      lineNumber: Number.isFinite(event.lineno) ? event.lineno : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason as { message?: string; stack?: string; data?: { code?: string } } | undefined;
    reportClientError({
      source: "unhandledrejection",
      message: reason?.message || String(reason ?? "Unhandled promise rejection"),
      stack: reason?.stack,
      errorCode: reason?.data?.code,
    });
  });
}
