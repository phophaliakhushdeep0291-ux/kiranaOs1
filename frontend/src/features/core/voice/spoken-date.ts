/**
 * Dates as a shop says them.
 *
 * Extracted from voice-command-parser so the customer parser can read a due date
 * without importing that module — which imports the customer parser back, and a
 * cycle between the two is the kind of thing that works until a bundler splits a
 * chunk differently.
 *
 * The date a shop gives for a promise to pay is spoken, not typed: "next
 * Friday", "15 September", "kal". All three land on the same YYYY-MM-DD the date
 * input expects.
 */

export function dateToInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Month names, plus the three-letter forms a recogniser tends to return. */
const MONTH_INDEX: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export function nextWeekday(targetDay: number, now = new Date()) {
  const result = new Date(now);
  result.setHours(12, 0, 0, 0);
  const diff = (targetDay - result.getDay() + 7) % 7 || 7;
  result.setDate(result.getDate() + diff);
  return dateToInputValue(result);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read a date out of a phrase, whichever way it was said.
 *
 * A month that has already passed this year is taken as NEXT year: a promise to
 * pay is always a future date, and filing "15 January" as ten months ago would
 * make the customer instantly overdue.
 */
export function readSpokenDate(raw: string, now = new Date()): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const explicit = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (explicit) return explicit;

  const slashDate = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slashDate) {
    const day = Number(slashDate[1]);
    const month = Number(slashDate[2]);
    const year = slashDate[3]
      ? Number(slashDate[3].length === 2 ? `20${slashDate[3]}` : slashDate[3])
      : now.getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // "15 September" and "September 15".
  const monthNames = Object.keys(MONTH_INDEX).join("|");
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b`, "i"));
  const monthFirst = text.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  const named = dayFirst
    ? { day: Number(dayFirst[1]), month: MONTH_INDEX[dayFirst[2].toLowerCase()] }
    : monthFirst
      ? { day: Number(monthFirst[2]), month: MONTH_INDEX[monthFirst[1].toLowerCase()] }
      : null;
  if (named && named.day >= 1 && named.day <= 31) {
    const thisYear = now.getFullYear();
    const candidate = new Date(thisYear, named.month - 1, named.day, 12);
    const year = candidate < now ? thisYear + 1 : thisYear;
    return `${year}-${String(named.month).padStart(2, "0")}-${String(named.day).padStart(2, "0")}`;
  }

  const weekday = text
    .match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1]
    ?.toLowerCase();
  if (weekday) return nextWeekday(WEEKDAY_INDEX[weekday], now);

  if (/\btomorrow\b/i.test(text) || /\bkal\b/i.test(text) || /कल/.test(text)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateToInputValue(tomorrow);
  }
  if (/\btoday\b/i.test(text) || /\baaj\b/i.test(text) || /आज/.test(text)) {
    return dateToInputValue(now);
  }
  // "in 7 days", "7 din baad" — a promise measured in days rather than named.
  const inDays = text.match(/\b(?:in|after|baad)\s+(\d{1,3})\s*(?:days?|din)\b/i)
    ?? text.match(/\b(\d{1,3})\s*(?:days?|din)\s+(?:later|baad|बाद)\b/i);
  if (inDays) {
    const later = new Date(now);
    later.setDate(later.getDate() + Number(inDays[1]));
    return dateToInputValue(later);
  }
  return undefined;
}

/**
 * Find a labelled date inside a command — "promise date next Friday".
 *
 * Kept as the older signature because voice-command-parser's customer and
 * payment paths already call it this way.
 */
export function parseSpokenDate(command: string, labels: string[]) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = command.match(new RegExp(`(?:${escaped})\\s+([^.;]+)`, "i"));
    if (!match) continue;
    const value = readSpokenDate(match[1]);
    if (value) return value;
  }
  return undefined;
}
