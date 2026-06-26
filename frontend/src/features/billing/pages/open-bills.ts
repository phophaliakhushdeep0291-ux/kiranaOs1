import type { HeldBill } from "./billing-types";

// Pure helpers for the "multiple open bills" switcher — kept out of the page component so they
// can be unit-tested. An "open bill" is a parked cart (HeldBill); the one in the workspace is
// tracked by its id and saved back into the set when switching / starting a new bill.

export const MAX_OPEN_BILLS = 10;

export function newBillId(): string {
  return `bill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Insert or replace an open bill by id — in place (to keep the bar's order stable), else prepend. */
export function upsertOpenBill(list: HeldBill[], bill: HeldBill): HeldBill[] {
  const index = list.findIndex((entry) => entry.id === bill.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = bill;
    return next;
  }
  return [bill, ...list].slice(0, MAX_OPEN_BILLS);
}
