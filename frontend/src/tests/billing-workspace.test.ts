import { describe, expect, it, vi } from "vitest";
import {
  commitBillingWorkspace,
  prepareNewBillWorkspace,
  prepareResumeBillWorkspace,
  type BillingWorkspaceDatabase,
} from "@/features/core/billing/pages/billing-workspace";
import {
  BILLING_DRAFT_KEY,
  HELD_BILLS_KEY,
  MAX_OPEN_BILLS,
} from "@/features/core/billing/pages/open-bills";
import type {
  BillingDraft,
  HeldBill,
} from "@/features/core/billing/pages/billing-types";

function bill(id: string, itemCount = 1): HeldBill {
  return {
    id,
    label: `${id} bill`,
    createdAt: "2026-08-13T10:00:00.000Z",
    cart: Array.from({ length: itemCount }, () => ({})) as HeldBill["cart"],
  };
}

describe("billing workspace transitions", () => {
  it("prepares a held cart and a distinct empty active draft", () => {
    const transition = prepareNewBillWorkspace(
      [bill("parked")],
      bill("current", 3),
      "next-active",
    );

    expect(transition).toMatchObject({ ok: true });
    if (!transition.ok) return;
    expect(transition.snapshot.heldBills.map((entry) => entry.id)).toEqual([
      "current",
      "parked",
    ]);
    expect(transition.snapshot.activeDraft).toEqual({
      activeBillId: "next-active",
    });
  });

  it("refuses to evict an unrelated cart when all held slots are full", () => {
    const heldBills = Array.from({ length: MAX_OPEN_BILLS }, (_, index) =>
      bill(`parked-${index}`),
    );
    const transition = prepareNewBillWorkspace(
      heldBills,
      bill("current"),
      "next-active",
    );

    expect(transition).toEqual({ ok: false, reason: "open_bill_limit" });
    expect(heldBills.map((entry) => entry.id)).toEqual(
      Array.from({ length: MAX_OPEN_BILLS }, (_, index) => `parked-${index}`),
    );
  });

  it("resumes from a full set without dropping any unrelated held bill", () => {
    const heldBills = Array.from({ length: MAX_OPEN_BILLS }, (_, index) =>
      bill(`parked-${index}`, index + 1),
    );
    const transition = prepareResumeBillWorkspace(
      heldBills,
      bill("current", 2),
      "parked-4",
    );

    expect(transition).toMatchObject({ ok: true, target: { id: "parked-4" } });
    if (!transition.ok) return;
    expect(transition.snapshot.heldBills).toHaveLength(MAX_OPEN_BILLS);
    expect(transition.snapshot.heldBills.map((entry) => entry.id)).toEqual([
      "current",
      "parked-0",
      "parked-1",
      "parked-2",
      "parked-3",
      "parked-5",
      "parked-6",
      "parked-7",
      "parked-8",
      "parked-9",
    ]);
    expect(transition.snapshot.activeDraft).toMatchObject({
      activeBillId: "parked-4",
    });
  });

  it("does not manufacture a workspace when the selected held bill is gone", () => {
    expect(prepareResumeBillWorkspace([bill("one")], null, "missing")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("billing workspace durability", () => {
  const snapshot = {
    heldBills: [bill("held")],
    activeDraft: { activeBillId: "active" } satisfies BillingDraft,
  };

  it("writes held and active state in the same settings transaction before applying UI state", async () => {
    const writes: Array<[string, unknown]> = [];
    const events: string[] = [];
    const database: BillingWorkspaceDatabase = {
      async transaction(storeNames, callback) {
        expect(storeNames).toEqual(["settings"]);
        events.push("transaction:start");
        const result = await callback({
          async setSetting(key, value) {
            writes.push([key, value]);
          },
        });
        events.push("transaction:commit");
        return result;
      },
    };

    await commitBillingWorkspace(database, snapshot, () => {
      events.push("ui:apply");
    });

    expect(writes).toEqual([
      [HELD_BILLS_KEY, snapshot.heldBills],
      [BILLING_DRAFT_KEY, snapshot.activeDraft],
    ]);
    expect(events).toEqual([
      "transaction:start",
      "transaction:commit",
      "ui:apply",
    ]);
  });

  it("surfaces persistence failure and never clears or switches the UI", async () => {
    const applyCommittedSnapshot = vi.fn();
    const database: BillingWorkspaceDatabase = {
      async transaction(_storeNames, callback) {
        let writeCount = 0;
        return callback({
          async setSetting() {
            writeCount += 1;
            if (writeCount === 2) throw new Error("simulated quota failure");
          },
        });
      },
    };

    await expect(
      commitBillingWorkspace(database, snapshot, applyCommittedSnapshot),
    ).rejects.toThrow("simulated quota failure");
    expect(applyCommittedSnapshot).not.toHaveBeenCalled();
  });
});
