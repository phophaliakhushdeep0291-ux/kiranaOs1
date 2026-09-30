import { AppError } from "../../../middleware/error.js";
import { registerSaleGuard } from "../../../shared/sale-guards.js";
import { evaluateSale, prescriptionBlockers, prescriptionLineMismatch } from "./scheduleEnforcement.js";

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
  registerSaleGuard(async ({ shopId, tx, body, items, productMap, isEstimate, isOfflineReplay }) => {
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

    if (!decision.requiresPrescription) {
      // Nothing restricted on this bill, so nothing here needs a slip.
      //
      // An OTC line still gets this far: it carries a drugSchedule, so it
      // survives the filter above, and only evaluateSale decides it is
      // unrestricted. Handing back an onConfirmed anyway is what made an
      // ordinary sale in a classified pharmacy dereference a null prescription
      // the moment the bill was confirmed.
      //
      // A slip attached on purpose is different: the chemist is dispensing it,
      // and the entry should close with this bill. That holds only for a bill
      // being made now. A replayed sale already happened, the slip it names may
      // have been used since, and nothing on it needed one — so it is taken as
      // it always was, with the slip left untouched.
      if (!body.prescriptionId || isOfflineReplay) return null;
      if (prescriptionBlockers(prescription).length) {
        return {
          code: "PRESCRIPTION_NOT_AVAILABLE",
          status: 409,
          message: "This prescription can no longer be dispensed. Refresh the register and check its status, or remove it from the bill.",
        };
      }
    }

    // A bill being made at the counter has to hand over what the slip says. A
    // replay is not held to that: until this check existed any valid slip
    // authorised the sale, and a till still on that version must not find its
    // morning's bills parked as conflicts after the fact.
    if (!isOfflineReplay) {
      const mismatch = prescriptionLineMismatch({
        items,
        productMap,
        prescription,
        restrictedProductIds: new Set(decision.restrictedLines.map((line) => line.productId)),
      });
      if (mismatch) return { ...mismatch, status: 409 };
    }

    // Allowed — and once the bill exists, close the register entry against it.
    //
    // Whether this hand-over is a repeat has to be read BEFORE the sale, from the
    // slip as it stood when the decision was made. By the time onConfirmed runs
    // the row is being written to.
    const isRefill = prescription.status === "dispensed";
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
        //
        // Claimed on the state the decision was made in. Two counters billing
        // the same one-time slip both pass the check above; only one of these
        // updates matches the row, and the other bill rolls back whole.
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
        if (claimed.count !== 1) {
          throw new AppError("This prescription was dispensed at another counter just now. Refresh the register.", 409, "PRESCRIPTION_ALREADY_DISPENSED");
        }
      },
    };
  });
}

// How shared billing learns about Schedule H without importing pharmacy. Loading
// this module is what registers the guard, and the only way to reach it is
// through the pharmacy pack's routes — so a shop with no prescriptions never
// runs it. Same arrangement as the clothing pack's catalogue filter.
registerPrescriptionSaleGuard();
