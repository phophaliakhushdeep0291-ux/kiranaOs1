// A small in-memory ring buffer of recent client activity. It powers two things:
//   1. the "Report Issue" bundle (recent API calls / errors / navigation), and
//   2. lightweight breadcrumbs attached to captured errors.
// It intentionally imports nothing from the API layer so `http.ts` can push into
// it without creating an import cycle. Everything is capped and query strings are
// stripped so no tokens/PII ride along in a path.

export type ApiBreadcrumb = { kind: "api"; ts: number; method: string; path: string; status: number; durationMs: number };
export type RouteBreadcrumb = { kind: "route"; ts: number; path: string };
export type ErrorBreadcrumb = { kind: "error"; ts: number; message: string; source: string };
export type Breadcrumb = ApiBreadcrumb | RouteBreadcrumb | ErrorBreadcrumb;

const MAX_BREADCRUMBS = 60;
const buffer: Breadcrumb[] = [];

function push(entry: Breadcrumb): void {
  buffer.push(entry);
  if (buffer.length > MAX_BREADCRUMBS) buffer.splice(0, buffer.length - MAX_BREADCRUMBS);
}

function stripQuery(path: string): string {
  const q = path.indexOf("?");
  return q >= 0 ? path.slice(0, q) : path;
}

export function recordApiBreadcrumb(entry: { method: string; path: string; status: number; durationMs: number }): void {
  push({ kind: "api", ts: Date.now(), method: entry.method, path: stripQuery(entry.path), status: entry.status, durationMs: Math.round(entry.durationMs) });
}

export function recordRouteBreadcrumb(path: string): void {
  push({ kind: "route", ts: Date.now(), path: stripQuery(path) });
}

export function recordErrorBreadcrumb(message: string, source: string): void {
  push({ kind: "error", ts: Date.now(), message: message.slice(0, 300), source });
}

export function getRecentBreadcrumbs(limit = 40): Breadcrumb[] {
  return buffer.slice(-limit);
}

export function getRecentApiRequests(limit = 15): ApiBreadcrumb[] {
  return buffer.filter((b): b is ApiBreadcrumb => b.kind === "api").slice(-limit);
}

export function getRecentErrors(limit = 10): ErrorBreadcrumb[] {
  return buffer.filter((b): b is ErrorBreadcrumb => b.kind === "error").slice(-limit);
}

export function clearTelemetryBuffer(): void {
  buffer.length = 0;
}
