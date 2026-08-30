import { roundQuantity } from "./billing-calculations";

/**
 * Typing a quantity without leaving the search box.
 *
 * A cashier billing a queue types an item, and the item lands at quantity one.
 * Billing three of it then means leaving the keyboard, finding the line in the
 * cart below, and tapping `+` twice — three interactions and a scroll for the
 * commonest thing in a shop. On a phone the cart is usually off screen while
 * the keyboard is up, so it is a scroll *back* as well.
 *
 * The till already understands quantity when it is spoken: the voice parser
 * knows `ek`, `do`, `teen`, `one`, `two`, `three`. It only fails to understand
 * it when it is typed. This closes that gap — `3*rice` adds three, and the
 * caret never leaves the field.
 *
 * ## Why an asterisk, and only an asterisk
 *
 * Every other candidate collides with real Indian stock:
 *
 * - **A leading bare number** (`5 star`) is the dangerous one. `5 Star`, `7Up`,
 *   `100 Pipers` and `50-50` are products, not quantities, and a cashier
 *   searching for one would silently bill five of something else.
 * - **`x` as a separator** (`3x rice`) collides with pack sizes printed on the
 *   item itself — `Vim Bar 3x`, `Maggi 12x` — which is exactly the text
 *   somebody types to find them.
 * - **An asterisk appears in no product name**, and it is what Tally and Marg
 *   have trained this market to type for a multiplier. It is both unambiguous
 *   and already familiar, which is a rare combination.
 *
 * Both orders are accepted because both are muscle memory somewhere: `3*rice`
 * reads as "three of", `rice*3` as "times three".
 */

/** Loose goods are sold by weight, so 2.5 kg has to survive this. */
const QUANTITY_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*\*\s*(.*)$|^(.*?)\s*\*\s*(\d+(?:\.\d+)?)\s*$/;

/**
 * A quantity nobody meant. Not a validation rule so much as a typo guard: a
 * slipped keypress turning 5 into 5000 is a bill the shop has to cancel, and
 * cancelling a bill costs more than retyping one.
 */
const MAX_TYPED_QUANTITY = 9999;

export interface ParsedQuantityQuery {
  /** What to actually search the catalogue for. */
  readonly term: string;
  /** The multiplier the cashier typed, or null when they typed none. */
  readonly quantity: number | null;
}

/**
 * Split `3*rice` into three and "rice".
 *
 * Returns the query untouched when there is no multiplier, so the ordinary case
 * — the overwhelming majority of searches — costs one failed regex and nothing
 * else. A malformed multiplier (`*rice`, `0*rice`, `abc*rice`) is deliberately
 * treated as ordinary text rather than an error: the cashier is mid-keystroke,
 * and a shop's till is not the place to argue with someone who is typing.
 */
export function parseQuantityQuery(raw: string): ParsedQuantityQuery {
  const input = raw ?? "";
  const match = QUANTITY_PATTERN.exec(input);
  if (!match) return { term: input, quantity: null };

  // Group 1/2 is `3*rice`; group 3/4 is `rice*3`. Exactly one pair matches.
  const rawQuantity = match[1] ?? match[4];
  const rawTerm = match[1] !== undefined ? match[2] : match[3];

  const quantity = Number(rawQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return { term: input, quantity: null };

  // An empty term is a cashier who has typed the count and not yet the item.
  // The multiplier is real and should show on screen; there is simply nothing
  // to search for yet.
  const term = (rawTerm ?? "").trim();

  return {
    term,
    quantity: roundQuantity(Math.min(quantity, MAX_TYPED_QUANTITY)),
  };
}

/**
 * Whether a parsed multiplier should change what the cart receives.
 *
 * One is not "no quantity" — a cashier who typed `1*rice` meant one, and the
 * caller should not have to distinguish that from an untyped default. This
 * exists so call sites read as intent rather than as a null check.
 */
export function hasTypedQuantity(parsed: ParsedQuantityQuery): boolean {
  return parsed.quantity !== null;
}
