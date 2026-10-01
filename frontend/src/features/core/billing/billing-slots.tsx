import type { ComponentType } from "react";
import type { CartItem } from "./pages/billing-types";

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
  /** The lines themselves, for a control that needs quantities and names as well. */
  cart?: CartItem[];
  /** Opaque per-slot value held on the bill draft, keyed by slot id. */
  value: unknown;
  onChange: (value: unknown) => void;
}

/** The part of a bill line a slot may rewrite. Both the payload's lines and the totals' lines have it. */
export interface BillingLine {
  productId?: string;
  quantity: number;
  /** Flat rupees off this whole line, not per unit. */
  lineDiscount?: number;
  trackedUnitId?: string;
}

export interface BillingItemsContext {
  /** Whether the bill can reach the server right now. A slot must not promise what only the server can keep. */
  online: boolean;
}

export interface BillingSlot {
  /** Stable key. Also the key its value is stored under on the draft. */
  id: string;
  Component: ComponentType<BillingSlotProps>;
  /**
   * Rewrites the bill's lines before they are priced and before they are sent.
   *
   * An electronics shop turns "2 × handset" into one line per IMEI, so a return
   * can name the exact unit. Billing runs this once for the payable it shows and
   * once for the payload, with the same inputs — GST is rounded per line, so a
   * total worked out on two lines and a bill sent as one differ by a paisa, and
   * the server refuses a payment that does not equal its own total.
   *
   * Pure, and generic over the line so it cannot know which of the two it has.
   */
  prepareItems?: <Line extends BillingLine>(items: Line[], value: unknown, context: BillingItemsContext) => Line[];
  /**
   * A bill this slot applies to is saved on the server, not queued on the device.
   *
   * For a control whose whole point is a record the server keeps in step with
   * the bill: a prescription is closed by the sale that dispenses it, and a till
   * that queued the bill would be told "saved" about a slip another counter can
   * still spend.
   */
  requiresOnline?: boolean;
  /**
   * Whether this slot applies to the current cart. Returning false is the normal
   * case — an OTC basket must not sprout a prescription control.
   */
  appliesTo: (context: BillingSlotContext) => boolean;
}

export interface BillingSlotContext {
  productIds: string[];
  products: Array<Record<string, unknown>>;
  /** The shop's trade. A registration outlives a switch to another shop in the same session. */
  businessType?: string;
  /** Every slot's held value, so a control already in use stays on the bill it is in use on. */
  values?: Record<string, unknown>;
}

const slots: BillingSlot[] = [];

export function registerBillingSlot(slot: BillingSlot) {
  if (typeof slot?.Component !== "function") throw new TypeError("A billing slot needs a Component");
  if (slots.some((existing) => existing.id === slot.id)) return;
  slots.push(slot);
}

/** Slots that apply to this cart. Empty for every shop that registered none. */
export function billingSlotsFor(context: BillingSlotContext): BillingSlot[] {
  if (slots.length === 0) return [];
  return slots.filter((slot) => slot.appliesTo(context));
}

/** The lines as the active slots leave them. With no slot rewriting anything, the same array. */
export function prepareBillingItems<Line extends BillingLine>(
  active: BillingSlot[],
  values: Record<string, unknown>,
  items: Line[],
  context: BillingItemsContext,
): Line[] {
  return active.reduce((result, slot) => slot.prepareItems?.(result, values[slot.id], context) ?? result, items);
}

/** Test seam: drop every registration so one suite cannot leak into the next. */
export function resetBillingSlots() {
  slots.length = 0;
}
