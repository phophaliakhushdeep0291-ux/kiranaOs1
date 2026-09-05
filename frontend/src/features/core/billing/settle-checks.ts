import type { TranslationKey, TranslationVars } from "@/features/core/settings/i18n";
import type { CartItem } from "./pages/billing-types";

/**
 * Something a trade wants said before money changes hands.
 *
 * The sibling of `product-configurators`: a vertical registers a check, core
 * billing runs it on the way into a confirm and shows what comes back. Core
 * never learns what the check is about — it asks "is there anything to say
 * about this bill?" and renders the answer.
 *
 * This exists because of one thing a restaurant could do and nothing stopped:
 * settle a table whose food had never been sent to the kitchen. Firing a ticket
 * is a deliberate act by staff (`fireKitchenTicket` has one caller, the Fire
 * button), which is right — but the till knew nothing about it, so a table
 * carrying "2 to fire" took the money without a word, and the guests paid in
 * full for food nobody had been asked to cook.
 *
 * A check warns; it does not refuse. The cashier is standing in front of the
 * guest and knows things the software does not — the kitchen may have been told
 * by voice on a quiet evening. Blocking the sale would make the till wrong more
 * often than the shop is.
 */
export interface SettleCheckContext {
  /** The bill about to be confirmed. */
  billId: string;
  /** Set when the bill is a table's tab rather than a counter sale. */
  tableId?: string;
  cart: CartItem[];
  /**
   * Whatever this trade's own billing controls are holding, keyed by slot id.
   *
   * A check usually has to ask whether the control that would satisfy it has
   * been filled in. A pharmacy's question is not "is there a Schedule H line?"
   * but "is there one with no prescription attached?", and only the pharmacy's
   * own slot knows what attached looks like. Core carries the bag across
   * without opening it.
   */
  slotValues?: Record<string, unknown>;
}

/**
 * A key and its values, not a sentence.
 *
 * A check runs outside React — it is registered at startup and called from an
 * event handler — so it has no `t` and no language. Resolving the words there
 * would print English on a Hindi counter, the same trap `VerticalNavEntry.label`
 * documents. Billing translates these when it renders the dialog.
 */
export interface SettleMessage {
  key: TranslationKey;
  vars?: TranslationVars;
}

export interface SettleWarning {
  /** One line: what is wrong. */
  title: SettleMessage;
  /** What happens if they go ahead. */
  body: SettleMessage;
  /** The button that proceeds anyway, e.g. "Settle anyway". */
  confirm: SettleMessage;
}

export interface SettleCheck {
  id: string;
  /** Null means nothing to say — the sale proceeds without a prompt. */
  run: (context: SettleCheckContext) => Promise<SettleWarning | null>;
}

const checks: SettleCheck[] = [];

export function registerSettleCheck(check: SettleCheck) {
  if (!check?.id || typeof check.run !== "function") {
    throw new TypeError("A settle check needs an id and a run function");
  }
  if (checks.some((current) => current.id === check.id)) return;
  checks.push(check);
}

/**
 * The first thing worth saying, or null.
 *
 * One warning at a time on purpose: a stack of dialogs in front of a queue gets
 * dismissed without being read, which is worse than not asking.
 *
 * A check that throws is ignored. The registry decides whether to interrupt a
 * sale, and "the warning could not be computed" is not a reason to stop a shop
 * taking money — the same call `loadVerticalSlots` makes when a control will
 * not load.
 */
export async function firstSettleWarning(context: SettleCheckContext): Promise<SettleWarning | null> {
  for (const check of checks) {
    try {
      const warning = await check.run(context);
      if (warning) return warning;
    } catch {
      // Deliberately swallowed; see above.
    }
  }
  return null;
}

export function resetSettleChecks() {
  checks.length = 0;
}
