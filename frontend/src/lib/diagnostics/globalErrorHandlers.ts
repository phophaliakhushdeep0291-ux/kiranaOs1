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
