import type { Translate } from "@/features/core/settings/i18n";

/**
 * What to show an owner when the server refuses a queued change.
 *
 * The reason on a parked row is whatever the server said, which is written for
 * a developer. Some of it is worth showing and some of it is not, and getting
 * that wrong costs the owner the only clue they have: the generic line tells
 * them to sync again, which cannot work for a change the server will refuse
 * every time.
 */
export function userSafeSyncReason(t: Translate, rawReason: unknown, fallback?: string): string {
  const fallbackText = fallback ?? t("sync.reason.fallback");
  const text = typeof rawReason === "string" ? rawReason.trim() : "";
  if (!text) return fallbackText;
  const lower = text.toLowerCase();
  if (lower.includes("purchase") || lower.includes("stockledgerid") || lower.includes("purchasehistoryid") || lower.includes("purchasebillid")) {
    return t("sync.reason.purchase");
  }
  if (lower.includes("ledger") || (lower.includes("amount") && (lower.includes("too_small") || lower.includes("greater than or equal")))) {
    return t("sync.reason.ledger");
  }
  if (lower.includes("payment") || lower.includes("udhar")) {
    return t("sync.reason.payment");
  }
  if (lower.includes("server changed") || lower.includes("unsynced local changes")) {
    return t("sync.reason.changedElsewhere");
  }
  // Raw ZodError JSON is unreadable, so it is replaced with the generic line.
  // The word "validation" used to be on this list, back when a rejected change
  // arrived as a serialised issue array; the server now sends one sentence
  // naming the field ("items[0].enteredUnit is required"), and swallowing that
  // leaves the owner with "please try sync again" — advice that cannot work,
  // because the server will refuse the same bytes every time. The shape checks
  // below still catch anything that really is a JSON dump. `invalid_string` and
  // `too_small` are Zod issue CODES, which only ever appear in such a dump.
  if (
    lower.includes("invalid_string") ||
    lower.includes("too_small") ||
    lower.includes("\"path\"") ||
    lower.includes("\"code\"") ||
    text.startsWith("[") ||
    text.startsWith("{")
  ) {
    return fallbackText;
  }
  // Anything that survives to here is the server's own sentence, which arrives in
  // English whatever the app language is. Showing it beats hiding the only clue the
  // owner has; the classified cases above are what keep that rare.
  return text.length > 160 ? fallbackText : text;
}
