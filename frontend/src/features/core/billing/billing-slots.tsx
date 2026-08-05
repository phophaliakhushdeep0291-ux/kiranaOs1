import type { ComponentType } from "react";

/**
 * Billing slots — the seam that lets one trade add a control to the shared bill
 * without billing importing that trade.
 *
 * A pharmacy has to attach the prescription authorising a Schedule H sale, but
 * only the pharmacy pack knows what a prescription is. `features/core` may never
 * import `features/verticals` — `src/tests/vertical-boundaries.test.ts` fails the
 * build over it — so a pack registers its control here and billing renders
 * whatever is registered.
 *
 * The server twin of this is `backend/src/shared/sale-guards.js`: the pharmacy
 * refuses the sale there and supplies the control to satisfy it here.
 *
 * The arrow points one way. A shop with no pack registered renders nothing and
 * pays one array-length check.
 */

export interface BillingSlotProps {
  /** Product ids currently in the cart, so a slot can decide if it applies. */
  productIds: string[];
  /** Opaque per-slot value held on the bill draft, keyed by slot id. */
  value: unknown;
  onChange: (value: unknown) => void;
}

export interface BillingSlot {
  /** Stable key. Also the key its value is stored under on the draft. */
  id: string;
  Component: ComponentType<BillingSlotProps>;
  /**
   * Whether this slot applies to the current cart. Returning false is the normal
   * case — an OTC basket must not sprout a prescription control.
   */
  appliesTo: (context: { productIds: string[]; products: Array<Record<string, unknown>> }) => boolean;
}

const slots: BillingSlot[] = [];

export function registerBillingSlot(slot: BillingSlot) {
  if (typeof slot?.Component !== "function") throw new TypeError("A billing slot needs a Component");
  if (slots.some((existing) => existing.id === slot.id)) return;
  slots.push(slot);
}

/** Slots that apply to this cart. Empty for every shop that registered none. */
export function billingSlotsFor(context: { productIds: string[]; products: Array<Record<string, unknown>> }): BillingSlot[] {
  if (slots.length === 0) return [];
  return slots.filter((slot) => slot.appliesTo(context));
}

/** Test seam: drop every registration so one suite cannot leak into the next. */
export function resetBillingSlots() {
  slots.length = 0;
}
