import { describe, expect, it } from "vitest";
import { outboxPushRank } from "@/lib/offline/db";

/**
 * A sale must not queue behind a catalogue import.
 *
 * Driving a fresh shop end to end surfaced this: register, load the 560-item
 * starter catalogue in one click, then make the first sale. The outbox was strict
 * creation order, so that first bill — the only row carrying money — sat behind
 * roughly 560 product rows and was the LAST thing to reach the server. On the
 * connections these shops actually have, that is the wrong way round: the rows
 * worth protecting if the till is lost are the ones carrying money.
 *
 * `outboxPushRank` is the whole rule, so these tests pin the behaviour rather
 * than the implementation.
 */

const row = (operation_type: string) => ({ operation_type });

describe("outboxPushRank", () => {
  it("ranks a bill ahead of a product row", () => {
    expect(outboxPushRank(row("CREATE_BILL"))).toBeLessThan(outboxPushRank(row("CREATE_PRODUCT")));
  });

  it("ranks udhar collection and its reversal ahead of catalogue work", () => {
    for (const money of ["RECORD_PAYMENT", "REVERSE_PAYMENT", "CREATE_LEDGER_ADJUSTMENT"]) {
      expect(outboxPushRank(row(money)), money).toBeLessThan(outboxPushRank(row("UPDATE_PRODUCT")));
    }
  });

  it("keeps stock movement with the money rows, since it settles against a bill", () => {
    for (const stock of ["STOCK_SALE", "STOCK_PURCHASE", "STOCK_PURCHASE_BATCH", "STOCK_CORRECTION"]) {
      expect(outboxPushRank(row(stock)), stock).toBe(0);
    }
  });

  it("leaves catalogue, settings and housekeeping in the trailing rank", () => {
    for (const bulk of ["CREATE_PRODUCT", "UPDATE_PRODUCT", "BIND_PRODUCT_BARCODE", "UPDATE_SETTINGS", "AUDIT_LOG_APPEND", "SUBSCRIPTION_REFRESH"]) {
      expect(outboxPushRank(row(bulk)), bulk).toBe(1);
    }
  });

  it("gives every row of one kind the same rank, so creation order still decides within a kind", () => {
    // This is what keeps a bill and its later cancellation in sequence: both are
    // rank 0, and the sort that applies this rank is stable.
    expect(outboxPushRank(row("CREATE_BILL"))).toBe(outboxPushRank(row("CANCEL_BILL_PENDING")));
    expect(outboxPushRank(row("CREATE_PRODUCT"))).toBe(outboxPushRank(row("UPDATE_PRODUCT")));
  });

  it("does not starve an unknown operation behind the catalogue", () => {
    // An operation added later and not listed is treated as ordinary work, not as
    // bulk — the failure mode of guessing wrong should be "pushed a bit early".
    expect(outboxPushRank(row("SOME_FUTURE_OPERATION"))).toBe(1);
  });
});

describe("the ordering a queue of starter-catalog rows plus one sale produces", () => {
  it("puts the sale first even though it was created last", () => {
    const queue = [
      ...Array.from({ length: 560 }, (_, index) => ({ operation_type: "CREATE_PRODUCT", createdAt: index })),
      { operation_type: "AUDIT_LOG_APPEND", createdAt: 560 },
      { operation_type: "CREATE_BILL", createdAt: 561 },
    ];
    // Same expression getPendingEvents applies, over rows already in creation order.
    const ordered = [...queue].sort((a, b) => outboxPushRank(a) - outboxPushRank(b));
    expect(ordered[0]).toMatchObject({ operation_type: "CREATE_BILL", createdAt: 561 });
  });

  it("still drains the catalogue in the order it was created", () => {
    const queue = [
      { operation_type: "CREATE_PRODUCT", createdAt: 1 },
      { operation_type: "CREATE_BILL", createdAt: 2 },
      { operation_type: "CREATE_PRODUCT", createdAt: 3 },
    ];
    const ordered = [...queue].sort((a, b) => outboxPushRank(a) - outboxPushRank(b));
    expect(ordered.map((entry) => entry.createdAt)).toEqual([2, 1, 3]);
  });
});
