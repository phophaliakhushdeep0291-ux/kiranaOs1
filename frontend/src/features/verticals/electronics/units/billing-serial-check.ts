import { registerSettleCheck, type SettleCheckContext, type SettleWarning } from "@/features/core/billing/settle-checks";
import { trackedProductIds } from "./api";
import { TRACKED_UNITS_SLOT, piecesByProduct, selectedUnits } from "./billing-selection";

/**
 * Do not let a handset leave without saying which one it was.
 *
 * A bill that names no serial still saves — the server takes it, stock moves,
 * the money is right. What is lost is the register entry: nobody will be able
 * to say who bought that IMEI or when its warranty began. On a busy counter
 * that used to be lost by forgetting a second step; with the serial chosen in
 * billing, the only way left to lose it is to skip the choice. This is the
 * question asked at that moment.
 *
 * It warns rather than refuses, like every other settle check. The cashier may
 * be selling a box that arrived this morning and has not been scanned, or the
 * till may be offline — where a serial cannot be reserved at all and the honest
 * thing is to say the bill is going out without one. A till that refused either
 * would be holding a customer's money and no way to take the sale.
 *
 * The server half is deliberately absent. `units.guard.js` refuses a serial
 * that cannot be honoured; it does not refuse a line with none, for the reasons
 * it gives there. What catches an unrecorded sale afterwards is the register
 * itself, which shows a product whose shelf count has fallen behind its units.
 */
export async function unserialisedTrackedLines(context: SettleCheckContext): Promise<SettleWarning | null> {
  // Registered for the life of the page; a shop of another trade opened in the
  // same session has no register to ask about.
  if (context.businessType && context.businessType !== "electronics") return null;

  const pieces = piecesByProduct(context.cart ?? []);
  if (pieces.size === 0) return null;

  const { tracked, live } = await trackedProductIds([...pieces.keys()]);
  if (tracked.size === 0) return null;

  // What billing will actually do with the choice: attach it only when the
  // server can be reached to reserve it.
  const reachable = context.online !== false && live;
  const chosen = reachable ? selectedUnits(context.slotValues?.[TRACKED_UNITS_SLOT]) : [];
  const missing = [...tracked]
    .map((productId) => {
      const line = pieces.get(productId);
      const without = (line?.pieces ?? 0) - chosen.filter((unit) => unit.productId === productId).length;
      return line && without > 0 ? `${line.name} × ${without}` : null;
    })
    .filter((entry): entry is string => entry !== null);
  if (missing.length === 0) return null;

  const items = missing.join(", ");
  return reachable
    ? {
        title: { key: "shopType.electronics.settle.noSerialTitle" },
        body: { key: "shopType.electronics.settle.noSerialBody", vars: { items } },
        confirm: { key: "shopType.electronics.settle.noSerialConfirm" },
      }
    : {
        title: { key: "shopType.electronics.settle.offlineTitle" },
        body: { key: "shopType.electronics.settle.offlineBody", vars: { items } },
        confirm: { key: "shopType.electronics.settle.noSerialConfirm" },
      };
}

registerSettleCheck({ id: "electronics/serial-check", run: unserialisedTrackedLines });
