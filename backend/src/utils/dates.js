const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const DAY_MS = 86_400_000;

/**
 * One formatter per time zone, built once.
 *
 * Constructing an Intl.DateTimeFormat loads ICU time-zone data and is one of
 * the most expensive things V8 does; formatting with an existing one is cheap.
 * This function is the bottom of every report that buckets by day or month, so
 * a shop with a few hundred bills called it a few hundred times per request and
 * built a few hundred formatters. On a 400-bill day it was 83% of the entire
 * monthly-breakdown request — more than the database, the HTTP stack and every
 * other line of the app put together.
 *
 * A formatter holds no per-call state, so reusing one returns byte-identical
 * output. The Map is keyed by time zone and stays tiny: a shop has one.
 */
const zonedFormatters = new Map();

function formatterFor(timeZone) {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zonedFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function datePartsInTimeZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = formatterFor(timeZone).formatToParts(date);
  // A plain loop rather than filter/map/fromEntries: this runs once per bill per
  // report, and the three intermediate arrays it used to allocate were the next
  // cost down once the formatter stopped being rebuilt.
  const result = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    if (part.type === "literal") continue;
    if (part.type in result) result[part.type] = Number(part.value);
  }
  return result;
}

function zonedWallTimeToUtc({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }, timeZone = DEFAULT_TIME_ZONE) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const parts = datePartsInTimeZone(guess, timeZone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, millisecond);
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const offset = zonedAsUtc - guess.getTime();
  return new Date(wantedAsUtc - offset);
}

export function formatDateInTimeZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = datePartsInTimeZone(date instanceof Date ? date : new Date(date), timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function dateRangeForDateOnly(dateString, timeZone = DEFAULT_TIME_ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ""))) {
    throw new Error("date must be YYYY-MM-DD");
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const start = zonedWallTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone);
  const nextStart = zonedWallTimeToUtc({ year, month, day: day + 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone);
  return { start, end: new Date(nextStart.getTime() - 1), dateKey: dateString, timeZone };
}

export function startOfZonedDay(date, timeZone = DEFAULT_TIME_ZONE) {
  return dateRangeForDateOnly(formatDateInTimeZone(date, timeZone), timeZone).start;
}

export function endOfZonedDay(date, timeZone = DEFAULT_TIME_ZONE) {
  return dateRangeForDateOnly(formatDateInTimeZone(date, timeZone), timeZone).end;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/**
 * Returns start and end Date objects for common report ranges in the shop's timezone.
 */
export function getDateRange(range, from, to, timeZone = DEFAULT_TIME_ZONE) {
  const todayKey = formatDateInTimeZone(new Date(), timeZone);

  if (range === "daily") {
    return dateRangeForDateOnly(todayKey, timeZone);
  }

  if (range === "weekly") {
    const today = new Date(`${todayKey}T00:00:00.000Z`);
    const day = today.getUTCDay();
    const startKey = addDaysToDateKey(todayKey, -day);
    return { start: dateRangeForDateOnly(startKey, timeZone).start, end: dateRangeForDateOnly(todayKey, timeZone).end, dateKey: todayKey, timeZone };
  }

  if (range === "monthly") {
    const [year, month] = todayKey.split("-").map(Number);
    const startKey = `${year}-${String(month).padStart(2, "0")}-01`;
    return { start: dateRangeForDateOnly(startKey, timeZone).start, end: dateRangeForDateOnly(todayKey, timeZone).end, dateKey: todayKey, timeZone };
  }

  if (range === "yearly") {
    const [year] = todayKey.split("-").map(Number);
    const startKey = `${year}-01-01`;
    return { start: dateRangeForDateOnly(startKey, timeZone).start, end: dateRangeForDateOnly(todayKey, timeZone).end, dateKey: todayKey, timeZone };
  }

  if (from && to) {
    const startRange = dateRangeForDateOnly(String(from).slice(0, 10), timeZone);
    const endRange = dateRangeForDateOnly(String(to).slice(0, 10), timeZone);
    return { start: startRange.start, end: endRange.end, dateKey: startRange.dateKey, timeZone };
  }

  return dateRangeForDateOnly(todayKey, timeZone);
}

// `start` is the start-of-day (00:00:00.000) of the first day in the range and `end` the
// end-of-day (23:59:59.999) of the last, as produced by the report date helpers. An N-day
// inclusive range therefore spans (N − ε) days, so rounding recovers N exactly.
// NOTE: a previous `Math.ceil(...) + 1` double-counted — it inflated every range by one day,
// which rejected the standard 7-day report on the base plan (8 > 7) and the full 30/31-day
// ranges on the paid plans. Do not reintroduce the +1.
export function daysBetweenInclusive(start, end) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}
