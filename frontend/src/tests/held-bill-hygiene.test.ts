import { describe, expect, it } from "vitest";
import {
  formatHeldBillAge,
  heldBillAgeMs,
  HELD_BILL_MAX_AGE_MS,
  HELD_BILL_STALE_MS,
  isHeldBillStale,
  pruneExpiredHeldBills,
} from "@/features/core/billing/pages/open-bills";
import type { HeldBill } from "@/features/core/billing/pages/billing-types";

const NOW = new Date("2026-07-20T12:00:00Z").getTime();

function held(id: string, agoMs: number): HeldBill {
  return { id, label: id, createdAt: new Date(NOW - agoMs).toISOString(), cart: [] };
}

describe("held-bill age", () => {
  it("measures age in ms and tolerates a bad timestamp", () => {
    expect(heldBillAgeMs(held("a", 60_000), NOW)).toBe(60_000);
    expect(heldBillAgeMs({ id: "x", label: "x", createdAt: "not-a-date" } as HeldBill, NOW)).toBe(0);
  });

  it("formats a short human age", () => {
    expect(formatHeldBillAge(held("a", 30_000), NOW)).toBe("just now");
    expect(formatHeldBillAge(held("a", 5 * 60_000), NOW)).toBe("5m ago");
    expect(formatHeldBillAge(held("a", 3 * 60 * 60_000), NOW)).toBe("3h ago");
    expect(formatHeldBillAge(held("a", 2 * 24 * 60 * 60_000), NOW)).toBe("2d ago");
  });
});

describe("staleness threshold", () => {
  it("flags bills at or past the stale threshold", () => {
    expect(isHeldBillStale(held("a", HELD_BILL_STALE_MS - 1), NOW)).toBe(false);
    expect(isHeldBillStale(held("a", HELD_BILL_STALE_MS), NOW)).toBe(true);
    expect(isHeldBillStale(held("a", HELD_BILL_STALE_MS + 60_000), NOW)).toBe(true);
  });
});

describe("prune on load", () => {
  it("archives only bills older than the max age", () => {
    const bills = [
      held("fresh", 60_000),
      held("stale-but-kept", HELD_BILL_STALE_MS + 1),
      held("expired", HELD_BILL_MAX_AGE_MS + 1),
    ];
    const { kept, archived } = pruneExpiredHeldBills(bills, NOW);
    expect(archived).toBe(1);
    expect(kept.map((b) => b.id)).toEqual(["fresh", "stale-but-kept"]);
  });

  it("keeps everything when nothing is expired", () => {
    const bills = [held("a", 1000), held("b", HELD_BILL_MAX_AGE_MS - 1)];
    const { kept, archived } = pruneExpiredHeldBills(bills, NOW);
    expect(archived).toBe(0);
    expect(kept).toHaveLength(2);
  });
});
