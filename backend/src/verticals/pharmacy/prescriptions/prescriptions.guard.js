import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { evaluateSale, prescriptionBlockers } from "./scheduleEnforcement.js";

/**
 * The pharmacy's own condition on a sale: Schedule H, H1 and X do not leave the
 * shop without a doctor's slip.
 *
 * The register that records such a sale already existed. Nothing refused the
 * sale itself, so writing the entry was effectively voluntary — this is the half
 * that was missing.
 *
 * Registered rather than imported by billing, so the shared path never names a
 * trade. Costs a shop with no classified products nothing: `lines` comes back
 * empty and the whole thing collapses to a boolean.
 */
export function registerPrescriptionSaleGuard() {
  registerSaleGuard(async ({ shopId, tx, body, items, productMap, isEstimate }) => {
    // A kacha estimate hands nothing over. Blocking one would stop a pharmacy
    // pricing a prescription before the customer has decided to buy.
    if (isEstimate) return null;

    const lines = items
      .filter((item) => item.productId && productMap[item.productId]?.drugSchedule)
      .map((item) => ({
        productId: item.productId,
        name: productMap[item.productId].name,
        schedule: productMap[item.productId].drugSchedule,
      }));
    if (lines.length === 0 && !body.prescriptionId) return null;

    const prescription = body.prescriptionId
      ? await tx.prescription.findFirst({ where: { id: body.prescriptionId, shopId }, include: { items: true } })
      : null;
    const decision = evaluateSale({ lines, prescription });

    if (!decision.allowed) {
      const names = decision.restrictedLines.map((line) => line.name).join(", ");
      return {
        code: "PRESCRIPTION_REQUIRED_FOR_SCHEDULE",
        status: 409,
        message: `${names} ${decision.restrictedLines.length === 1 ? "is" : "are"} Schedule ${decision.schedule.toUpperCase()} and cannot be sold without a valid prescription`,
        // The counter has to know which medicine and what is wrong with the slip,
        // or the only available fix is to drop the line and lose the sale.
        publicData: {
          schedule: decision.schedule,
          blockers: decision.blockers,
          restrictedLines: decision.restrictedLines.map((line) => ({ productId: line.productId, name: line.name, schedule: line.schedule })),
        },
      };
    }

    if (body.prescriptionId && prescriptionBlockers(prescription).length) {
      return { code: "PRESCRIPTION_NOT_AVAILABLE", status: 409, message: "This prescription is no longer available to dispense. Refresh the register and check its status." };
    }

    // An ordinary OTC basket needs no entry; an explicitly attached OTC slip does.
    //
    // An OTC line still gets this far: it carries a drugSchedule, so it survives
    // the filter above, and only evaluateSale decides it is unrestricted. Handing
    // back an onConfirmed anyway is what made an ordinary sale in a classified
    // pharmacy dereference a null prescription the moment the bill was confirmed.
    if (!prescription) return null;

    // Allowed — and once the bill exists, close the register entry against it.
    //
    // Whether this hand-over is a repeat has to be read BEFORE the sale, from the
    // slip as it stood when the decision was made. By the time onConfirmed runs
    // the row is being written to.
    const isRefill = prescription.status === "dispensed";
    if (prescription.items) {
      const allocated = new Map();
      for (const item of items) {
        const prescribed = prescription.items.filter((line) => line.productId === item.productId || (!line.productId && line.name.trim().toLowerCase() === productMap[item.productId]?.name?.trim().toLowerCase()));
        const restricted = decision.restrictedLines.some((line) => line.productId === item.productId);
        if (!prescribed.length && !restricted) continue;
        const matching = prescribed.filter((line) => line.unit.toLowerCase() === item.enteredUnit?.toLowerCase());
        const qty = (allocated.get(item.productId) ?? 0) + Number(item.quantity);
        if (!matching.length || qty > matching.reduce((total, line) => total + Number(line.qty), 0)) {
          return { code: "PRESCRIPTION_ITEMS_MISMATCH", status: 409, message: "The medicine, quantity or selling unit does not match the attached prescription. Check the register before dispensing." };
        }
        allocated.set(item.productId, qty);
      }
      if (!allocated.size) return { code: "PRESCRIPTION_ITEMS_MISMATCH", status: 409, message: "Add a medicine from the attached prescription before saving its bill." };
    }
    return {
      onConfirmed: async ({ tx: confirmTx, bill, billNo }) => {
        // billNumber is copied alongside the id on purpose, matching the model's
        // own note: the entry is the legal record and must keep saying what went
        // out even if the bill is later cancelled or purged.
        //
        // refillsUsed counts REPEATS taken, never the original hand-over — the
        // scale dispensePrescription, canDispense and the refillable summary all
        // use. Incrementing on the first dispense too put this one path on its
        // own scale, and a slip dispensed at the register then billed here was
        // read as having a hand-over left when it did not.
        const claimed = await confirmTx.prescription.updateMany({
          where: { id: prescription.id, shopId, status: prescription.status, refillsUsed: prescription.refillsUsed, deletedAt: null },
          data: {
            status: "dispensed",
            dispensedAt: new Date(),
            billId: bill.id,
            billNumber: billNo,
            ...(isRefill ? { refillsUsed: { increment: 1 } } : {}),
          },
        });
        if (claimed.count !== 1) throw Object.assign(new Error("This prescription was dispensed at another counter. Refresh the register."), { statusCode: 409, code: "PRESCRIPTION_ALREADY_DISPENSED" });
      },
    };
  });
}

// How shared billing learns about Schedule H without importing pharmacy. Loading
// this module is what registers the guard, and the only way to reach it is
// through the pharmacy pack's routes — so a shop with no prescriptions never
// runs it. Same arrangement as the clothing pack's catalogue filter.
registerPrescriptionSaleGuard();
