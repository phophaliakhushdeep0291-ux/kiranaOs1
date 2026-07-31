/**
 * Inclusive date-range bounds for `?from=YYYY-MM-DD&to=YYYY-MM-DD` filters.
 *
 * `new Date("2026-07-31")` is midnight UTC, so a naive `lte: new Date(to)` matches
 * only the very first instant of the last day and silently drops everything
 * recorded during it. Every dashboard/report range ends on TODAY, so this dropped
 * the current day's bills from every total and chart — the Sales Overview line sat
 * flat on ₹0 while the "Today's Sales" tile (a different query) showed real money.
 *
 * A date-only `to` therefore extends to the end of that day. A caller that passes a
 * full timestamp means a precise instant, so it is used as given.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function rangeStart(from) {
  if (!from) return undefined;
  const parsed = new Date(from);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function rangeEndInclusive(to) {
  if (!to) return undefined;
  if (typeof to === "string" && DATE_ONLY.test(to.trim())) {
    const parsed = new Date(`${to.trim()}T23:59:59.999Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  const parsed = new Date(to);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
