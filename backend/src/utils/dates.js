const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const DAY_MS = 86_400_000;

function datePartsInTimeZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
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

export function daysBetweenInclusive(start, end) {
  return Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1;
}
