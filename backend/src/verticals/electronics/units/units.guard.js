import { AppError } from "../../../middleware/error.js";
import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { registerBillLifecycle } from "../../../shared/bill-lifecycle.js";
import { SELLABLE_STATUSES } from "./units.schema.js";
import { normalizePhone, warrantyEndFrom } from "./units.service.js";

/**
 * The handset a bill line sold, recorded by the bill itself.
 *
 * The register and the bill used to be two separate acts: ring the phone up,
 * then walk to the register and mark that IMEI sold against a bill number typed
 * from memory. The second act is the one that gets forgotten on a busy day, and
 * a forgotten one is a warranty claim the shop cannot answer.
 *
 * So the counter picks the unit while billing, and this writes the register in
 * the bill's own transaction: the line carries `trackedUnitId`, the unit carries
 * the bill, and both exist or neither does.
 *
 * What it refuses is a serial that was chosen and cannot be honoured — somebody
 * else's unit, one already sold, one picked twice. The cashier is still at the
 * counter and can pick another.
 *
 * What it does NOT refuse is a line with no serial at all. That rule lives at
 * the counter, as a question the cashier has to answer (`billing-serial-check`
 * in the frontend pack), for three reasons this file cannot see past:
 *
 *   - "is this product serial-tracked?" can only be inferred from the register
 *     having rows for it, so a refusal here would stop the sale of every new
 *     arrival whose box has not been scanned yet, and of any product somebody
 *     once registered a single unit of;
 *   - the guard runs for every shop, and a shop whose plan no longer includes
 *     the register cannot open the picker that would satisfy it;
 *   - a till on an older app version has no picker either.
 *
 * In each case the shop would be holding a customer's money and a server that
 * will not take the sale. A register one entry behind can be caught up from the
 * register screen; a refused sale cannot.
 */

const refusal = (code, message) => ({ code, status: 409, message });

/** How a unit is named on a receipt line and in a message to the counter. */
function identityOf(unit) {
  return [
    unit.imei && `IMEI ${unit.imei}`,
    unit.imei2 && `IMEI2 ${unit.imei2}`,
    unit.serialNumber && `S/N ${unit.serialNumber}`,
  ].filter(Boolean).join(" · ");
}

function whyUnavailable(unit) {
  const name = identityOf(unit);
  if (unit.status === "sold") return `${name} was already sold${unit.billNumber ? ` on ${unit.billNumber}` : ""}. Choose another unit.`;
  if (unit.status === "rma") return `${name} is away at the service centre. Choose another unit.`;
  return `${name} is marked ${unit.status} and cannot be sold. Choose another unit.`;
}

const trackedLines = (bill) => (bill.items ?? []).filter((line) => line.trackedUnitId);

export function registerUnitSaleGuard() {
  registerSaleGuard(async ({ shopId, tx, items, productMap, body, isOfflineReplay }) => {
    // A replayed sale was made where the register could not be reached, so no
    // unit was reserved for it and the one it names may have gone out since.
    // The bill is taken as it is and the register is caught up by hand.
    if (isOfflineReplay) return null;

    // Every bill in every shop passes through here. One that names no serial —
    // which is all of them outside an electronics counter — costs no query.
    const chosenIds = [...new Set(items.map((item) => item.trackedUnitId).filter(Boolean))];
    if (chosenIds.length === 0) return null;

    const units = await tx.productUnit.findMany({ where: { shopId, id: { in: chosenIds }, deletedAt: null } });
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const taken = new Set();
    for (const item of items) {
      if (!item.trackedUnitId) continue;
      const unit = byId.get(item.trackedUnitId);
      // Scoped to the shop above, so another shop's unit reads as unknown too.
      if (!unit || unit.productId !== item.productId || !productMap[item.productId]) {
        return refusal("TRACKED_UNIT_UNKNOWN", "That IMEI or serial is not in this product's register. Choose one from the list.");
      }
      if (!SELLABLE_STATUSES.includes(unit.status)) return refusal("TRACKED_UNIT_UNAVAILABLE", whyUnavailable(unit));
      if (taken.has(unit.id)) return refusal("TRACKED_UNIT_UNAVAILABLE", `${identityOf(unit)} is on this bill twice. Each unit can be sold once.`);
      if (Number(item.quantity) !== 1) return refusal("TRACKED_UNIT_QUANTITY", "A serial number is one piece. Bill each serial as a line of quantity 1.");
      taken.add(unit.id);
    }

    return {
      // The line says which handset it was, in the column returns read and in
      // words on the receipt — the customer's copy is where an IMEI gets looked
      // for when the phone comes back.
      decorateBillItem({ item, billItem }) {
        const unit = byId.get(item.trackedUnitId);
        if (!unit) return null;
        // Quantity 1 of a box of ten is still ten pieces.
        if (Number(billItem.quantityInBaseUnit) !== 1) {
          throw new AppError("A serial number is one piece. Bill it in the single-piece unit.", 409, "TRACKED_UNIT_QUANTITY");
        }
        return { trackedUnitId: unit.id, note: [billItem.note, identityOf(unit)].filter(Boolean).join(" · ") };
      },
      async onConfirmed({ tx: confirmTx, bill, billNo }) {
        for (const line of trackedLines(bill)) {
          const unit = byId.get(line.trackedUnitId);
          if (!unit) continue;
          const soldAt = bill.businessDate ?? bill.createdAt;
          // Claimed on the state it was read in. Two counters reaching for the
          // same handset both pass the check above; only one of these updates
          // matches a row, and the other bill rolls back whole.
          const claimed = await confirmTx.productUnit.updateMany({
            where: { id: unit.id, shopId, deletedAt: null, status: unit.status, billId: unit.billId },
            data: {
              status: "sold",
              billId: bill.id,
              billNumber: billNo,
              soldAt,
              customerId: bill.customerId,
              customerName: bill.customerName,
              customerPhone: normalizePhone(body.customerMobile),
              sellingPrice: Number(line.lineTotal),
              // The cover starts with the sale and is stored as a date, so a
              // later change to the shop's policy cannot move this unit's end.
              warrantyUntil: warrantyEndFrom(soldAt, unit.warrantyMonths),
            },
          });
          if (claimed.count !== 1) {
            throw new AppError(`${identityOf(unit)} was sold at another counter just now. Choose another unit.`, 409, "UNIT_ALREADY_SOLD");
          }
        }
      },
    };
  });
}

