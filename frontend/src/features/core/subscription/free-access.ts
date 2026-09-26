import { BUSINESS_TYPE_IDS, type BusinessType } from "@/features/core/settings/business-type-store";
import {
  FEATURE_LABELS,
  PLAN_ORDER,
  getPlanForBusinessType,
  type FeatureName,
  type PlanCode,
  type PlanDefinition,
} from "@/features/core/subscription/plans";

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

/** The plan code every shop holds while the promotion runs, as on the server. */
export const FREE_ACCESS_PLAN_CODE: PlanCode = "pro";

// Every plan the product sells, in every trade, and every feature the app knows.
const EVERY_PLAN = PLAN_ORDER.flatMap((code) => BUSINESS_TYPE_IDS.map((type) => getPlanForBusinessType(code, type)));
const EVERY_FEATURE = Object.keys(FEATURE_LABELS) as FeatureName[];
const highest = (limit: "maxDevices" | "maxStaff" | "maxStores") => Math.max(...EVERY_PLAN.map((plan) => plan[limit]));

/**
 * What a shop is entitled to while the promotion runs: the whole product, as
 * freeAccessPlan grants it on the server. The trade's own top plan was not enough:
 * it left other trades' modules locked behind an upgrade nobody could buy, though
 * any shop can switch them on, and it held a grocer to 3 stores and 10 staff. The
 * name and price stay the trade's own top plan's, because that is what it is called.
 */
export function freeAccessPlan(businessType: BusinessType): PlanDefinition {
  return {
    ...getPlanForBusinessType(FREE_ACCESS_PLAN_CODE, businessType),
    features: [...EVERY_FEATURE],
    maxDevices: highest("maxDevices"),
    maxStaff: highest("maxStaff"),
    maxStores: highest("maxStores"),
  };
}

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

/**
 * Days before the window shuts that plans go back on sale, as on the server.
 *
 * Until then checkout is refused, because the shop already has everything. In this
 * last month it can buy ahead, and what it buys starts when the window shuts — so
 * its first bill and its first lockout are not the same midnight.
 */
export const FREE_ACCESS_PRESALE_DAYS = 31;

/** When buying ahead opens, for a window that shuts at `until`. */
export function freeAccessPresaleFrom(until: string): string {
  return new Date(Date.parse(until) - FREE_ACCESS_PRESALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Inside the window, and close enough to its end that plans are on sale again. */
export function isFreeAccessPresale(until: string | null, now: number = Date.now()): boolean {
  if (!until) return false;
  const end = Date.parse(until);
  return Number.isFinite(end) && now >= Date.parse(freeAccessPresaleFrom(until)) && now < end;
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
