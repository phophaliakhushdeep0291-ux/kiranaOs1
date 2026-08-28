import type { BillingDraft, HeldBill } from "./billing-types";
import {
  BILLING_DRAFT_KEY,
  billingDraftFromHeldBill,
  HELD_BILLS_KEY,
  upsertOpenBill,
  wouldEvictOpenBill,
} from "./open-bills";

export interface BillingWorkspaceSnapshot {
  heldBills: HeldBill[];
  activeDraft: BillingDraft;
}

interface BillingWorkspaceTransaction {
  setSetting<Value>(key: string, value: Value): Promise<void>;
}

export interface BillingWorkspaceDatabase {
  transaction<T>(
    storeNames: string[],
    callback: (transaction: BillingWorkspaceTransaction) => Promise<T>,
  ): Promise<T>;
}

export type NewBillWorkspaceTransition =
  | { ok: true; snapshot: BillingWorkspaceSnapshot }
  | { ok: false; reason: "open_bill_limit" };

export type ResumeBillWorkspaceTransition =
  | { ok: true; target: HeldBill; snapshot: BillingWorkspaceSnapshot }
  | { ok: false; reason: "not_found" };

/**
 * A successful sale retires the cart that owned its client bill id.
 * Table service keeps the active table in the held set so the floor can see it;
 * failing to remove it here leaves the table occupied with an already-paid
 * order. Ordinary counter bills are unaffected because they are not held.
 */
export function prepareSettledBillWorkspace(
  heldBills: HeldBill[],
  settledBillId: string | undefined,
  nextActiveBillId: string,
): BillingWorkspaceSnapshot {
  return {
    heldBills: settledBillId
      ? heldBills.filter((bill) => bill.id !== settledBillId)
      : heldBills,
    activeDraft: { activeBillId: nextActiveBillId },
  };
}

/**
 * Build the next durable workspace before the UI clears the current bill.
 * Interactive holds refuse to discard an older bill when the parked-bill cap
 * is full; imported-list hygiene can continue to use the capped upsert helper.
 */
export function prepareNewBillWorkspace(
  heldBills: HeldBill[],
  currentBill: HeldBill | null,
  nextActiveBillId: string,
): NewBillWorkspaceTransition {
  if (currentBill && wouldEvictOpenBill(heldBills, currentBill)) {
    return { ok: false, reason: "open_bill_limit" };
  }

  return {
    ok: true,
    snapshot: {
      heldBills: currentBill ? upsertOpenBill(heldBills, currentBill) : heldBills,
      activeDraft: { activeBillId: nextActiveBillId },
    },
  };
}

/**
 * Remove the target before parking the current bill. This ordering matters at
 * the 10-bill cap: it creates a free slot and prevents an unrelated oldest
 * bill from being truncated by upsertOpenBill.
 */
export function prepareResumeBillWorkspace(
  heldBills: HeldBill[],
  currentBill: HeldBill | null,
  targetId: string,
): ResumeBillWorkspaceTransition {
  const target = heldBills.find((bill) => bill.id === targetId);
  if (!target) return { ok: false, reason: "not_found" };

  const remainingBills = heldBills.filter((bill) => bill.id !== targetId);
  return {
    ok: true,
    target,
    snapshot: {
      heldBills: currentBill
        ? upsertOpenBill(remainingBills, currentBill)
        : remainingBills,
      activeDraft: billingDraftFromHeldBill(target),
    },
  };
}

/**
 * Commit both halves of the billing workspace in one IndexedDB transaction.
 * If either write fails, Dexie rolls the transaction back and the caller must
 * keep the current UI state intact.
 */
export async function persistBillingWorkspace(
  database: BillingWorkspaceDatabase,
  snapshot: BillingWorkspaceSnapshot,
): Promise<void> {
  await database.transaction(["settings"], async (transaction) => {
    await transaction.setSetting(HELD_BILLS_KEY, snapshot.heldBills);
    await transaction.setSetting(BILLING_DRAFT_KEY, snapshot.activeDraft);
  });
}

/** Apply React/in-memory state only after the durable transaction succeeds. */
export async function commitBillingWorkspace(
  database: BillingWorkspaceDatabase,
  snapshot: BillingWorkspaceSnapshot,
  applyCommittedSnapshot: (snapshot: BillingWorkspaceSnapshot) => void,
): Promise<void> {
  await persistBillingWorkspace(database, snapshot);
  applyCommittedSnapshot(snapshot);
}