/**
 * The register follows its bill through everything that happens to it later.
 *
 * Each step changes a unit only while the unit is still where this bill left it.
 * A handset that has since gone to the service centre, been written off or been
 * put in the recycle bin has a history of its own by now, and the bill's
 * reversal goes ahead without rewriting it — see `bill-lifecycle.js`.
 */
export function registerUnitBillLifecycle() {
  registerBillLifecycle({
    /** A cancelled sale puts its handset back on the shelf, with no buyer and no cover. */
    async cancel({ tx, shopId, bill }) {
      for (const line of trackedLines(bill)) {
        await tx.productUnit.updateMany({
          where: { id: line.trackedUnitId, shopId, billId: bill.id, status: "sold", deletedAt: null },
          data: {
            status: "in_stock", billId: null, billNumber: null, soldAt: null, sellingPrice: 0,
            customerId: null, customerName: null, customerPhone: "", warrantyUntil: null,
          },
        });
      }
    },

    /** An un-cancelled sale takes its handset back — unless it has been sold again since. */
    async restore({ tx, shopId, bill }) {
      for (const line of trackedLines(bill)) {
        const unit = await tx.productUnit.findFirst({ where: { id: line.trackedUnitId, shopId, deletedAt: null } });
        if (!unit) continue;
        const soldAt = bill.businessDate ?? bill.createdAt;
        await tx.productUnit.updateMany({
          where: { id: unit.id, shopId, billId: null, status: { in: SELLABLE_STATUSES }, deletedAt: null },
          data: {
            status: "sold", billId: bill.id, billNumber: bill.billNo, soldAt,
            customerId: bill.customerId, customerName: bill.customerName,
            sellingPrice: Number(line.lineTotal), warrantyUntil: warrantyEndFrom(soldAt, unit.warrantyMonths),
          },
        });
      }
    },

    /**
     * A returned line brings that exact handset back: open box if it can be
     * sold again, scrapped if the counter marked it damaged.
     *
     * `bill` is the return bill, whose lines copy `trackedUnitId` from the line
     * they return — so two identical phones on one sale are never confused.
     */
    async return({ tx, shopId, bill, original, requests }) {
      for (const line of trackedLines(bill)) {
        if (Math.abs(Number(line.quantity)) !== 1) {
          throw new AppError("A serial-numbered unit comes back whole. Set the return quantity to 1.", 409, "TRACKED_UNIT_QUANTITY");
        }
        const request = requests.find((item) => item.originalBillItemId === line.originalBillItemId);
        await tx.productUnit.updateMany({
          where: { id: line.trackedUnitId, shopId, billId: original.id, status: "sold", deletedAt: null },
          // The buyer stays on the row: the register's job is to say where this
          // piece has been. The cover ends with the sale it belonged to.
          data: { status: request?.damaged ? "scrapped" : "returned", condition: "open_box", warrantyUntil: null },
        });
      }
    },
  });
}

// Loading this module is what registers both halves, and `units.routes.js` is
// the only thing that loads it — the same arrangement as the pharmacy's guard.
registerUnitSaleGuard();
registerUnitBillLifecycle();
