import type { BillingItemsContext, BillingLine } from "@/features/core/billing/billing-slots";
import type { CartItem } from "@/features/core/billing/pages/billing-types";

/**
 * The serials a cashier has chosen for the bill in front of them, and what that
 * choice does to the bill's lines.
 *
 * Kept apart from the control that renders it because the rule here is money:
 * how a line is split, and where each paisa of its discount goes. It is tested
 * without a screen.
 */

/** The slot id the choice is stored under on the bill draft. */
export const TRACKED_UNITS_SLOT = "trackedUnits";

export interface SelectedUnit {
  id: string;
  productId: string;
  /** What the cashier sees: the IMEI, or the serial when there is no IMEI. */
  label: string;
}

/** The draft is persisted JSON, so the choice is read as untrusted and anything misshapen is dropped. */
export function selectedUnits(value: unknown): SelectedUnit[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((entry): entry is SelectedUnit => {
    const ok = Boolean(entry)
      && typeof entry.id === "string" && entry.id !== ""
      && typeof entry.productId === "string"
      && typeof entry.label === "string";
    if (!ok || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/**
 * How many pieces of each product the bill holds that a serial could go on.
 *
 * A serial is one whole piece. A line of 1.5 is not a number of handsets, so it
 * offers no place for one — the same line `prepareUnitBillItems` leaves alone.
 * Typed-in custom lines are not catalogue products and have none either.
 */
export function piecesByProduct(cart: CartItem[]): Map<string, { name: string; pieces: number }> {
  const pieces = new Map<string, { name: string; pieces: number }>();
  for (const line of cart) {
    if (line.isCustom) continue;
    const quantity = Number(line.quantity);
    const previous = pieces.get(line.product.id);
    pieces.set(line.product.id, {
      name: line.product.name,
      pieces: (previous?.pieces ?? 0) + (Number.isInteger(quantity) && quantity > 0 ? quantity : 0),
    });
  }
  return pieces;
}

/**
 * The choice with everything the bill no longer has room for taken out.
 *
 * The cart changes under a choice: a line is removed, or a quantity drops from
 * two to one. What is left over must not sit in the draft claiming "2 of 1".
 * Returns the same array when nothing had to go, so a caller can tell.
 */
export function pruneSelection(selection: SelectedUnit[], cart: CartItem[]): SelectedUnit[] {
  const room = new Map([...piecesByProduct(cart)].map(([productId, line]) => [productId, line.pieces]));
  const kept = selection.filter((unit) => {
    const left = room.get(unit.productId) ?? 0;
    if (left <= 0) return false;
    room.set(unit.productId, left - 1);
    return true;
  });
  return kept.length === selection.length ? selection : kept;
}

/**
 * One bill line per chosen unit, so a return can name the exact handset.
 *
 * A line of three with two serials chosen becomes two lines of one, each
 * carrying its serial, and a third line for the piece that has none. The
 * discount on the original line is divided by piece, to the paisa, and each new
 * line keeps the share of the pieces on it — so the three add back to exactly
 * what the cashier took off.
 *
 * Offline, nothing is attached. A serial is reserved by the server in the bill's
 * own transaction, and a queued bill has no server to reserve it with; the bill
 * is saved as it stands and the register is caught up afterwards.
 *
 * Billing runs this for the payload and again for the totals it shows, which is
 * why it is generic: GST is rounded per line, so both must see the same lines.
 */
export function prepareUnitBillItems<Line extends BillingLine>(items: Line[], value: unknown, context: BillingItemsContext): Line[] {
  if (!context.online) return items;
  const unused = selectedUnits(value);
  if (unused.length === 0) return items;

  return items.flatMap((item) => {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) return [item];
    const units: SelectedUnit[] = [];
    for (let index = 0; index < unused.length && units.length < item.quantity;) {
      if (unused[index].productId === item.productId) units.push(...unused.splice(index, 1));
      else index += 1;
    }
    if (units.length === 0) return [item];

    const discountPaise = Math.round((item.lineDiscount ?? 0) * 100);
    const each = Math.floor(discountPaise / item.quantity);
    // The first few pieces carry the odd paise that do not divide evenly.
    const shareOf = (piece: number) => each + (piece < discountPaise % item.quantity ? 1 : 0);

    const lines: Line[] = units.map((unit, piece) => ({ ...item, quantity: 1, trackedUnitId: unit.id, lineDiscount: shareOf(piece) / 100 }));
    const without = item.quantity - units.length;
    if (without > 0) {
      let restPaise = 0;
      for (let piece = units.length; piece < item.quantity; piece += 1) restPaise += shareOf(piece);
      lines.push({ ...item, quantity: without, lineDiscount: restPaise / 100 });
    }
    return lines;
  });
}
