import { describe, expect, it } from "vitest";
import { userSafeSyncReason } from "@/features/core/sync/sync-reason";

/**
 * The reason on a change the server refused.
 *
 * A permanently-parked row waits for a person, so the line it shows them is the
 * whole intervention. The generic fallback says "Something went wrong while
 * backing this up. Please try sync again." — which is sound advice for a network
 * blip and useless for a rejection, because the same bytes will be refused every
 * time. So the rule is: show the server's sentence when it is one, and fall back
 * only when what arrived is machine output.
 */

const FALLBACK = "Something went wrong while backing this up. Please try sync again.";
const t = ((key: string) => (key === "sync.reason.fallback" ? FALLBACK : `<${key}>`)) as never;

describe("the reason shown for a refused change", () => {
  it("shows which field the server rejected", () => {
    // What the offline queue now writes. Before, the word "validation" alone
    // sent this to the fallback and the owner was told to try again forever.
    expect(userSafeSyncReason(t, "This change was rejected: items[0].enteredUnit is required"))
      .toBe("This change was rejected: items[0].enteredUnit is required");
    expect(userSafeSyncReason(t, "Validation failed: defaultPricePerRateUnit is required"))
      .toBe("Validation failed: defaultPricePerRateUnit is required");
  });

  it("still hides a raw ZodError dump", () => {
    const dump = JSON.stringify([{ code: "invalid_type", path: ["items", 0, "enteredUnit"], message: "Required" }]);
    expect(userSafeSyncReason(t, dump)).toBe(FALLBACK);
    expect(userSafeSyncReason(t, '{"code":"invalid_type","path":["mobile"]}')).toBe(FALLBACK);
    // Zod issue CODES only ever appear in such a dump, never in a formatted line.
    expect(userSafeSyncReason(t, "invalid_string at mobile")).toBe(FALLBACK);
    // A dump whose text happens to name a subject with its own wording gets that
    // wording rather than the generic line. Either way the owner never sees JSON.
    expect(userSafeSyncReason(t, '{"code":"too_small","path":["amount"]}')).toBe("<sync.reason.ledger>");
  });

  it("keeps the friendlier wording for the cases that have their own", () => {
    expect(userSafeSyncReason(t, "purchaseHistoryId missing")).toBe("<sync.reason.purchase>");
    expect(userSafeSyncReason(t, "Udhar payment exceeds outstanding")).toBe("<sync.reason.payment>");
    expect(userSafeSyncReason(t, "Server changed this record")).toBe("<sync.reason.changedElsewhere>");
  });

  it("falls back on nothing to say, and on an essay", () => {
    expect(userSafeSyncReason(t, "")).toBe(FALLBACK);
    expect(userSafeSyncReason(t, null)).toBe(FALLBACK);
    expect(userSafeSyncReason(t, undefined)).toBe(FALLBACK);
    // A wall of text on a counter screen is no more readable than JSON.
    expect(userSafeSyncReason(t, "x".repeat(161))).toBe(FALLBACK);
    expect(userSafeSyncReason(t, "x".repeat(160))).toBe("x".repeat(160));
  });

  it("honours a caller's own fallback", () => {
    expect(userSafeSyncReason(t, "", "Nothing recorded")).toBe("Nothing recorded");
  });
});
