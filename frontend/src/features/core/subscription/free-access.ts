import type { PlanCode } from "@/features/core/subscription/plans";

/**
 * Launch promotion: KiranaOS is free until 1 January 2027.
 *
 * The server half, backend/src/modules/subscription/freeAccess.js, decides what
 * the API allows. This half decides what the counter shows, and it has to stand
 * on its own: a till offline since before the promotion began still holds a
 * cached subscription that says "expired", and neither that nor an old device
 * licence may lock it out of a product that is currently free.
 *
 * Whose date wins: the server's, whenever this device has heard it. The server
 * sends `freeAccessUntil` with the subscription — the end of the window, or null
 * once it is shut — so moving FREE_ACCESS_UNTIL there reaches every till on its
 * next sync. A till that has not yet heard from a server that knows about the
 * promotion uses the date this build shipped with.
 */
const SHIPPED_FREE_ACCESS_UNTIL = "2027-01-01T00:00:00+05:30";

/** The plan every shop is entitled to while the promotion runs, as on the server. */
export const FREE_ACCESS_PLAN_CODE: PlanCode = "pro";

function builtInFreeAccessUntil(): string {
  // VITE_FREE_ACCESS_UNTIL moves the shipped date at build time. Tests pin it to a
  // past instant to exercise the paid enforcement that resumes once the window shuts.
  const configured: unknown = import.meta.env.VITE_FREE_ACCESS_UNTIL;
  return typeof configured === "string" && Number.isFinite(Date.parse(configured))
    ? configured
    : SHIPPED_FREE_ACCESS_UNTIL;
}

/**
 * The end of the free window as an ISO instant, or null once it has shut.
 *
 * `cached` is the subscription payload this device last stored from the server.
 */
export function freeAccessUntil(
  cached: Record<string, unknown> | null,
  now: number = Date.now(),
): string | null {
  const end = cached && "freeAccessUntil" in cached ? cached.freeAccessUntil : builtInFreeAccessUntil();
  if (typeof end !== "string") return null;
  const endMs = Date.parse(end);
  return Number.isFinite(endMs) && now < endMs ? new Date(endMs).toISOString() : null;
}

/** "1 January 2027". The window shuts at midnight IST, so the day is named in IST. */
export function formatFreeAccessDate(iso: string, language: "en" | "hi" = "en"): string {
  return new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}
